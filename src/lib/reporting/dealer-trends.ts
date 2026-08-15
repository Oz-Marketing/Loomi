/**
 * Sales & Service trend queries — ports of Oz Dealer Tools' SalesTrend and
 * ServiceTrend reports (`OzReportsData::getSalesTrend` / `getServiceTrend`).
 *
 * ARCHITECTURE NOTE — this reads LOCAL POSTGRES, not a vendor API.
 * Every other `/api/reporting/*` route resolves an account to a platform
 * config and hits the vendor live. These two do not, and should not be
 * "fixed" to match: their source is `ContactEvent`, populated by the Oz
 * Reports push bridge (see docs/oz-reports-contact-sync.md). ODT read the
 * dealer MySQL directly; Loomi reads the copy the bridge already maintains.
 *
 * TWO SOURCE SHAPES. The bridge normalizes automotive and powersports into
 * the same columns, but NOT the same `details` keys:
 *
 *   sale     automotive → deal_type (NEW/USED), sale_type (LEASE), apr, term
 *            powersports → new_used (N/U), unit_type, rate, msrp, term
 *   service  automotive → customer_pay, warranty_pay, internal_pay, hours
 *            powersports → category, stock_number  (NO pay-type split)
 *
 * Both shapes are handled here rather than in SQL so the rules stay testable.
 *
 * WHAT THIS REPORT CANNOT SHOW — DEALER GROSS.
 * ODT's Sales Trend is built on `totalgross` / `frontgross` / `backgross`,
 * i.e. dealer gross PROFIT. The bridge does not carry those columns: it sends
 * `outthedoor` (automotive) and `unitsoldprice` (powersports), which are what
 * the CUSTOMER paid. So everything here is transaction revenue, and the UI
 * must say so. Reaching ODT parity means adding the gross columns to
 * `pushevents` in oz-reports/app/Controllers/Loomi.php — a bridge change, not
 * a change here. Do not relabel `revenue` as "gross" to close the gap.
 */
import { prisma } from '@/lib/prisma';

// ── Shared helpers ──

/** SQL-side guard for "this JSON text is a plain number". */
const NUMERIC = '^-?[0-9]+([.][0-9]+)?$';

/** First day of the month, as the ISO date the month buckets are keyed by. */
function monthLabel(monthIso: string): string {
  return new Date(`${monthIso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * `to` is an inclusive calendar day; SQL compares against an exclusive upper
 * bound so events timestamped later in that day are not silently dropped.
 */
function bounds(from: string, to: string): { start: Date; endExclusive: Date } {
  const start = new Date(`${from}T00:00:00Z`);
  const endExclusive = new Date(`${to}T00:00:00Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { start, endExclusive };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const div = (n: number, d: number) => (d > 0 ? n / d : 0);

// ── Sales ──

export type SaleMix = 'new' | 'used' | 'lease' | 'other';

/**
 * Which bucket a deal falls in, across both source shapes.
 *
 * Lease wins over new/used, matching ODT: a leased new car counts as a lease,
 * not as a new unit, so the three buckets stay mutually exclusive.
 * Powersports has no lease concept and abbreviates to N/U.
 *
 * Anything unrecognized becomes `other` rather than being dropped, so the mix
 * always reconciles to the unit total. ODT discarded these silently, which is
 * why its mix could sum to less than its total.
 */
export function classifySale(saleType: string, dealType: string): SaleMix {
  const s = saleType.trim().toUpperCase();
  const d = dealType.trim().toUpperCase();
  if (s === 'LEASE' || s === 'L') return 'lease';
  if (d === 'NEW' || d === 'N') return 'new';
  if (d === 'USED' || d === 'U') return 'used';
  return 'other';
}

/** One `GROUP BY month, sale_type, deal_type` row, pre-classification. */
export interface SalesGroupRow {
  month: string;
  sale_type: string;
  deal_type: string;
  units: number;
  revenue: number;
  apr_sum: number;
  apr_n: number;
}

export interface SalesMonth {
  month: string;
  label: string;
  newUnits: number;
  usedUnits: number;
  leaseUnits: number;
  otherUnits: number;
  totalUnits: number;
  newRevenue: number;
  usedRevenue: number;
  leaseRevenue: number;
  otherRevenue: number;
  totalRevenue: number;
  avgPrice: number;
}

export interface SalesSummary {
  newUnits: number;
  usedUnits: number;
  leaseUnits: number;
  otherUnits: number;
  totalUnits: number;
  newRevenue: number;
  usedRevenue: number;
  leaseRevenue: number;
  otherRevenue: number;
  totalRevenue: number;
  avgPrice: number;
  /** Mean APR over deals that reported one; null when none did. */
  avgApr: number | null;
  /** Share of units carrying a usable APR, 0–1 — how much to trust avgApr. */
  aprCoverage: number;
}

const MIX_UNITS = {
  new: 'newUnits',
  used: 'usedUnits',
  lease: 'leaseUnits',
  other: 'otherUnits',
} as const;
const MIX_REVENUE = {
  new: 'newRevenue',
  used: 'usedRevenue',
  lease: 'leaseRevenue',
  other: 'otherRevenue',
} as const;

function emptySalesMonth(month: string): SalesMonth {
  return {
    month,
    label: monthLabel(month),
    newUnits: 0,
    usedUnits: 0,
    leaseUnits: 0,
    otherUnits: 0,
    totalUnits: 0,
    newRevenue: 0,
    usedRevenue: 0,
    leaseRevenue: 0,
    otherRevenue: 0,
    totalRevenue: 0,
    avgPrice: 0,
  };
}

/** Fold classified group rows into per-month buckets + a range summary. */
export function foldSales(rows: SalesGroupRow[]): {
  months: SalesMonth[];
  summary: SalesSummary;
} {
  const byMonth = new Map<string, SalesMonth>();
  let aprSum = 0;
  let aprN = 0;

  for (const r of rows) {
    const m = byMonth.get(r.month) ?? emptySalesMonth(r.month);
    const bucket = classifySale(r.sale_type, r.deal_type);
    const units = Number(r.units) || 0;
    const revenue = Number(r.revenue) || 0;

    m[MIX_UNITS[bucket]] += units;
    m[MIX_REVENUE[bucket]] += revenue;
    m.totalUnits += units;
    m.totalRevenue += revenue;
    byMonth.set(r.month, m);

    aprSum += Number(r.apr_sum) || 0;
    aprN += Number(r.apr_n) || 0;
  }

  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  for (const m of months) {
    m.newRevenue = round2(m.newRevenue);
    m.usedRevenue = round2(m.usedRevenue);
    m.leaseRevenue = round2(m.leaseRevenue);
    m.otherRevenue = round2(m.otherRevenue);
    m.totalRevenue = round2(m.totalRevenue);
    m.avgPrice = round2(div(m.totalRevenue, m.totalUnits));
  }

  const summary = months.reduce<SalesSummary>(
    (acc, m) => ({
      ...acc,
      newUnits: acc.newUnits + m.newUnits,
      usedUnits: acc.usedUnits + m.usedUnits,
      leaseUnits: acc.leaseUnits + m.leaseUnits,
      otherUnits: acc.otherUnits + m.otherUnits,
      totalUnits: acc.totalUnits + m.totalUnits,
      newRevenue: acc.newRevenue + m.newRevenue,
      usedRevenue: acc.usedRevenue + m.usedRevenue,
      leaseRevenue: acc.leaseRevenue + m.leaseRevenue,
      otherRevenue: acc.otherRevenue + m.otherRevenue,
      totalRevenue: acc.totalRevenue + m.totalRevenue,
    }),
    {
      newUnits: 0,
      usedUnits: 0,
      leaseUnits: 0,
      otherUnits: 0,
      totalUnits: 0,
      newRevenue: 0,
      usedRevenue: 0,
      leaseRevenue: 0,
      otherRevenue: 0,
      totalRevenue: 0,
      avgPrice: 0,
      avgApr: null,
      aprCoverage: 0,
    },
  );

  summary.newRevenue = round2(summary.newRevenue);
  summary.usedRevenue = round2(summary.usedRevenue);
  summary.leaseRevenue = round2(summary.leaseRevenue);
  summary.otherRevenue = round2(summary.otherRevenue);
  summary.totalRevenue = round2(summary.totalRevenue);
  summary.avgPrice = round2(div(summary.totalRevenue, summary.totalUnits));
  summary.avgApr = aprN > 0 ? round2(aprSum / aprN) : null;
  summary.aprCoverage = summary.totalUnits > 0 ? aprN / summary.totalUnits : 0;

  return { months, summary };
}

export async function getSalesTrend(accountKey: string, from: string, to: string) {
  const { start, endExclusive } = bounds(from, to);

  // Grouped in SQL (small result: months × distinct type pairs), classified in
  // TS. `apr` is automotive, `rate` is powersports; the CASE guard keeps a
  // non-numeric value from aborting the whole aggregate on a cast error.
  const rows = await prisma.$queryRaw<SalesGroupRow[]>`
    SELECT
      to_char(date_trunc('month', "eventDate"), 'YYYY-MM-DD')          AS month,
      upper(coalesce(details->>'sale_type', ''))                       AS sale_type,
      upper(coalesce(details->>'deal_type', details->>'new_used', '')) AS deal_type,
      count(*)::int                                                    AS units,
      coalesce(sum("amount"), 0)::float8                               AS revenue,
      coalesce(sum(
        CASE WHEN coalesce(details->>'apr', details->>'rate', '') ~ ${NUMERIC}
          THEN coalesce(details->>'apr', details->>'rate')::numeric END
      ), 0)::float8                                                    AS apr_sum,
      count(*) FILTER (
        WHERE coalesce(details->>'apr', details->>'rate', '') ~ ${NUMERIC}
      )::int                                                           AS apr_n
    FROM "ContactEvent"
    WHERE "accountKey" = ${accountKey}
      AND "type" = 'sale'
      AND "eventDate" >= ${start}
      AND "eventDate" < ${endExclusive}
    GROUP BY 1, 2, 3
    ORDER BY 1
  `;

  return foldSales(rows);
}

// ── Service ──

export interface ServiceGroupRow {
  month: string;
  ro_count: number;
  total_revenue: number;
  customer_pay: number;
  warranty_pay: number;
  internal_pay: number;
}

export interface ServiceMonth {
  month: string;
  label: string;
  roCount: number;
  customerPay: number;
  warrantyPay: number;
  internalPay: number;
  /** Revenue with no pay-type breakdown — powersports ROs, mostly. */
  unsplitPay: number;
  totalRevenue: number;
  avgRoValue: number;
}

export interface ServiceSummary {
  roCount: number;
  customerPay: number;
  warrantyPay: number;
  internalPay: number;
  unsplitPay: number;
  totalRevenue: number;
  avgRoValue: number;
  /** Share of revenue that has a pay-type split, 0–1. */
  splitCoverage: number;
}

/**
 * Fold per-month service rows, deriving the unsplit remainder.
 *
 * Automotive ROs carry customer/warranty/internal in `details` and their sum
 * equals `amount`, so the remainder is zero. Powersports carries neither, so
 * the whole RO total lands in `unsplitPay`. Surfacing that explicitly beats
 * charting three zero-height segments and letting a powersports dealer think
 * they billed nothing.
 */
export function foldService(rows: ServiceGroupRow[]): {
  months: ServiceMonth[];
  summary: ServiceSummary;
} {
  const months: ServiceMonth[] = rows
    .map((r) => {
      const roCount = Number(r.ro_count) || 0;
      const customerPay = Number(r.customer_pay) || 0;
      const warrantyPay = Number(r.warranty_pay) || 0;
      const internalPay = Number(r.internal_pay) || 0;
      const totalRevenue = Number(r.total_revenue) || 0;
      // Clamp: a split that overshoots `amount` (bad source row) must not
      // render as a negative segment.
      const unsplitPay = Math.max(0, totalRevenue - (customerPay + warrantyPay + internalPay));

      return {
        month: r.month,
        label: monthLabel(r.month),
        roCount,
        customerPay: round2(customerPay),
        warrantyPay: round2(warrantyPay),
        internalPay: round2(internalPay),
        unsplitPay: round2(unsplitPay),
        totalRevenue: round2(totalRevenue),
        avgRoValue: round2(div(totalRevenue, roCount)),
      };
    })
    .sort((a, b) => a.month.localeCompare(b.month));

  const summary = months.reduce<ServiceSummary>(
    (acc, m) => ({
      ...acc,
      roCount: acc.roCount + m.roCount,
      customerPay: acc.customerPay + m.customerPay,
      warrantyPay: acc.warrantyPay + m.warrantyPay,
      internalPay: acc.internalPay + m.internalPay,
      unsplitPay: acc.unsplitPay + m.unsplitPay,
      totalRevenue: acc.totalRevenue + m.totalRevenue,
    }),
    {
      roCount: 0,
      customerPay: 0,
      warrantyPay: 0,
      internalPay: 0,
      unsplitPay: 0,
      totalRevenue: 0,
      avgRoValue: 0,
      splitCoverage: 0,
    },
  );

  summary.customerPay = round2(summary.customerPay);
  summary.warrantyPay = round2(summary.warrantyPay);
  summary.internalPay = round2(summary.internalPay);
  summary.unsplitPay = round2(summary.unsplitPay);
  summary.totalRevenue = round2(summary.totalRevenue);
  summary.avgRoValue = round2(div(summary.totalRevenue, summary.roCount));
  summary.splitCoverage =
    summary.totalRevenue > 0
      ? (summary.totalRevenue - summary.unsplitPay) / summary.totalRevenue
      : 0;

  return { months, summary };
}

export async function getServiceTrend(accountKey: string, from: string, to: string) {
  const { start, endExclusive } = bounds(from, to);

  const rows = await prisma.$queryRaw<ServiceGroupRow[]>`
    SELECT
      to_char(date_trunc('month', "eventDate"), 'YYYY-MM-DD') AS month,
      count(*)::int                                           AS ro_count,
      coalesce(sum("amount"), 0)::float8                      AS total_revenue,
      coalesce(sum(
        CASE WHEN details->>'customer_pay' ~ ${NUMERIC}
          THEN (details->>'customer_pay')::numeric END
      ), 0)::float8                                           AS customer_pay,
      coalesce(sum(
        CASE WHEN details->>'warranty_pay' ~ ${NUMERIC}
          THEN (details->>'warranty_pay')::numeric END
      ), 0)::float8                                           AS warranty_pay,
      coalesce(sum(
        CASE WHEN details->>'internal_pay' ~ ${NUMERIC}
          THEN (details->>'internal_pay')::numeric END
      ), 0)::float8                                           AS internal_pay
    FROM "ContactEvent"
    WHERE "accountKey" = ${accountKey}
      AND "type" = 'service'
      AND "eventDate" >= ${start}
      AND "eventDate" < ${endExclusive}
    GROUP BY 1
    ORDER BY 1
  `;

  return foldService(rows);
}
