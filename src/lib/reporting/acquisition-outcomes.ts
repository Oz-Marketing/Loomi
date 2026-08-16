/**
 * The CRM half of the acquisition-cost join: how many leads and delivered units
 * an account produced, for a window and month by month.
 *
 * Kept apart from `acquisition-cost.ts` on purpose — that module is pure and
 * unit-tested, this one owns the SQL. The division rules are the part worth
 * testing, and they should not need a database to exercise.
 *
 * Definitions follow the reports these numbers have to agree with:
 *
 *   • A LEAD is a `Contact` carrying the bridge's `lead` tag, counted by
 *     `dateAdded` — the same definition Lead Performance uses. Bad and
 *     duplicate leads never reach Loomi (the bridge filters them), so this is
 *     effectively a good-lead count. Do not relabel it "total leads".
 *   • A SOLD UNIT is a `sale` ContactEvent in the window, counted by
 *     `eventDate` — the same definition Sales Trend uses.
 *   • REVENUE is `amount`, which is what the customer paid, NOT dealer gross.
 *     The bridge does not carry gross. See docs/odt-reporting-migration.md.
 *
 * Set-based SQL rather than per-month loops: prod carries ~265k contacts and a
 * twelve-month trend would otherwise be twelve round-trips per report load.
 */
import { prisma } from '@/lib/prisma';

/** Lead rows are `Contact`s carrying the `lead` tag the bridge sets. */
const LEAD_TAG = '["lead"]';

export interface WindowOutcomes {
  leads: number;
  soldUnits: number;
  revenue: number;
}

export interface MonthOutcomes {
  leads: number;
  soldUnits: number;
}

/** Half-open [start, end) so a sale at midnight on the end date isn't counted twice. */
function bounds(startDate: string, endDate: string): { start: Date; endExclusive: Date } {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const endExclusive = new Date(`${endDate}T00:00:00.000Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { start, endExclusive };
}

/** Leads, sold units and transaction revenue for one window. */
export async function getWindowOutcomes(
  accountKey: string,
  startDate: string,
  endDate: string,
): Promise<WindowOutcomes> {
  const { start, endExclusive } = bounds(startDate, endDate);

  const [leadRows, saleRows] = await Promise.all([
    prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM "Contact"
      WHERE "accountKey" = ${accountKey}
        AND "tags" @> ${LEAD_TAG}::jsonb
        AND "dateAdded" >= ${start}
        AND "dateAdded" <  ${endExclusive}
    `,
    prisma.$queryRaw<{ n: number; revenue: number | null }[]>`
      SELECT count(*)::int AS n, COALESCE(sum("amount"), 0)::float8 AS revenue
      FROM "ContactEvent"
      WHERE "accountKey" = ${accountKey}
        AND "type" = 'sale'
        AND "eventDate" >= ${start}
        AND "eventDate" <  ${endExclusive}
    `,
  ]);

  return {
    leads: leadRows[0]?.n ?? 0,
    soldUnits: saleRows[0]?.n ?? 0,
    revenue: saleRows[0]?.revenue ?? 0,
  };
}

/**
 * The same counts bucketed by calendar month, as `{ "2026-07": {...} }`.
 *
 * Buckets in UTC to match how `eventDate` and `dateAdded` are stored. A dealer
 * on Mountain time will see a handful of late-evening records fall into the
 * next month; that is consistent with every other report here, and correcting
 * it in one place only would make two reports disagree.
 */
export async function getMonthlyOutcomes(
  accountKey: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, MonthOutcomes>> {
  const { start, endExclusive } = bounds(startDate, endDate);

  const [leadRows, saleRows] = await Promise.all([
    prisma.$queryRaw<{ period: string; n: number }[]>`
      SELECT to_char(date_trunc('month', "dateAdded"), 'YYYY-MM') AS period,
             count(*)::int AS n
      FROM "Contact"
      WHERE "accountKey" = ${accountKey}
        AND "tags" @> ${LEAD_TAG}::jsonb
        AND "dateAdded" >= ${start}
        AND "dateAdded" <  ${endExclusive}
      GROUP BY 1
    `,
    prisma.$queryRaw<{ period: string; n: number }[]>`
      SELECT to_char(date_trunc('month', "eventDate"), 'YYYY-MM') AS period,
             count(*)::int AS n
      FROM "ContactEvent"
      WHERE "accountKey" = ${accountKey}
        AND "type" = 'sale'
        AND "eventDate" >= ${start}
        AND "eventDate" <  ${endExclusive}
      GROUP BY 1
    `,
  ]);

  const out: Record<string, MonthOutcomes> = {};
  for (const r of leadRows) {
    if (!r.period) continue;
    out[r.period] = { leads: r.n, soldUnits: out[r.period]?.soldUnits ?? 0 };
  }
  for (const r of saleRows) {
    if (!r.period) continue;
    out[r.period] = { leads: out[r.period]?.leads ?? 0, soldUnits: r.n };
  }
  return out;
}

/**
 * Billed media spend per month, from the budget ledger.
 *
 * The vendor routes give live spend for ONE window; a twelve-month trend would
 * be thirty-six vendor calls per page load. The ledger already holds the same
 * money month by month in local Postgres, so the trend reads that instead.
 *
 * Two rules make this the right number rather than a near-miss:
 *
 *   • `lineType = 'media'` only. The ledger also carries agency fees and resold
 *     services; counting a management fee as media would inflate cost per unit
 *     by whatever the retainer is.
 *   • `amount` is CLIENT GROSS — the billed figure, which is what the vendor
 *     routes return post-margin, so the two series are comparable. The raw
 *     platform spend is `amount × markupSnapshot`; that stays server-side and
 *     is never summed here. Exposing it would reopen the hole
 *     `stripMarginInternals` closed.
 *
 * Keyed on `accountKey` (billed to), not `spendAccountKey` — this report asks
 * what THIS rooftop was charged, not whose ad account the money left from.
 */
export async function getMonthlyMediaSpend(
  accountKey: string,
  startPeriod: string,
  endPeriod: string,
): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<{ period: string; spend: number }[]>`
    SELECT "period", COALESCE(sum("amount"), 0)::float8 AS spend
    FROM "BudgetLine"
    WHERE "accountKey" = ${accountKey}
      AND "lineType" = 'media'
      AND "period" IS NOT NULL
      AND "period" >= ${startPeriod}
      AND "period" <= ${endPeriod}
    GROUP BY "period"
  `;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.period] = r.spend;
  return out;
}
