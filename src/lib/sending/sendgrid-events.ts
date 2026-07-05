// Process a batch of SendGrid Event Webhook payloads.
//
// SendGrid POSTs events in batches (one JSON array per request) on an
// at-least-once basis: any 5xx triggers a retry. Dedup is the caller's
// problem, and we use sg_event_id (opaque, globally unique per event)
// as the idempotency key on the EmailEvent table.
//
// Each event optionally carries the custom_args we stamped at send
// time (campaignId, recipientId, accountKey). When present we can wire
// the event straight to its originating row; when absent we still log
// the event but don't update recipient state.

import { prisma } from '@/lib/prisma';

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
  useragent?: string;
  ip?: string;
  // SendGrid sometimes nests args; keep raw access for forensics.
  [key: string]: unknown;
}

/** Per-event outcome — surfaced in the handler response for observability. */
export interface ProcessedEventOutcome {
  sgEventId: string;
  status: 'persisted' | 'duplicate' | 'invalid';
  reason?: string;
}

/** Terminal email statuses that should mark the recipient row as bounced. */
const HARD_BOUNCE_TYPES = new Set(['bounce', 'blocked']);

/** Events that drop the email onto the suppression list permanently. */
const SUPPRESSION_EVENTS: Record<string, string> = {
  bounce: 'bounce',
  dropped: 'bounce',
  spamreport: 'spamreport',
  unsubscribe: 'unsubscribe',
  group_unsubscribe: 'unsubscribe',
};

function epochToDate(seconds?: number): Date {
  if (typeof seconds === 'number' && Number.isFinite(seconds)) {
    return new Date(seconds * 1000);
  }
  return new Date();
}

/**
 * Process one batch. Returns an outcome per event so the caller can
 * write a summary log line. Failures on individual events are caught
 * and reported but don't poison the whole batch — partial success is
 * the goal so SendGrid's retry storm settles down.
 */
export async function processSendGridEventBatch(
  events: SendGridEvent[],
): Promise<ProcessedEventOutcome[]> {
  const outcomes: ProcessedEventOutcome[] = [];
  for (const ev of events) {
    const sgEventId = ev.sg_event_id || '';
    if (!sgEventId || typeof ev.event !== 'string') {
      outcomes.push({
        sgEventId: sgEventId || '(missing)',
        status: 'invalid',
        reason: 'Missing sg_event_id or event type',
      });
      continue;
    }
    try {
      const persisted = await persistSingleEvent(ev);
      outcomes.push({
        sgEventId,
        status: persisted ? 'persisted' : 'duplicate',
      });
    } catch (err) {
      outcomes.push({
        sgEventId,
        status: 'invalid',
        reason: err instanceof Error ? err.message : 'Failed to persist',
      });
    }
  }
  return outcomes;
}

async function persistSingleEvent(ev: SendGridEvent): Promise<boolean> {
  const sgEventId = ev.sg_event_id!;
  const eventType = ev.event;
  const timestamp = epochToDate(ev.timestamp);
  const email = typeof ev.email === 'string' ? ev.email.toLowerCase().trim() : null;

  // SendGrid flattens custom_args directly onto the event object.
  const campaignId = typeof ev.campaignId === 'string' ? ev.campaignId : null;
  const recipientId = typeof ev.recipientId === 'string' ? ev.recipientId : null;
  const accountKey = typeof ev.accountKey === 'string' ? ev.accountKey : null;

  // Validate recipientId references a real row before we try to FK
  // against it — SendGrid lets clients put any string in custom_args,
  // and a stale recipientId from a deleted campaign would break the
  // insert. Cheap to look up by primary key.
  let recipientIdForRow: string | null = null;
  if (recipientId) {
    const exists = await prisma.emailBlastRecipient.findUnique({
      where: { id: recipientId },
      select: { id: true },
    });
    recipientIdForRow = exists ? recipientId : null;
  }

  // Idempotent persist: existing sgEventId → return false (duplicate).
  const created = await prisma.emailEvent.upsert({
    where: { sgEventId },
    create: {
      sgEventId,
      eventType,
      campaignId,
      recipientId: recipientIdForRow,
      accountKey,
      sgMessageId: typeof ev.sg_message_id === 'string' ? ev.sg_message_id : null,
      email,
      timestamp,
      url: typeof ev.url === 'string' ? ev.url : null,
      reason: typeof ev.reason === 'string' ? ev.reason : null,
      userAgent: typeof ev.useragent === 'string' ? ev.useragent : null,
      ip: typeof ev.ip === 'string' ? ev.ip : null,
      raw: JSON.stringify(ev),
    },
    update: {}, // dedup: no-op on conflict
    select: { createdAt: true, eventType: true },
  });

  // Side effects on first-write only. The upsert select includes
  // createdAt; if it's within a few seconds we know it's the fresh
  // insert path (vs. an upsert no-op replay). Cheap heuristic.
  const isFresh = Date.now() - created.createdAt.getTime() < 5_000;
  if (!isFresh) return false;

  // 1) Update the originating recipient row's status for terminal events
  //    so the campaigns list reflects deliverability without a join.
  if (recipientIdForRow) {
    await maybeUpdateRecipientStatus(recipientIdForRow, eventType, ev);
  }

  // 2) Populate the suppression list for bounce/spam/unsubscribe so the
  //    builder stops trying to send to known-bad addresses.
  const suppressionReason = SUPPRESSION_EVENTS[eventType];
  if (suppressionReason && accountKey && email) {
    await persistSuppression(accountKey, email, suppressionReason, ev);
  }

  return true;
}

async function maybeUpdateRecipientStatus(
  recipientId: string,
  eventType: string,
  ev: SendGridEvent,
): Promise<void> {
  if (eventType === 'bounce' || eventType === 'dropped') {
    const bounceType = typeof ev.type === 'string' ? ev.type : null;
    const isHard = bounceType ? HARD_BOUNCE_TYPES.has(bounceType) : eventType === 'bounce';
    await prisma.emailBlastRecipient.update({
      where: { id: recipientId },
      data: {
        status: 'failed',
        error: `${eventType}${ev.reason ? ': ' + ev.reason : isHard ? ' (hard)' : ''}`,
      },
    });
    return;
  }
  // 'delivered' and 'processed' are informational — we already mark
  // recipients 'sent' synchronously when the SendGrid API returns 202.
  // We deliberately don't overwrite that with 'delivered' status to
  // keep the state machine simple (sent → final).
}

async function persistSuppression(
  accountKey: string,
  email: string,
  reason: string,
  ev: SendGridEvent,
): Promise<void> {
  await prisma.emailSuppression.upsert({
    where: { accountKey_email: { accountKey, email } },
    create: {
      accountKey,
      email,
      reason,
      source: 'sendgrid',
      raw: JSON.stringify({ type: ev.type, reason: ev.reason, url: ev.url }),
    },
    update: {
      // If an earlier suppression existed (e.g. soft bounce upgraded to
      // hard bounce + spam report), refresh the reason but keep the
      // original createdAt so the suppression-age UX stays accurate.
      reason,
      raw: JSON.stringify({ type: ev.type, reason: ev.reason, url: ev.url }),
    },
  });
}
