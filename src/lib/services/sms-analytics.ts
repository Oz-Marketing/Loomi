/**
 * Text-blast analytics — the SMS counterpart to email-analytics.ts.
 *
 * Deliberately narrower than its email sibling, because the channel is. There
 * is no open event and no click event in SMS: not "we don't collect them",
 * they do not exist. Anything this module reported under those names would be
 * invented, so it reports delivery and opt-outs and stops there.
 *
 * ── SCOPING GOES THROUGH RECIPIENTS, NOT THE BLAST ──────────────────────────
 * `SmsBlast.accountKeys` is a JSON-encoded array — one blast can span several
 * sub-accounts — so it can't be filtered in SQL without a LIKE that would match
 * "youngFord" inside "youngFordOfOgden". `SmsBlastRecipient.accountKey` is a
 * real indexed column and is one row per person, which is the grain the numbers
 * are counted at anyway.
 *
 * ── WHY DELIVERY IS COUNTED PER RECIPIENT, NOT PER EVENT ────────────────────
 * Twilio re-sends status callbacks as a message moves queued → sent →
 * delivered. The webhook de-dups on (sid, eventType), so a plain event count is
 * usually right — but a message that fails and is retried produces two SIDs for
 * one person, and counting events would report more deliveries than there were
 * recipients. Counting distinct recipients can't exceed the send.
 */
import { prisma } from '@/lib/prisma';
import { EMPTY_TEXT_COUNTS, type TextCounts } from '@/lib/reporting/blasts';

export interface TextBlastRow {
  campaignId: string;
  campaignName: string | null;
  sentAt: Date | null;
  sent: number;
  delivered: number;
  failed: number;
  optOuts: number;
}

interface Input {
  /** When null, aggregate across every account the caller can see. */
  accountKeys: string[] | null;
  start: Date | null;
  end: Date | null;
}

/** Twilio event types that mean the message did not arrive. */
const FAILURE_EVENTS = ['undelivered', 'failed'];
/** Inbound STOP and its variants. */
const OPT_OUT_EVENTS = ['stop', 'unsub'];

function dateFilter(start: Date | null, end: Date | null) {
  if (!start && !end) return undefined;
  return { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
}

function recipientWhere({ accountKeys, start, end }: Input) {
  const range = dateFilter(start, end);
  return {
    ...(accountKeys ? { accountKey: { in: accountKeys } } : {}),
    ...(range ? { sentAt: range } : {}),
  };
}

function eventWhere({ accountKeys, start, end }: Input) {
  const range = dateFilter(start, end);
  return {
    ...(accountKeys ? { accountKey: { in: accountKeys } } : {}),
    ...(range ? { timestamp: range } : {}),
  };
}

/** Distinct recipients that reached any of `types`. */
async function distinctRecipients(
  where: Record<string, unknown>,
  types: string[],
): Promise<number> {
  const rows = await prisma.smsEvent.findMany({
    where: { ...where, eventType: { in: types }, recipientId: { not: null } },
    distinct: ['recipientId'],
    select: { recipientId: true },
  });
  return rows.length;
}

export async function getTextTotals(input: Input): Promise<TextCounts> {
  const rWhere = recipientWhere(input);
  const eWhere = eventWhere(input);

  const [sent, failedRecipients, campaigns, delivered, failedEvents, optOuts] = await Promise.all([
    prisma.smsBlastRecipient.count({ where: { ...rWhere, status: 'sent' } }),
    prisma.smsBlastRecipient.count({ where: { ...rWhere, status: 'failed' } }),
    prisma.smsBlastRecipient.findMany({
      where: rWhere,
      distinct: ['campaignId'],
      select: { campaignId: true },
    }),
    distinctRecipients(eWhere, ['delivered']),
    distinctRecipients(eWhere, FAILURE_EVENTS),
    // Opt-outs are counted as EVENTS, not distinct recipients: an inbound STOP
    // has no recipientId to be distinct on (it's an unsolicited inbound
    // message), so distinct-on-null would collapse every opt-out into one.
    prisma.smsEvent.count({ where: { ...eWhere, eventType: { in: OPT_OUT_EVENTS } } }),
  ]);

  return {
    ...EMPTY_TEXT_COUNTS,
    campaigns: campaigns.length,
    sent,
    delivered,
    // A recipient the worker never handed to Twilio and one Twilio couldn't
    // deliver are both failures, but they're recorded in different places.
    // Max, not sum: a recipient marked failed locally can also carry a Twilio
    // failure event, and adding them would double-count that person.
    failed: Math.max(failedRecipients, failedEvents),
    optOuts,
  };
}

/** Per-campaign rows for the table. */
export async function getTextBlasts(input: Input): Promise<TextBlastRow[]> {
  const rWhere = recipientWhere(input);

  const grouped = await prisma.smsBlastRecipient.groupBy({
    by: ['campaignId', 'status'],
    where: rWhere,
    _count: { _all: true },
  });
  if (!grouped.length) return [];

  const ids = [...new Set(grouped.map((g) => g.campaignId))];
  const [blasts, deliveredRows, optOutRows, firstSends] = await Promise.all([
    prisma.smsBlast.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, completedAt: true, scheduledFor: true },
    }),
    prisma.smsEvent.findMany({
      where: { campaignId: { in: ids }, eventType: 'delivered', recipientId: { not: null } },
      distinct: ['recipientId'],
      select: { campaignId: true },
    }),
    prisma.smsEvent.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: ids }, eventType: { in: OPT_OUT_EVENTS } },
      _count: { _all: true },
    }),
    // Earliest actual send per campaign — a truer "sent on" than the schedule,
    // which is when someone intended it to go out.
    prisma.smsBlastRecipient.groupBy({
      by: ['campaignId'],
      where: { ...rWhere, sentAt: { not: null } },
      _min: { sentAt: true },
    }),
  ]);

  const meta = new Map(blasts.map((b) => [b.id, b]));
  const optOut = new Map(optOutRows.map((r) => [r.campaignId, r._count._all]));
  const firstSent = new Map(firstSends.map((r) => [r.campaignId, r._min.sentAt]));
  const deliveredBy = new Map<string, number>();
  for (const r of deliveredRows) {
    if (r.campaignId) deliveredBy.set(r.campaignId, (deliveredBy.get(r.campaignId) ?? 0) + 1);
  }

  const statusBy = new Map<string, Map<string, number>>();
  for (const g of grouped) {
    const m = statusBy.get(g.campaignId) ?? new Map<string, number>();
    m.set(g.status, g._count._all);
    statusBy.set(g.campaignId, m);
  }

  return ids.map((id) => {
    const s = statusBy.get(id);
    const b = meta.get(id);
    return {
      campaignId: id,
      campaignName: b?.name ?? null,
      sentAt: firstSent.get(id) ?? b?.completedAt ?? b?.scheduledFor ?? null,
      sent: s?.get('sent') ?? 0,
      delivered: deliveredBy.get(id) ?? 0,
      failed: s?.get('failed') ?? 0,
      optOuts: optOut.get(id) ?? 0,
    };
  });
}
