/**
 * Direct Mail ROI — port of Oz Dealer Tools' ServiceMailerReport (and the
 * multi-campaign roll-up its Summary variant produced).
 *
 * ── WHY THE MATCH ISN'T DONE HERE ───────────────────────────────────────────
 * Unlike every other dealer report, Loomi does not compute this one from raw
 * rows. The matchback joins mailed recipients to repair orders on `custno` —
 * the DMS customer number — and Loomi has no custno anywhere. `ContactEvent`
 * keys on `contactId`, resolved by email/phone at ingest; the mail file and the
 * RO share only the DMS's identifier. The join therefore runs on the Oz Reports
 * host, where both databases and the key live, and `MailerCampaign` stores its
 * result. See the model comment.
 *
 * What IS computed here is everything downstream of the match: rates, per-RO
 * averages, roll-ups across campaigns, and the one thing ODT never had — cost.
 *
 * ── THE REPORT IS CALLED ROI AND ODT NEVER COMPUTED ONE ─────────────────────
 * ODT's "Service Mailer ROI" reports attributed revenue, matched ROs, and
 * per-RO averages. It has no campaign cost anywhere, so it cannot and does not
 * produce a return: revenue alone is not ROI, and calling it that has probably
 * flattered a few campaigns.
 *
 * Loomi does hold the spend — direct mail is a budget channel, and
 * `BudgetLine` carries what the client was charged. So `withRoi` computes a
 * real return when a cost is supplied and leaves it NULL when one isn't,
 * rather than falling back to revenue and relabelling it. A null ROI means
 * "nobody has told us what this cost", which is a fixable data gap; a
 * confident wrong number is not.
 */
import { prisma } from '@/lib/prisma';

export interface CampaignRow {
  id: string;
  campaignName: string;
  mailerType: string | null;
  mailedFrom: string;
  mailedTo: string;
  marketed: number;
  engaged: number;
  offerRequests: number | null;
  matchedCustomers: number;
  matchedRos: number;
  directMatches: number;
  indirectMatches: number;
  customerPay: number;
  warrantyPay: number;
}

export interface CampaignMetrics extends CampaignRow {
  /** Attributed revenue: customer pay + warranty pay. */
  revenue: number;
  /** Share of mailed recipients who came in, 0–100. Null when none mailed. */
  matchbackRate: number | null;
  /** Share of mailed recipients who visited their PURL, 0–100. */
  engagementRate: number | null;
  /** Mean revenue per matched RO. Null when nothing matched. */
  revenuePerRo: number | null;
  /** Attributed revenue per piece mailed. Null when none mailed. */
  revenuePerPiece: number | null;
}

export interface RoiResult {
  cost: number | null;
  /** revenue − cost. Null without a cost. */
  net: number | null;
  /** (revenue − cost) / cost × 100. Null without a cost. */
  roiPct: number | null;
  /** Cost per matched RO. Null without a cost, or with no matches. */
  costPerRo: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const rate = (part: number, whole: number) => (whole > 0 ? round1((part / whole) * 100) : null);

export function withMetrics(row: CampaignRow): CampaignMetrics {
  const revenue = round2(num(row.customerPay) + num(row.warrantyPay));
  return {
    ...row,
    revenue,
    matchbackRate: rate(num(row.matchedCustomers), num(row.marketed)),
    engagementRate: rate(num(row.engaged), num(row.marketed)),
    revenuePerRo: num(row.matchedRos) > 0 ? round2(revenue / num(row.matchedRos)) : null,
    revenuePerPiece: num(row.marketed) > 0 ? round2(revenue / num(row.marketed)) : null,
  };
}

/**
 * Return, given a cost the caller supplies.
 *
 * A zero cost is treated as no cost rather than as infinite return: a campaign
 * recorded at $0 is almost always one nobody costed, and dividing by it would
 * publish Infinity as a result.
 */
export function withRoi(revenue: number, matchedRos: number, cost: number | null): RoiResult {
  if (cost === null || cost <= 0) {
    return { cost: cost === null ? null : round2(cost), net: null, roiPct: null, costPerRo: null };
  }
  return {
    cost: round2(cost),
    net: round2(revenue - cost),
    roiPct: round1(((revenue - cost) / cost) * 100),
    costPerRo: matchedRos > 0 ? round2(cost / matchedRos) : null,
  };
}

export interface MailerTotals {
  campaigns: number;
  marketed: number;
  engaged: number;
  matchedCustomers: number;
  matchedRos: number;
  directMatches: number;
  indirectMatches: number;
  revenue: number;
  matchbackRate: number | null;
  engagementRate: number | null;
  revenuePerRo: number | null;
  revenuePerPiece: number | null;
}

/**
 * Roll several campaigns into one set of totals.
 *
 * Rates are recomputed from the summed parts, never averaged across campaigns:
 * a 500-piece campaign and a 50,000-piece campaign do not each contribute half
 * of a blended matchback rate, and averaging them would let a tiny mailing with
 * a lucky hit rate dominate the headline.
 */
export function rollUp(campaigns: CampaignMetrics[]): MailerTotals {
  const sum = (f: (c: CampaignMetrics) => number) => campaigns.reduce((n, c) => n + num(f(c)), 0);

  const marketed = sum((c) => c.marketed);
  const matchedCustomers = sum((c) => c.matchedCustomers);
  const matchedRos = sum((c) => c.matchedRos);
  const engaged = sum((c) => c.engaged);
  const revenue = round2(sum((c) => c.revenue));

  return {
    campaigns: campaigns.length,
    marketed,
    engaged,
    matchedCustomers,
    matchedRos,
    directMatches: sum((c) => c.directMatches),
    indirectMatches: sum((c) => c.indirectMatches),
    revenue,
    matchbackRate: rate(matchedCustomers, marketed),
    engagementRate: rate(engaged, marketed),
    revenuePerRo: matchedRos > 0 ? round2(revenue / matchedRos) : null,
    revenuePerPiece: marketed > 0 ? round2(revenue / marketed) : null,
  };
}

// ── Queries ──

function toRow(r: {
  id: string;
  campaignName: string;
  mailerType: string | null;
  mailedFrom: Date;
  mailedTo: Date;
  marketed: number;
  engaged: number;
  offerRequests: number | null;
  matchedCustomers: number;
  matchedRos: number;
  directMatches: number;
  indirectMatches: number;
  customerPay: unknown;
  warrantyPay: unknown;
}): CampaignRow {
  return {
    id: r.id,
    campaignName: r.campaignName,
    mailerType: r.mailerType,
    mailedFrom: r.mailedFrom.toISOString().slice(0, 10),
    mailedTo: r.mailedTo.toISOString().slice(0, 10),
    marketed: r.marketed,
    engaged: r.engaged,
    offerRequests: r.offerRequests,
    matchedCustomers: r.matchedCustomers,
    matchedRos: r.matchedRos,
    directMatches: r.directMatches,
    indirectMatches: r.indirectMatches,
    customerPay: Number(r.customerPay ?? 0),
    warrantyPay: Number(r.warrantyPay ?? 0),
  };
}

/**
 * Direct-mail spend for the range, from the budget ledger.
 *
 * This is the CLIENT GROSS on mail budget lines — what the dealer was charged,
 * which is the right denominator for a return the dealer is being shown. It is
 * not Oz's cost, and this report is client-facing, so it must not become that.
 */
async function mailSpend(accountKey: string, from: Date, to: Date): Promise<number | null> {
  const rows = await prisma.budgetLine.findMany({
    where: {
      accountKey,
      archivedAt: null,
      status: { in: ['committed', 'live', 'settled'] },
      channel: { in: ['print', 'direct_mail'] },
      year: { gte: from.getUTCFullYear(), lte: to.getUTCFullYear() },
    },
    select: { amount: true },
  });
  if (!rows.length) return null;
  return round2(rows.reduce((n, r) => n + Number(r.amount ?? 0), 0));
}

export async function getDirectMail(accountKey: string, from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`);
  const endExclusive = new Date(`${to}T00:00:00Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  const rows = await prisma.mailerCampaign.findMany({
    where: { accountKey, mailedFrom: { gte: start, lt: endExclusive } },
    orderBy: { mailedFrom: 'desc' },
  });

  const campaigns = rows.map((r) => withMetrics(toRow(r)));
  const totals = rollUp(campaigns);
  const cost = await mailSpend(accountKey, start, endExclusive).catch(() => null);

  return {
    campaigns,
    totals,
    roi: withRoi(totals.revenue, totals.matchedRos, cost),
  };
}
