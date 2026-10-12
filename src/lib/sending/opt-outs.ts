// Recording — and undoing — an opt-out.
//
// EmailSuppression / SmsSuppression rows are what the send path enforces:
// every blast, flow step and 1:1 text checks them, by (accountKey, address),
// before it sends. Contact.dnd is the UI's copy of the same fact and a second
// check for that one contact, but a dnd flag never reaches the rest of the
// group, and it isn't consulted for a contact in another account who shares
// the address.
//
// Every writer used to do its own upsert, and each got a different part wrong:
//   - the manual add, the CRM feed and bulk "Set DND" wrote one account's row
//     (or none at all) when an opt-out belongs to the whole group;
//   - the contact toggle stored the address exactly as the contact held it, so
//     a mixed-case email made a row the lowercased send-time lookup never hit;
//   - an upsert that always overwrote `reason` let a CRM sync relabel a
//     person's own unsubscribe as 'crm-optout' — which staff may clear.
// These helpers are the one way in for everything but the SendGrid and Twilio
// webhooks, which write their own rows (and cascade them). Every reason a
// webhook writes is one staff can't clear, so whatever order the writes land
// in, the toggle's rules below still hold.
//
// A row keeps the `source` that first created it; a stronger write raises its
// `reason` and leaves the source alone — the same convention the SendGrid
// writer follows. So a staff opt-out recorded on top of a bounce reads
// ('manual', 'sendgrid'), and clearing the staff layer gives the bounce back
// instead of deleting it (see clearStaff*OptOuts).

import Papa from 'papaparse';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getRelatedAccountKeys } from '@/lib/services/accounts';
import { chunk, DB_CHUNK } from '@/lib/db/chunk';
import { isLikelyDialablePhone, normalizePhoneNumber } from '@/lib/contact-hygiene';
import {
  normaliseHeaderKey,
  normalisePhone,
  optOutChannels,
  optOutTargetForHeader,
  isOptOutValue,
  parseEmailCell,
  type OptOutChannel,
} from '@/lib/contacts/normalize';

/** The client these helpers write through: the app's, or an open transaction's. */
export type SuppressionClient = Pick<Prisma.TransactionClient, 'emailSuppression' | 'smsSuppression'>;

// ── Reasons and their weight ──

export type EmailOptOutReason = 'spamreport' | 'unsubscribe' | 'manual' | 'crm-optout' | 'bounce';
export type SmsOptOutReason = 'stop' | 'manual' | 'crm-optout' | 'undelivered';

/**
 * How much weight each reason carries:
 *
 *   spamreport > unsubscribe > manual > crm-optout > bounce
 *
 * The person's own word outranks staff, staff outrank a CRM flag, and a bounce
 * — a fact about the mailbox, not a choice anybody made — is weakest. A write
 * may RAISE a row's reason but never lower it. That is not cosmetic: the reason
 * decides what the contact toggle may undo (see `isStaffClearable`), so a
 * downgrade from 'unsubscribe' to 'manual' or 'crm-optout' would let staff
 * resubscribe someone who unsubscribed themselves.
 *
 * SMS has its own words for two rungs: `stop` is the person's own opt-out (it
 * ranks with an unsubscribe; `unsub` is an older spelling of it) and
 * `undelivered` is a carrier refusal (it ranks with a bounce).
 */
const REASON_RANK: Readonly<Record<string, number>> = {
  spamreport: 5,
  unsubscribe: 4,
  stop: 4,
  unsub: 4,
  manual: 3,
  'crm-optout': 2,
  bounce: 1,
  undelivered: 1,
};

/**
 * Where a reason sits. One we don't know ranks above everything, so a value
 * some future writer puts there is never overwritten by code that doesn't
 * understand it.
 */
export function reasonRank(reason: string): number {
  return REASON_RANK[reason] ?? 99;
}

/** The known reasons a write of `reason` may replace — strictly weaker ones. */
export function reasonsWeakerThan(reason: string): string[] {
  const rank = reasonRank(reason);
  return Object.keys(REASON_RANK).filter((r) => REASON_RANK[r] < rank);
}

/**
 * Who first recorded an opt-out — the `source` column. Settings → Suppressions
 * shows it, and it is half of what decides whether the contact toggle may undo
 * a row.
 */
export const OPT_OUT_SOURCE = {
  /** Staff, in Loomi: the contact toggle, bulk Set DND, the contacts API, "Add manually". */
  manual: 'manual',
  /**
   * A file of opt-outs carried over from another system (GoHighLevel, today),
   * through the contact CSV import or Settings → Suppressions → Import. Written
   * with reason 'manual' — it is a deliberate opt-out, not a bounce — but kept
   * apart by its source, because an export can't say whether the person opted
   * out themselves. The contact toggle therefore treats it as theirs and won't
   * clear it; removing an imported email is the explicit "Remove" in Settings →
   * Suppressions.
   */
  import: 'import',
  /** The CRM bridge's dealer opt-out flags. */
  crm: 'oz-reports',
} as const;

// ── Addresses ──

/**
 * The stored form of an email: trimmed and lowercased, which is exactly how
 * the send path looks one up. Null for anything that isn't an address at all.
 */
export function normalizeOptOutEmail(raw: string | null | undefined): string | null {
  const email = String(raw ?? '').trim().toLowerCase();
  return email.includes('@') ? email : null;
}

/**
 * The stored form of a phone: E.164 where the country is knowable (contacts
 * store phones the same way, so the send-time lookup matches), otherwise the
 * bare digits with any leading + kept.
 */
export function normalizeOptOutPhone(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  return normalisePhone(value) || normalizePhoneNumber(value) || null;
}

/**
 * Every spelling a row for this email might be stored under. Rows are written
 * normalized now, but the contact toggle used to store the address verbatim —
 * a lookup or a clear that only tried the normalized form would never find
 * those rows.
 */
function emailSpellings(raw: string): string[] {
  const normalized = normalizeOptOutEmail(raw);
  return unique([raw, raw.trim(), normalized].filter((v): v is string => Boolean(v)));
}

function phoneSpellings(raw: string): string[] {
  const normalized = normalizeOptOutPhone(raw);
  return unique([raw, raw.trim(), normalized].filter((v): v is string => Boolean(v)));
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

// ── Recording ──

export interface RecordOptOutsResult {
  /** The normalized addresses that were recorded, deduped. */
  addresses: string[];
  /** Every account the opt-out now covers: the one it was recorded at, then its group. */
  accountKeys: string[];
  /** Addresses newly suppressed at the account itself — no row was there before. */
  added: number;
  /** Rows newly created at the other accounts in the group. */
  cascaded: number;
  /** Existing rows, anywhere in the group, whose weaker reason was raised to this one. */
  upgraded: number;
}

interface RecordOptOutsOptions<Reason extends string> {
  accountKey: string;
  reason: Reason;
  /** See OPT_OUT_SOURCE. */
  source: string;
  /** Provenance kept on the row (who imported it, from where). Left alone on an existing row when omitted. */
  raw?: string | null;
  /** Write inside an open transaction. */
  tx?: SuppressionClient;
  /**
   * The group, when the caller already resolved it — a loop that records many
   * opt-outs for one account shouldn't re-read the hierarchy each time.
   */
  relatedAccountKeys?: readonly string[];
}

type Channel = 'email' | 'sms';

/**
 * Record opt-outs for many addresses at once, at `accountKey` and every other
 * account in its group — under-propagating an opt-out is a compliance failure
 * (see `relatedKeys` in lib/account-hierarchy).
 *
 * Set-based: per slice, one INSERT … ON CONFLICT DO NOTHING for the account,
 * one for the rest of the group, and one UPDATE that raises any weaker reason.
 * Never a per-row loop — a group's worth of rows for tens of thousands of
 * addresses has to fit in a request.
 */
export async function recordEmailOptOuts(
  options: RecordOptOutsOptions<EmailOptOutReason> & {
    emails: readonly (string | null | undefined)[];
  },
): Promise<RecordOptOutsResult> {
  const addresses = unique(
    options.emails.map(normalizeOptOutEmail).filter((e): e is string => e !== null),
  );
  return writeOptOuts('email', addresses, options);
}

/** As recordEmailOptOuts, for phones (stored E.164). */
export async function recordSmsOptOuts(
  options: RecordOptOutsOptions<SmsOptOutReason> & {
    phones: readonly (string | null | undefined)[];
  },
): Promise<RecordOptOutsResult> {
  const addresses = unique(
    options.phones.map(normalizeOptOutPhone).filter((p): p is string => p !== null),
  );
  return writeOptOuts('sms', addresses, options);
}

/** Record one email opt-out, cascaded to the group. */
export async function recordEmailOptOut(
  options: RecordOptOutsOptions<EmailOptOutReason> & { email: string | null | undefined },
): Promise<RecordOptOutsResult> {
  const { email, ...rest } = options;
  return recordEmailOptOuts({ ...rest, emails: [email] });
}

/** Record one SMS opt-out, cascaded to the group. */
export async function recordSmsOptOut(
  options: RecordOptOutsOptions<SmsOptOutReason> & { phone: string | null | undefined },
): Promise<RecordOptOutsResult> {
  const { phone, ...rest } = options;
  return recordSmsOptOuts({ ...rest, phones: [phone] });
}

/** The account first, then the rest of its group, deduped. */
async function groupKeys(accountKey: string, related?: readonly string[]): Promise<string[]> {
  const others = related ?? (await getRelatedAccountKeys(accountKey));
  return unique([accountKey, ...others]);
}

async function writeOptOuts(
  channel: Channel,
  addresses: string[],
  options: RecordOptOutsOptions<string>,
): Promise<RecordOptOutsResult> {
  const { accountKey, reason, source } = options;
  const db = options.tx ?? prisma;
  const accountKeys = await groupKeys(accountKey, options.relatedAccountKeys);
  const result: RecordOptOutsResult = {
    addresses,
    accountKeys,
    added: 0,
    cascaded: 0,
    upgraded: 0,
  };
  if (addresses.length === 0) return result;

  const others = accountKeys.slice(1);
  const weaker = reasonsWeakerThan(reason);
  const raw = options.raw;

  // Size each pass so the group-wide INSERT stays at DB_CHUNK rows — about
  // eight bind parameters a row, far inside Postgres's 65,535 cap.
  const perPass = Math.max(1, Math.floor(DB_CHUNK / accountKeys.length));

  for (const slice of chunk(addresses, perPass)) {
    // The account's own rows go in alone, so the inserted count IS the number
    // of addresses that weren't already suppressed there — the figure an
    // import reports as "added".
    const own = slice.map((address) => ({ accountKey, address }));
    result.added += await insertRows(db, channel, own, reason, source, raw);

    if (others.length > 0) {
      const cascade = others.flatMap((key) => slice.map((address) => ({ accountKey: key, address })));
      result.cascaded += await insertRows(db, channel, cascade, reason, source, raw);
    }

    // Raise rows that already existed with a weaker reason. Rows the INSERTs
    // above just created carry `reason` itself, so they aren't touched twice.
    // The source is left alone: it says who first recorded the row.
    const withRaw = raw !== undefined ? { raw } : {};
    if (weaker.length > 0) {
      const match = { reason: { in: weaker } };
      result.upgraded += await updateRows(db, channel, accountKeys, slice, match, {
        reason,
        ...withRaw,
      });
    }

    // Same weight, but staff could undo the existing row and can't undo this
    // one — an import naming someone staff had already opted out. The import
    // takes the row over; otherwise staff turning their own toggle off would
    // quietly drop (or hand back to a bounce) an opt-out that may have been
    // the person's own.
    if (claimsStaffRows(reason, source)) {
      const match = { reason, source: { in: [...STAFF_SOURCES, ...WEBHOOK_SOURCES] } };
      result.upgraded += await updateRows(db, channel, accountKeys, slice, match, {
        source,
        ...withRaw,
      });
    }
  }

  return result;
}

/** Does a (reason, source) write take over equal-weight rows staff could clear? */
function claimsStaffRows(reason: string, source: string): boolean {
  return STAFF_REASONS.has(reason) && !isStaffClearable({ reason, source });
}

async function updateRows(
  db: SuppressionClient,
  channel: Channel,
  accountKeys: readonly string[],
  slice: readonly string[],
  match: { reason: string | { in: string[] }; source?: string | { in: string[] } },
  data: { reason?: string; source?: string; raw?: string | null },
): Promise<number> {
  const updated =
    channel === 'email'
      ? await db.emailSuppression.updateMany({
          where: { accountKey: { in: [...accountKeys] }, email: { in: [...slice] }, ...match },
          data,
        })
      : await db.smsSuppression.updateMany({
          where: { accountKey: { in: [...accountKeys] }, phone: { in: [...slice] }, ...match },
          data,
        });
  return updated.count;
}

async function insertRows(
  db: SuppressionClient,
  channel: Channel,
  rows: { accountKey: string; address: string }[],
  reason: string,
  source: string,
  raw: string | null | undefined,
): Promise<number> {
  if (rows.length === 0) return 0;
  const extra = raw !== undefined ? { raw } : {};
  const created =
    channel === 'email'
      ? await db.emailSuppression.createMany({
          data: rows.map((r) => ({ accountKey: r.accountKey, email: r.address, reason, source, ...extra })),
          skipDuplicates: true,
        })
      : await db.smsSuppression.createMany({
          data: rows.map((r) => ({ accountKey: r.accountKey, phone: r.address, reason, source, ...extra })),
          skipDuplicates: true,
        });
  return created.count;
}

// ── Undoing: what staff may clear ──

// What staff — and the dealer's CRM, which staff stand in for — record: the
// only reasons the toggle may undo, and only on rows those writers created.
const STAFF_REASONS: ReadonlySet<string> = new Set(['manual', 'crm-optout']);
const STAFF_SOURCES: ReadonlySet<string> = new Set([OPT_OUT_SOURCE.manual, OPT_OUT_SOURCE.crm]);

// The webhooks. A staff reason on one of their rows is a staff opt-out
// recorded on top of a bounce (the only webhook reason weaker than a staff
// one), and clearing it gives the bounce back.
const WEBHOOK_SOURCES: ReadonlySet<string> = new Set(['sendgrid', 'twilio']);
const WEBHOOK_FLOOR: Record<Channel, string> = { email: 'bounce', sms: 'undelivered' };

/**
 * Rows staff may clear from the contact toggle (or bulk "DND off"): what staff
 * set here, and what the CRM bridge set. Never the person's own opt-out — an
 * unsubscribe, a spam report, a STOP reply can't be undone by staff (CAN-SPAM,
 * TCPA) — never a bounce, and never an import, which may have been the
 * person's own opt-out in the system it came from.
 */
export function isStaffClearable(row: { reason: string; source: string }): boolean {
  return STAFF_REASONS.has(row.reason) && STAFF_SOURCES.has(row.source);
}

/** Why a row can't be cleared from the contact toggle. */
export type OptOutLock = 'unsubscribed' | 'spam' | 'bounced' | 'imported' | 'other';

/** The lock a row puts on the toggle, or null when staff may clear it. */
export function optOutLock(row: { reason: string; source: string }): OptOutLock | null {
  if (isStaffClearable(row)) return null;
  switch (row.reason) {
    case 'spamreport':
      return 'spam';
    case 'unsubscribe':
    case 'stop':
    case 'unsub':
      return 'unsubscribed';
    case 'bounce':
    case 'undelivered':
      return 'bounced';
  }
  if (row.source === OPT_OUT_SOURCE.import) return 'imported';
  // A staff opt-out on top of a bounce: clearing it leaves the bounce.
  if (STAFF_REASONS.has(row.reason) && WEBHOOK_SOURCES.has(row.source)) return 'bounced';
  return 'other';
}

/** The lock to explain when several rows hold an address: the strongest reason wins. */
export function strongestLock(rows: readonly { reason: string; source: string }[]): OptOutLock | null {
  let best: { rank: number; lock: OptOutLock } | null = null;
  for (const row of rows) {
    const lock = optOutLock(row);
    if (!lock) continue;
    const rank = reasonRank(row.reason);
    if (!best || rank > best.rank) best = { rank, lock };
  }
  return best?.lock ?? null;
}

/** A suppression row, as the toggle needs to see it. */
export interface SuppressionRowRef {
  accountKey: string;
  address: string;
  reason: string;
  source: string;
}

export interface ClearOptOutsResult {
  accountKeys: string[];
  /** Rows deleted across the group. */
  removed: number;
  /** Staff opt-outs that sat on a webhook bounce, handed back to the bounce. */
  restored: number;
  /** Rows still holding these addresses anywhere in the group — the ones staff can't clear. */
  remaining: SuppressionRowRef[];
}

interface ClearOptOutsOptions {
  accountKey: string;
  tx?: SuppressionClient;
  relatedAccountKeys?: readonly string[];
}

/**
 * Clear the email opt-outs staff own for these addresses, across the group, and
 * report what's left. Symmetric with recording: an opt-out recorded at one
 * account was cascaded to all of them, so clearing it clears all of them.
 *
 * A staff opt-out that was recorded on top of a webhook bounce isn't deleted —
 * the row goes back to being the bounce it was, so the address stays
 * suppressed for the reason that still applies.
 */
export async function clearStaffEmailOptOuts(
  options: ClearOptOutsOptions & { emails: readonly (string | null | undefined)[] },
): Promise<ClearOptOutsResult> {
  const spellings = unique(options.emails.flatMap((e) => (e ? emailSpellings(e) : [])));
  return clearOptOuts('email', spellings, options);
}

/** As clearStaffEmailOptOuts, for phones. */
export async function clearStaffSmsOptOuts(
  options: ClearOptOutsOptions & { phones: readonly (string | null | undefined)[] },
): Promise<ClearOptOutsResult> {
  const spellings = unique(options.phones.flatMap((p) => (p ? phoneSpellings(p) : [])));
  return clearOptOuts('sms', spellings, options);
}

async function clearOptOuts(
  channel: Channel,
  spellings: string[],
  options: ClearOptOutsOptions,
): Promise<ClearOptOutsResult> {
  const db = options.tx ?? prisma;
  const accountKeys = await groupKeys(options.accountKey, options.relatedAccountKeys);
  const result: ClearOptOutsResult = { accountKeys, removed: 0, restored: 0, remaining: [] };
  if (spellings.length === 0) return result;

  const staffRows = { reason: { in: [...STAFF_REASONS] }, source: { in: [...STAFF_SOURCES] } };
  const overBounce = { reason: { in: [...STAFF_REASONS] }, source: { in: [...WEBHOOK_SOURCES] } };
  const perPass = Math.max(1, Math.floor(DB_CHUNK / accountKeys.length));
  for (const slice of chunk(spellings, perPass)) {
    const removed =
      channel === 'email'
        ? await db.emailSuppression.deleteMany({
            where: { accountKey: { in: accountKeys }, email: { in: slice }, ...staffRows },
          })
        : await db.smsSuppression.deleteMany({
            where: { accountKey: { in: accountKeys }, phone: { in: slice }, ...staffRows },
          });
    result.removed += removed.count;
    result.restored += await updateRows(db, channel, accountKeys, slice, overBounce, {
      reason: WEBHOOK_FLOOR[channel],
    });
  }

  result.remaining = await findSuppressionRows(db, channel, accountKeys, spellings);
  return result;
}

async function findSuppressionRows(
  db: SuppressionClient,
  channel: Channel,
  accountKeys: readonly string[],
  spellings: readonly string[],
): Promise<SuppressionRowRef[]> {
  const out: SuppressionRowRef[] = [];
  for (const slice of chunk(spellings, DB_CHUNK)) {
    if (channel === 'email') {
      const rows = await db.emailSuppression.findMany({
        where: { accountKey: { in: [...accountKeys] }, email: { in: slice } },
        select: { accountKey: true, email: true, reason: true, source: true },
      });
      for (const r of rows) {
        out.push({ accountKey: r.accountKey, address: r.email, reason: r.reason, source: r.source });
      }
    } else {
      const rows = await db.smsSuppression.findMany({
        where: { accountKey: { in: [...accountKeys] }, phone: { in: slice } },
        select: { accountKey: true, phone: true, reason: true, source: true },
      });
      for (const r of rows) {
        out.push({ accountKey: r.accountKey, address: r.phone, reason: r.reason, source: r.source });
      }
    }
  }
  return out;
}

// ── One contact's opt-out state ──

export interface DndFlags {
  email?: boolean;
  sms?: boolean;
}

/** Read a Contact.dnd JSON cell. Anything that isn't `{ email?: bool, sms?: bool }` reads as no flags. */
export function readDndFlags(value: unknown): DndFlags {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  const out: DndFlags = {};
  if (typeof row.email === 'boolean') out.email = row.email;
  if (typeof row.sms === 'boolean') out.sms = row.sms;
  return out;
}

/**
 * Merge an incoming dnd onto a contact's existing one, where an opt-out is
 * sticky: an incoming `true` always lands, but an incoming `false` never
 * clears an existing `true`.
 *
 * A feed or a file saying "not opted out" is describing ITS system — it is no
 * evidence the person resubscribed, and it must not erase an opt-out recorded
 * in Loomi (the contact toggle, a STOP reply, an earlier feed). Undoing an
 * opt-out is a deliberate act with its own rules; see clearStaff*OptOuts.
 * Keys other than email/sms on the existing value are kept as they were.
 */
export function mergeStickyDnd(
  existing: unknown,
  incoming: DndFlags | null | undefined,
): Prisma.InputJsonObject {
  // The existing value came out of a Json column, so whatever else it holds
  // is already JSON.
  const prior: Record<string, Prisma.InputJsonValue | null> =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, Prisma.InputJsonValue | null>) }
      : {};
  if (!incoming) return prior;
  for (const channel of ['email', 'sms'] as const) {
    const next = incoming[channel];
    if (typeof next !== 'boolean') continue;
    if (next || prior[channel] !== true) prior[channel] = next;
  }
  return prior;
}

/** One channel of a contact's opt-out state, as the contact page shows it. */
export interface ChannelOptOutState {
  /** Sends on this channel are blocked for this contact. */
  optedOut: boolean;
  /** Contact.dnd's flag for the channel. */
  flag: boolean;
  /** The suppression rows at the contact's account that hold its address. */
  rows: { reason: string; source: string }[];
  /** Set when a row there can't be cleared from the toggle — why. */
  lockedBy: OptOutLock | null;
}

export interface ContactOptOutState {
  email: ChannelOptOutState;
  sms: ChannelOptOutState;
}

/**
 * Combine the dnd flag with the suppression rows into what the toggle shows.
 * A row alone is enough to be opted out: a webhook unsubscribe or a bounce
 * writes a row and never touches the flag, and the send path honors either.
 */
export function channelOptOutState(
  flag: boolean,
  rows: readonly { reason: string; source: string }[],
): ChannelOptOutState {
  const refs = rows.map((r) => ({ reason: r.reason, source: r.source }));
  return { optedOut: flag || refs.length > 0, flag, rows: refs, lockedBy: strongestLock(refs) };
}

/** A contact's opt-out state at its own account: flag plus suppression rows, per channel. */
export async function loadContactOptOutState(
  contact: { accountKey: string; email: string | null; phone: string | null; dnd: unknown },
  db: SuppressionClient = prisma,
): Promise<ContactOptOutState> {
  const flags = readDndFlags(contact.dnd);
  const [emailRows, smsRows] = await Promise.all([
    contact.email
      ? findSuppressionRows(db, 'email', [contact.accountKey], emailSpellings(contact.email))
      : Promise.resolve([]),
    contact.phone
      ? findSuppressionRows(db, 'sms', [contact.accountKey], phoneSpellings(contact.phone))
      : Promise.resolve([]),
  ]);
  return {
    email: channelOptOutState(flags.email === true, emailRows),
    sms: channelOptOutState(flags.sms === true, smsRows),
  };
}

export interface ContactOptOutChange {
  accountKeys: string[];
  /** Per channel that was changed: the rows holding the address afterwards, across the group. */
  rows: { email?: SuppressionRowRef[]; sms?: SuppressionRowRef[] };
}

/**
 * Turn one contact's opt-out on or off, per channel — the contact toggle's
 * rules, shared with every path that edits a single contact's dnd.
 *
 *   on  → a 'manual' opt-out for the contact's address, across the group.
 *   off → clears only what staff may clear (isStaffClearable), across the
 *         group. The person's own unsubscribe / STOP / spam report, a bounce,
 *         an import — those stay, and the caller keeps the flag on for them.
 *
 * Writes suppression rows only; the caller owns Contact.dnd (see dndAfterChange).
 */
export async function applyContactOptOutChange(options: {
  accountKey: string;
  email: string | null;
  phone: string | null;
  patch: DndFlags;
  tx?: SuppressionClient;
  relatedAccountKeys?: readonly string[];
}): Promise<ContactOptOutChange> {
  const { accountKey, email, phone, patch, tx } = options;
  const related = options.relatedAccountKeys ?? (await getRelatedAccountKeys(accountKey));
  const accountKeys = unique([accountKey, ...related]);
  const db = tx ?? prisma;
  const change: ContactOptOutChange = { accountKeys, rows: {} };
  const shared = { accountKey, tx, relatedAccountKeys: related };

  if (patch.email !== undefined && email) {
    if (patch.email) {
      await recordEmailOptOut({ ...shared, email, reason: 'manual', source: OPT_OUT_SOURCE.manual });
      change.rows.email = await findSuppressionRows(db, 'email', accountKeys, emailSpellings(email));
    } else {
      change.rows.email = (await clearStaffEmailOptOuts({ ...shared, emails: [email] })).remaining;
    }
  }

  if (patch.sms !== undefined && phone) {
    if (patch.sms) {
      await recordSmsOptOut({ ...shared, phone, reason: 'manual', source: OPT_OUT_SOURCE.manual });
      change.rows.sms = await findSuppressionRows(db, 'sms', accountKeys, phoneSpellings(phone));
    } else {
      change.rows.sms = (await clearStaffSmsOptOuts({ ...shared, phones: [phone] })).remaining;
    }
  }

  return change;
}

/**
 * The dnd flags a contact at `accountKey` should carry after a change. A
 * channel turned on is on. A channel turned off stays on while any row still
 * holds the address at that account — the flag is the UI's copy of "opted
 * out", and someone who unsubscribed themselves still is.
 */
export function dndAfterChange(
  current: unknown,
  patch: DndFlags,
  change: ContactOptOutChange,
  accountKey: string,
): DndFlags {
  const flags = readDndFlags(current);
  for (const channel of ['email', 'sms'] as const) {
    const requested = patch[channel];
    if (requested === undefined) continue;
    const held = (change.rows[channel] ?? []).some((r) => r.accountKey === accountKey);
    flags[channel] = requested || held;
  }
  return flags;
}

// ── Bringing opt-outs over from another system ──

/** What a pasted list or an uploaded file of opt-outs comes down to. */
export interface OptOutListParse {
  /** Distinct emails to opt out, normalized. */
  emails: string[];
  /** Distinct phones to opt out, E.164 where possible. */
  phones: string[];
  /** How many values couldn't be read as an email or a phone. */
  invalidCount: number;
  /** A few of them, to show the person what was skipped. */
  invalidSamples: string[];
  /** The columns read as opt-out flags (a full contact export, rather than a list). */
  optOutColumns: string[];
  /** Rows those columns said had NOT opted out — skipped, not suppressed. */
  notOptedOutRows: number;
  /** Data rows read (excluding a header). */
  rowCount: number;
  hasHeader: boolean;
}

const INVALID_SAMPLE_LIMIT = 10;

// Email-shaped substrings, so "Jane Doe <jane@x.com>" pasted from a mail
// client yields the address rather than an error.
const EMAIL_IN_TEXT = /[^\s<>"'(),;|:[\]]+@[^\s<>"'(),;|:[\]]+/g;

// A value that could be a phone: digits and the punctuation people write
// phones with. Anything with letters isn't one (an extension, a name).
const PHONE_LIKE = /^\+?[\d\s().\-/]+$/;

type ColumnKind = 'email' | 'phone' | 'any';

function addressColumnKind(header: string): 'email' | 'phone' | null {
  const key = normaliseHeaderKey(header);
  if (!key) return null;
  if (key.includes('email') || key === 'mail') return 'email';
  if (
    key.includes('phone') ||
    ['mobile', 'cell', 'tel', 'telephone', 'sms', 'text', 'mobilenumber', 'cellnumber'].includes(key)
  ) {
    return 'phone';
  }
  return null;
}

/** A phone we'd store: normalized and plausibly dialable. Null otherwise. */
export function parseOptOutPhone(raw: string): string | null {
  const value = raw.trim();
  if (!value || !PHONE_LIKE.test(value) || !isLikelyDialablePhone(value)) return null;
  return normalizeOptOutPhone(value);
}

/** A single email we'd store: exactly one well-formed address. Null otherwise. */
export function parseOptOutEmail(raw: string): string | null {
  const cell = parseEmailCell(raw);
  if (cell.addresses.length !== 1 || cell.dropped.length > 0) return null;
  return cell.addresses[0];
}

/**
 * Read a pasted list, or an uploaded CSV, of opt-outs.
 *
 * Two shapes are expected:
 *   - a LIST: emails and/or phone numbers, one per line or comma-separated.
 *     Everything on it is an opt-out.
 *   - an EXPORT with a header row (GoHighLevel's contact export, say). The
 *     address columns are found by header. If the file also has opt-out
 *     columns ("DND", "Email DND"…), they decide row by row who opted out of
 *     what — so uploading a whole contact export suppresses the people marked
 *     DND, not the entire list. Without such columns every row is an opt-out.
 *
 * Pure: no database. The route adds "already suppressed" and the group.
 */
export function parseOptOutList(text: string): OptOutListParse {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, '').trim(), {
    skipEmptyLines: 'greedy',
  });
  const rows = (parsed.data as unknown[]).filter(Array.isArray) as string[][];

  const out: OptOutListParse = {
    emails: [],
    phones: [],
    invalidCount: 0,
    invalidSamples: [],
    optOutColumns: [],
    notOptedOutRows: 0,
    rowCount: 0,
    hasHeader: false,
  };
  if (rows.length === 0) return out;

  const emails = new Set<string>();
  const phones = new Set<string>();
  const first = rows[0].map((c) => String(c ?? '').trim());
  out.hasHeader = looksLikeHeader(first, rows.length);

  if (!out.hasHeader) {
    // A list: every cell is a value, everything on it is an opt-out.
    const invalid: string[] = [];
    for (const row of rows) {
      for (const cell of row) readAnyCell(String(cell ?? ''), emails, phones, invalid);
    }
    out.rowCount = rows.length;
    return finish(out, emails, phones, invalid);
  }

  // An export: classify the columns by header.
  const optOutCols: { index: number; channels: OptOutChannel[] }[] = [];
  const addressCols: { index: number; kind: ColumnKind }[] = [];
  first.forEach((header, index) => {
    const target = optOutTargetForHeader(header);
    if (target) {
      optOutCols.push({ index, channels: optOutChannels(target) });
      out.optOutColumns.push(header);
      return;
    }
    const kind = addressColumnKind(header);
    if (kind) addressCols.push({ index, kind });
  });
  // No column named like an address: read every non-flag column by content.
  if (addressCols.length === 0) {
    const flagIndexes = new Set(optOutCols.map((c) => c.index));
    first.forEach((_, index) => {
      if (!flagIndexes.has(index)) addressCols.push({ index, kind: 'any' });
    });
  }

  // Invalid values are tallied per column and only kept for columns that held
  // at least one real address: a column like "Email Opt In" (true/false) or
  // "Name" is not an address column, and its values aren't failed addresses.
  const validByColumn = new Map<number, number>();
  const invalidByColumn = new Map<number, string[]>();

  for (const row of rows.slice(1)) {
    out.rowCount += 1;
    let channels: Set<OptOutChannel>;
    if (optOutCols.length > 0) {
      channels = new Set();
      for (const col of optOutCols) {
        if (isOptOutValue(row[col.index])) col.channels.forEach((c) => channels.add(c));
      }
      if (channels.size === 0) {
        out.notOptedOutRows += 1;
        continue;
      }
    } else {
      channels = new Set<OptOutChannel>(['email', 'sms']);
    }

    for (const col of addressCols) {
      // A row opted out of SMS only says nothing about its email column.
      if (col.kind === 'email' && !channels.has('email')) continue;
      if (col.kind === 'phone' && !channels.has('sms')) continue;
      const cell = String(row[col.index] ?? '').trim();
      if (!cell) continue;

      const invalid = invalidByColumn.get(col.index) ?? [];
      const found = { emails: new Set<string>(), phones: new Set<string>() };
      if (col.kind === 'email') readEmailCell(cell, found.emails, invalid);
      else if (col.kind === 'phone') readPhoneCell(cell, found.phones, invalid);
      else readAnyCell(cell, found.emails, found.phones, invalid);
      invalidByColumn.set(col.index, invalid);

      if (channels.has('email')) found.emails.forEach((e) => emails.add(e));
      if (channels.has('sms')) found.phones.forEach((p) => phones.add(p));
      const valid = found.emails.size + found.phones.size;
      if (valid > 0) validByColumn.set(col.index, (validByColumn.get(col.index) ?? 0) + valid);
    }
  }

  const invalid: string[] = [];
  for (const [index, values] of invalidByColumn) {
    if ((validByColumn.get(index) ?? 0) > 0) invalid.push(...values);
  }
  return finish(out, emails, phones, invalid);
}

function finish(
  out: OptOutListParse,
  emails: Set<string>,
  phones: Set<string>,
  invalid: string[],
): OptOutListParse {
  out.emails = [...emails];
  out.phones = [...phones];
  out.invalidCount = invalid.length;
  out.invalidSamples = invalid.slice(0, INVALID_SAMPLE_LIMIT);
  return out;
}

/**
 * Is the first row a header? Not when it already holds an address — that's a
 * list. Otherwise yes when a cell names a column we know, or when there's more
 * than one row (a first row of non-addresses is a label, not data).
 */
function looksLikeHeader(first: string[], rowCount: number): boolean {
  const holdsAddress = first.some((cell) => {
    const found = { emails: new Set<string>(), phones: new Set<string>() };
    readAnyCell(cell, found.emails, found.phones, []);
    return found.emails.size + found.phones.size > 0;
  });
  if (holdsAddress) return false;
  const namesAColumn = first.some(
    (cell) => optOutTargetForHeader(cell) !== null || addressColumnKind(cell) !== null,
  );
  return namesAColumn || rowCount > 1;
}

function readEmailCell(cell: string, emails: Set<string>, invalid: string[]): void {
  const parsed = parseEmailCell(cell);
  parsed.addresses.forEach((a) => emails.add(a));
  invalid.push(...parsed.dropped);
}

function readPhoneCell(cell: string, phones: Set<string>, invalid: string[]): void {
  for (const part of cell.split(/[,;|]/)) {
    const value = part.trim();
    if (!value) continue;
    const phone = parseOptOutPhone(value);
    if (phone) phones.add(phone);
    else invalid.push(value);
  }
}

/** A cell of unknown kind: each comma/semicolon/pipe-separated part is an email, a phone, or invalid. */
function readAnyCell(
  cell: string,
  emails: Set<string>,
  phones: Set<string>,
  invalid: string[],
): void {
  for (const part of cell.split(/[,;|\t]/)) {
    const value = part.trim();
    if (!value) continue;
    if (value.includes('@')) {
      const candidates = value.match(EMAIL_IN_TEXT) ?? [];
      const valid = candidates.map(parseOptOutEmail).filter((e): e is string => e !== null);
      if (valid.length > 0) valid.forEach((e) => emails.add(e));
      else invalid.push(value);
      continue;
    }
    const phone = parseOptOutPhone(value);
    if (phone) phones.add(phone);
    else invalid.push(value);
  }
}
