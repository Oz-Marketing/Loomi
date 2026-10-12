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
 * ── ONE COHORT ──────────────────────────────────────────────────────────────
 * Totals and per-blast rows are counted over the same recipient rows, the
 * same way email-analytics.ts does: Sent is everything Twilio accepted
 * (including texts a carrier refused afterwards), and Failed is everything
 * that didn't reach a handset — never handed over, or refused.
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
import { blastSourceWhere, type BlastSourceFilter } from './email-blasts';

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
  /**
   * Which sends count: one-off blasts (default — the Reporting page shows flow
   * texts in their own section, and email reporting already leaves them out
   * here), flow texts, or both.
   */
  source?: BlastSourceFilter;
}

/** Inbound STOP and its variants. */
const OPT_OUT_EVENTS = ['stop', 'unsub'];
/** Twilio accepted it: sent on, or refused afterwards by the carrier. */
const ACCEPTED = ['sent', 'undelivered'];
/** Didn't reach the handset: never handed to Twilio, or refused by the carrier. */
const NOT_DELIVERED = ['failed', 'undelivered'];

function dateFilter(start: Date | null, end: Date | null) {
  if (!start && !end) return undefined;
  return { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
}

/**
 * The recipients a report covers — its cohort. Every number below is counted
 * over these rows, so a blast's row and the totals always add up.
 *
 * A text that was never handed to Twilio has no `sentAt`; it is dated by its
 * last update instead. Filtering on `sentAt` alone put failed texts in no
 * window at all, so a date range never showed a failure.
 */
function recipientWhere({ accountKeys, start, end, source = 'blasts' }: Input) {
  const range = dateFilter(start, end);
  return {
    ...(accountKeys ? { accountKey: { in: accountKeys } } : {}),
    ...(source === 'all' ? {} : { campaign: blastSourceWhere(source) }),
    ...(range ? { OR: [{ sentAt: range }, { sentAt: null, updatedAt: range }] } : {}),
  };
}

/** Inbound STOPs carry no recipient — scoped by account and event time. */
function optOutWhere({ accountKeys, start, end }: Input) {
  const range = dateFilter(start, end);
  return {
    eventType: { in: OPT_OUT_EVENTS },
    ...(accountKeys ? { accountKey: { in: accountKeys } } : {}),
    ...(range ? { timestamp: range } : {}),
  };
}

export async function getTextTotals(input: Input): Promise<TextCounts> {
  const rWhere = recipientWhere(input);

  const [sent, notDelivered, campaigns, delivered, optOuts] = await Promise.all([
    prisma.smsBlastRecipient.count({ where: { ...rWhere, status: { in: ACCEPTED } } }),
    prisma.smsBlastRecipient.count({ where: { ...rWhere, status: { in: NOT_DELIVERED } } }),
    prisma.smsBlastRecipient.findMany({
      where: rWhere,
      distinct: ['campaignId'],
      select: { campaignId: true },
    }),
    // Distinct recipients in the cohort with a delivery receipt — Twilio
    // re-sends callbacks, and a retried message has two SIDs for one person.
    prisma.smsEvent.findMany({
      where: { eventType: 'delivered', recipient: rWhere },
      distinct: ['recipientId'],
      select: { recipientId: true },
    }),
    // Counted as EVENTS: an inbound STOP has no recipientId to be distinct on.
    prisma.smsEvent.count({ where: optOutWhere(input) }),
  ]);

  return {
    ...EMPTY_TEXT_COUNTS,
    campaigns: campaigns.length,
    sent,
    delivered: delivered.length,
    failed: notDelivered,
    optOuts,
  };
}

/** Per-campaign rows for the table — over the same cohort as the totals. */
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
      where: { eventType: 'delivered', recipient: rWhere },
      distinct: ['recipientId'],
      select: { campaignId: true },
    }),
    prisma.smsEvent.groupBy({
      by: ['campaignId'],
      where: { ...optOutWhere(input), campaignId: { in: ids } },
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
  const countOf = (m: Map<string, number> | undefined, statuses: string[]) =>
    statuses.reduce((n, status) => n + (m?.get(status) ?? 0), 0);

  return ids.map((id) => {
    const s = statusBy.get(id);
    const b = meta.get(id);
    return {
      campaignId: id,
      campaignName: b?.name ?? null,
      sentAt: firstSent.get(id) ?? b?.completedAt ?? b?.scheduledFor ?? null,
      sent: countOf(s, ACCEPTED),
      delivered: deliveredBy.get(id) ?? 0,
      failed: countOf(s, NOT_DELIVERED),
      optOuts: optOut.get(id) ?? 0,
    };
  });
}
