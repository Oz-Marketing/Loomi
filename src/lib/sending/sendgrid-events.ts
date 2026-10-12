// Process a batch of SendGrid Event Webhook payloads.
//
// SendGrid POSTs events in batches (one JSON array per request) on an
// at-least-once basis: anything but a 2xx is redelivered later. Two
// properties make that safe, and both hold per event:
//
//   - Idempotent. sg_event_id (opaque, globally unique per event) is the
//     unique key on EmailEvent, and an event's side effects run only in the
//     transaction whose INSERT actually created its row. A redelivery inserts
//     nothing and changes nothing, however fast or slow either attempt was.
//   - Atomic. The insert and every side effect commit together, so a failure
//     part-way rolls the row back too. The route answers 5xx, SendGrid
//     redelivers, and the retry finds nothing recorded and applies it whole.
//
// Each event optionally carries the custom_args we stamped at send time
// (campaignId, recipientId, accountKey). When they're missing we fall back to
// the message id the send loop stored on the recipient row; when that finds
// nothing either, the event is still logged but changes no recipient state.

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getRelatedAccountKeys } from '@/lib/services/accounts';
import {
  recomputeEmailBlastCounters,
  writeEmailSuppressions,
  type EmailSuppressionReason,
} from '@/lib/sending/email-delivery-state';

/** Shape of a single entry in SendGrid's Event Webhook batch. */
export interface SendGridEvent {
  event: string;
  email?: string;
  timestamp?: number; // seconds since epoch
  sg_event_id?: string;
  sg_message_id?: string;
  // custom_args fields are flattened into the top-level object by SendGrid;
  // accessor below normalizes that.
  campaignId?: string;
  recipientId?: string;
  accountKey?: string;
  // Common per-event fields:
  url?: string;
  reason?: string;
  type?: string; // bounce type: 'bounce' | 'blocked' | 'expired'
  /** Bounce only: SendGrid's reading of WHY it bounced. See isPermanentBounce. */
  bounce_classification?: string;
  /** Open only: true when SendGrid attributes the open to a machine. */
  sg_machine_open?: boolean;
  useragent?: string;
  ip?: string;
  // SendGrid sometimes nests args; keep raw access for forensics.
  [key: string]: unknown;
}

/** Per-event outcome — surfaced in the handler response for observability. */
export interface ProcessedEventOutcome {
  sgEventId: string;
  /**
   *   persisted — new; recorded along with its effects.
   *   duplicate — an earlier delivery already recorded it; nothing changed.
   *   invalid   — malformed. Acknowledged and dropped: no retry can fix it.
   *   failed    — OUR fault (the database, mostly). Nothing was recorded, and
   *               the route answers 5xx so SendGrid delivers it again.
   */
  status: 'persisted' | 'duplicate' | 'invalid' | 'failed';
  reason?: string;
}

/**
 * Bounce classifications that describe the SENDER — our reputation, our
 * content, our volume, a fault between the servers — rather than the address.
 * The same mailbox takes the next message once the cause clears.
 */
const SENDER_SIDE_BOUNCE_CLASSIFICATIONS = new Set([
  'reputation',
  'content',
  'frequency or volume',
  'technical',
]);

/**
 * Bounce `type`s that are not a verdict on the address: 'blocked' is the
 * receiving server refusing US (a blocklist, a reputation or content filter),
 * and 'expired' is SendGrid giving up after the receiver deferred for days.
 */
const NON_PERMANENT_BOUNCE_TYPES = new Set(['blocked', 'expired']);

/**
 * A string field from the payload, or null. NULs are stripped: Postgres
 * rejects them in text columns, and a value it rejects on every attempt would
 * fail its batch on every redelivery, for as long as SendGrid keeps trying.
 */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\u0000/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

function lower(value: unknown): string {
  return (text(value) ?? '').trim().toLowerCase();
}

function normalizeEmail(value: unknown): string | null {
  const email = lower(value);
  return email || null;
}

function epochToDate(seconds: unknown): Date {
  if (typeof seconds === 'number' && Number.isFinite(seconds)) {
    const date = new Date(seconds * 1000);
    // Finite isn't enough — past ±8.64e15 ms it's an Invalid Date, which the
    // insert would reject on every redelivery.
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The eventType we record. An open SendGrid attributes to a machine — Apple
 * Mail Privacy Protection fetching every image the moment a message arrives,
 * a corporate link scanner — is stored as 'machine_open', not 'open'. MPP
 * alone fires for a large share of iPhone recipients whether or not anyone
 * reads the email, so counting those inflated open rates and walked
 * lastEmailOpenedAt forward for people who never opened anything.
 */
export function recordedEventType(ev: SendGridEvent): string {
  const event = text(ev.event) ?? '';
  if (event === 'open' && String(ev.sg_machine_open).toLowerCase() === 'true') {
    return 'machine_open';
  }
  return event;
}

/**
 * Is this bounce a verdict on the ADDRESS?
 *
 * Every bounce used to suppress, which made one bad afternoon permanent: a
 * blocklist listing or a Microsoft reputation block bounces a whole blast at
 * once, and each of those healthy addresses was then suppressed at every
 * rooftop in the group, for good. Only a bounce that says the mailbox itself
 * is unusable ("Invalid Address", "Mailbox Unavailable", or a classification
 * SendGrid didn't give) suppresses now. The rest still mark the recipient
 * bounced, because the message did not arrive.
 */
export function isPermanentBounce(ev: SendGridEvent): boolean {
  if (NON_PERMANENT_BOUNCE_TYPES.has(lower(ev.type))) return false;
  return !SENDER_SIDE_BOUNCE_CLASSIFICATIONS.has(lower(ev.bounce_classification));
}

/**
 * Drops SendGrid makes because of something about the RECIPIENT — an address
 * already on one of its own suppression lists, or one it can't parse. Matched
 * loosely, since SendGrid's wording has varied, but only against these: every
 * other drop ("Spam Content", "Exceeded Quota", "Invalid SMTPAPI header",
 * anything new) is about our message or our account and suppresses nothing.
 */
export function suppressionReasonForDrop(reason: unknown): EmailSuppressionReason | null {
  const r = lower(reason);
  // Before the 'invalid' check: "Invalid SMTPAPI header" is our malformed
  // request, not their address.
  if (!r || r.includes('smtpapi')) return null;
  if (r.includes('spam report')) return 'spamreport';
  if (r.includes('unsubscribe')) return 'unsubscribe';
  if (r.includes('bounced')) return 'bounce';
  if (/^invalid( email| recipient)?( address)?\.?$/.test(r)) return 'bounce';
  return null;
}

/** The suppression an event earns, if any — independent of whether we know
 *  which account to put it on. */
export function suppressionReasonFor(ev: SendGridEvent): EmailSuppressionReason | null {
  switch (ev.event) {
    case 'spamreport':
      return 'spamreport';
    case 'unsubscribe':
    case 'group_unsubscribe':
      return 'unsubscribe';
    case 'bounce':
      return isPermanentBounce(ev) ? 'bounce' : null;
    case 'dropped':
      return suppressionReasonForDrop(ev.reason);
    default:
      return null;
  }
}

/**
 * The recipient row's error for a bounce or a drop.
 *
 * The leading event name is load-bearing: scripts/backfill-blast-bounce-status.ts
 * tells these rows apart from dispatch failures by it. A bounce that is NOT a
 * verdict on the address says why in brackets — "bounce (blocked): …" — so
 * the row doesn't read as a dead mailbox when the receiver was refusing us.
 */
function recipientBounceError(ev: SendGridEvent): string {
  const reason = text(ev.reason);
  if (ev.event === 'dropped') return reason ? `dropped: ${reason}` : 'dropped';
  if (isPermanentBounce(ev)) return reason ? `bounce: ${reason}` : 'bounce (hard)';
  const type = lower(ev.type);
  const label = NON_PERMANENT_BOUNCE_TYPES.has(type) ? type : lower(ev.bounce_classification);
  return `bounce (${label})${reason ? `: ${reason}` : ''}`;
}

/**
 * The X-Message-Id the send loop stored on the recipient row. sg_message_id is
 * that id plus a suffix SendGrid appends per recipient (".filter…"), so it's
 * the part before the first dot.
 */
export function sendMessageIdOf(sgMessageId: unknown): string | null {
  const value = text(sgMessageId);
  if (!value) return null;
  return value.split('.')[0].trim() || null;
}

/** Event types that move an engagement timestamp, and which one. A
 *  machine_open is absent on purpose — see recordedEventType. */
const ENGAGEMENT_COLUMNS: Record<string, 'lastEmailDeliveredAt' | 'lastEmailOpenedAt' | 'lastEmailClickedAt'> = {
  delivered: 'lastEmailDeliveredAt',
  open: 'lastEmailOpenedAt',
  click: 'lastEmailClickedAt',
};

/** What an event needs to know about the recipient row it belongs to. */
interface RecipientRef {
  id: string;
  campaignId: string;
  accountKey: string;
  email: string | null;
}

const RECIPIENT_REF_SELECT = {
  id: true,
  campaignId: true,
  accountKey: true,
  email: true,
} as const;

interface RecipientLookups {
  byId: Map<string, RecipientRef>;
  /** null when more than one row claims the id — trust neither. */
  byMessageId: Map<string, RecipientRef | null>;
}

/**
 * Every recipient row the batch refers to, in at most two queries.
 *
 * Batched, not per event, mostly for the message-id fallback: there is no
 * index on EmailCampaignRecipient.messageId, so it's a table scan. Once per
 * delivery is tolerable; once per event is not, and whole batches do arrive
 * without custom args — the form alerts, lead emails and test sends that go
 * through the same SendGrid account carry none.
 */
async function loadRecipientLookups(events: SendGridEvent[]): Promise<RecipientLookups> {
  const ids = new Set<string>();
  const messageIds = new Set<string>();
  for (const ev of events) {
    const recipientId = text(ev.recipientId);
    if (recipientId) {
      ids.add(recipientId);
    } else {
      const messageId = sendMessageIdOf(ev.sg_message_id);
      if (messageId) messageIds.add(messageId);
    }
  }

  const [byIdRows, byMessageRows] = await Promise.all([
    ids.size > 0
      ? prisma.emailBlastRecipient.findMany({
          where: { id: { in: [...ids] } },
          select: RECIPIENT_REF_SELECT,
        })
      : Promise.resolve([]),
    messageIds.size > 0
      ? prisma.emailBlastRecipient.findMany({
          where: { messageId: { in: [...messageIds] } },
          select: { ...RECIPIENT_REF_SELECT, messageId: true },
        })
      : Promise.resolve([]),
  ]);

  const byId = new Map<string, RecipientRef>();
  for (const row of byIdRows) byId.set(row.id, row);

  const byMessageId = new Map<string, RecipientRef | null>();
  for (const { messageId, ...row } of byMessageRows) {
    if (!messageId) continue;
    byMessageId.set(messageId, byMessageId.has(messageId) ? null : row);
  }

  return { byId, byMessageId };
}

interface EventContext {
  campaignId: string | null;
  accountKey: string | null;
  /** The recipient row, confirmed to exist — safe to FK against and update. */
  recipient: RecipientRef | null;
}

function resolveContext(
  ev: SendGridEvent,
  email: string | null,
  lookups: RecipientLookups,
): EventContext {
  // SendGrid flattens custom_args directly onto the event object.
  let campaignId = text(ev.campaignId);
  let accountKey = text(ev.accountKey);
  const recipientId = text(ev.recipientId);

  let recipient: RecipientRef | null = null;
  if (recipientId) {
    // Checked against a real row before we FK against it — custom_args are
    // just strings, and a stale recipientId from a deleted campaign would
    // fail the insert.
    recipient = lookups.byId.get(recipientId) ?? null;
  } else {
    const messageId = sendMessageIdOf(ev.sg_message_id);
    const match = messageId ? lookups.byMessageId.get(messageId) ?? null : null;
    // An address that disagrees with the row means the id matched some other
    // send. Better to log the event unattached than to suppress, or bounce,
    // on the wrong account.
    if (match && (!match.email || !email || match.email.toLowerCase().trim() === email)) {
      recipient = match;
    }
  }

  if (recipient) {
    campaignId = campaignId ?? recipient.campaignId;
    accountKey = accountKey ?? recipient.accountKey;
  }
  return { campaignId, accountKey, recipient };
}

/** Sibling accounts a suppression cascades to, read once per account per
 *  batch — a bounce-heavy batch is mostly one account's events. */
type RelatedKeys = (accountKey: string) => Promise<string[]>;

function memoizedRelatedKeys(): RelatedKeys {
  const cache = new Map<string, Promise<string[]>>();
  return (accountKey) => {
    let keys = cache.get(accountKey);
    if (!keys) {
      keys = getRelatedAccountKeys(accountKey);
      cache.set(accountKey, keys);
      // A failed read shouldn't doom the account's later events in the batch.
      keys.catch(() => cache.delete(accountKey));
    }
    return keys;
  };
}

/**
 * Generous on purpose. The managed database is far slower than a local one,
 * and a webhook transaction that times out costs a 5xx and a redelivery, not
 * data. Prisma's defaults (2s for a connection, 5s overall) suit requests a
 * person is waiting on.
 */
const EVENT_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

/**
 * Process one batch. Returns an outcome per event, in order, so the caller
 * can decide the response code and write a summary line. A failure on one
 * event doesn't stop the rest: everything that commits is a no-op duplicate
 * when SendGrid redelivers the batch for the one that didn't.
 */
export async function processSendGridEventBatch(
  events: readonly unknown[],
): Promise<ProcessedEventOutcome[]> {
  const outcomes = new Array<ProcessedEventOutcome>(events.length);
  const accepted: Array<{ index: number; ev: SendGridEvent; sgEventId: string }> = [];

  events.forEach((candidate, index) => {
    const ev =
      candidate && typeof candidate === 'object' && !Array.isArray(candidate)
        ? (candidate as SendGridEvent)
        : null;
    const sgEventId = ev ? text(ev.sg_event_id) : null;
    if (!ev || !sgEventId || !text(ev.event)) {
      outcomes[index] = {
        sgEventId: sgEventId || '(missing)',
        status: 'invalid',
        reason: 'Missing sg_event_id or event type',
      };
      return;
    }
    accepted.push({ index, ev, sgEventId });
  });
  if (accepted.length === 0) return outcomes;

  let lookups: RecipientLookups;
  try {
    lookups = await loadRecipientLookups(accepted.map(({ ev }) => ev));
  } catch (err) {
    // Nothing has been written yet; every event gets the retry.
    for (const { index, sgEventId } of accepted) {
      outcomes[index] = { sgEventId, status: 'failed', reason: errorMessage(err) };
    }
    return outcomes;
  }

  const relatedKeys = memoizedRelatedKeys();
  for (const { index, ev, sgEventId } of accepted) {
    try {
      const status = await persistEvent(ev, sgEventId, lookups, relatedKeys);
      outcomes[index] = { sgEventId, status };
    } catch (err) {
      outcomes[index] = { sgEventId, status: 'failed', reason: errorMessage(err) };
    }
  }
  return outcomes;
}

async function persistEvent(
  ev: SendGridEvent,
  sgEventId: string,
  lookups: RecipientLookups,
  relatedKeys: RelatedKeys,
): Promise<'persisted' | 'duplicate'> {
  const eventType = recordedEventType(ev);
  const timestamp = epochToDate(ev.timestamp);
  const email = normalizeEmail(ev.email);
  const { campaignId, accountKey, recipient } = resolveContext(ev, email, lookups);

  const row: Prisma.EmailEventCreateManyInput = {
    sgEventId,
    eventType,
    campaignId,
    recipientId: recipient?.id ?? null,
    accountKey,
    sgMessageId: text(ev.sg_message_id),
    email,
    timestamp,
    url: text(ev.url),
    reason: text(ev.reason),
    userAgent: text(ev.useragent),
    ip: text(ev.ip),
    raw: JSON.stringify(ev),
  };

  // Every effect is decided before the transaction opens, so it holds its
  // locks only for the writes themselves.
  const bounceError =
    recipient && (ev.event === 'bounce' || ev.event === 'dropped')
      ? recipientBounceError(ev)
      : null;

  const suppressionReason = accountKey && email ? suppressionReasonFor(ev) : null;
  const suppression =
    suppressionReason && accountKey && email
      ? {
          // Org-wide cascade: a bounce / spam report / unsubscribe for an
          // address is authoritative for the whole group, so mirror it onto
          // every sibling rooftop. Standalone accounts have no siblings.
          accountKeys: [accountKey, ...(await relatedKeys(accountKey))],
          email,
          reason: suppressionReason,
          source: 'sendgrid',
          raw: JSON.stringify({
            event: ev.event,
            type: ev.type,
            reason: ev.reason,
            bounce_classification: ev.bounce_classification,
            url: ev.url,
          }),
        }
      : null;

  // Roll the engagement timestamps forward on the contact so "opened an email
  // in the last 30 days" is an indexed column read rather than an aggregate
  // join at query time.
  const column = ENGAGEMENT_COLUMNS[eventType];
  const engagement = column && accountKey && email ? { accountKey, email, column } : null;

  // Nothing to apply — processed, deferred, a machine open, an event we can't
  // attach to anyone. The insert alone is atomic, so skip the transaction's
  // extra round trips; these are most of a blast's events.
  if (!bounceError && !suppression && !engagement) {
    const { count } = await prisma.emailEvent.createMany({ data: [row], skipDuplicates: true });
    return count > 0 ? 'persisted' : 'duplicate';
  }

  return prisma.$transaction(async (tx) => {
    // ON CONFLICT (sgEventId) DO NOTHING. A count of 1 means THIS transaction
    // created the row and so owns the effects; 0 means an earlier delivery
    // already applied them. This replaced a guess from createdAt ("written in
    // the last 5 seconds, so it's ours"), which dropped the effects of any
    // insert slower than that and applied a redelivery's a second time if it
    // landed within the window. A concurrent delivery of the same event waits
    // here until ours commits or rolls back, then does the opposite of
    // whatever we did — exactly one of them applies it.
    const { count } = await tx.emailEvent.createMany({ data: [row], skipDuplicates: true });
    if (count === 0) return 'duplicate';

    if (bounceError && recipient) await markRecipientBounced(tx, recipient, bounceError);
    if (suppression) await writeEmailSuppressions(tx, suppression);
    if (engagement) await touchContactEngagement(tx, engagement, eventType, timestamp);
    return 'persisted';
  }, EVENT_TRANSACTION_OPTIONS);
}

/**
 * Mark the recipient bounced, then recount its blast.
 *
 * `bounced`, not `failed`. Nothing went wrong with the SEND: SendGrid
 * accepted the message and we recorded it 'sent' at the time. What happened
 * afterwards is that a mailbox refused it — which is a fact about the
 * address, not about the blast.
 *
 * The distinction is the whole point. A blast whose only "errors" are
 * bounces used to resolve to 'partial' and render as "Sent with errors",
 * which is how a healthy send to an old list looked like a malfunction to
 * the client reading it. Genuine dispatch failures still say 'failed' and
 * still raise that flag, because those are the ones somebody can fix.
 *
 * Applied whatever the row says now, 'pending' included: SendGrid can report
 * a drop before the send loop has written 'sent' for the message it just
 * handed over, and that verdict must stand.
 */
async function markRecipientBounced(
  tx: Prisma.TransactionClient,
  recipient: RecipientRef,
  error: string,
): Promise<void> {
  const { count } = await tx.emailBlastRecipient.updateMany({
    where: { id: recipient.id },
    data: { status: 'bounced', error },
  });
  // Gone since the batch looked it up — its blast was purged. Nothing to count.
  if (count === 0) return;

  // Recounted from the rows rather than nudged: see recomputeEmailBlastCounters.
  // One production blast read sentCount=3581/failedCount=414 against
  // recipients that said 2968 sent / 1027 failed, the gap exactly its async
  // bounces.
  await recomputeEmailBlastCounters(tx, recipient.campaignId);
}

/**
 * Advance a contact's engagement rollups. Only ever moves a timestamp
 * FORWARD — SendGrid can deliver events out of order and replays are
 * routine, so a late-arriving older event must not walk the value back.
 *
 * Matched on (accountKey, email) because the event carries the address,
 * not a contactId; that pair is unique on Contact.
 */
async function touchContactEngagement(
  tx: Prisma.TransactionClient,
  target: {
    accountKey: string;
    email: string;
    column: 'lastEmailDeliveredAt' | 'lastEmailOpenedAt' | 'lastEmailClickedAt';
  },
  eventType: string,
  timestamp: Date,
): Promise<void> {
  const { accountKey, email, column } = target;
  const data: Record<string, Date> = { [column]: timestamp };

  await tx.contact.updateMany({
    where: {
      accountKey,
      email,
      // The forward-only guard: skip rows already at or past this event.
      OR: [{ [column]: null }, { [column]: { lt: timestamp } }],
    },
    data,
  });

  // A delivery is also "a message reached this contact", which is what
  // lastMessageAt tracks across both channels. Opens and clicks aren't —
  // they say the contact engaged, not that we sent something new.
  if (eventType === 'delivered') {
    await tx.contact.updateMany({
      where: {
        accountKey,
        email,
        OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: timestamp } }],
      },
      data: { lastMessageAt: timestamp },
    });
  }
}
