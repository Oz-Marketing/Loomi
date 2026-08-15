/**
 * Lead Performance — port of Oz Dealer Tools' LeadPerformance report.
 *
 * This is a port of the CALCULATIONS, not of the data access. ODT read a
 * pre-aggregated `leads_by_month` table (one row per dealer/year/month/type
 * with total_leads, good_leads, bad_leads, sold_from_leads, total_gross).
 * Loomi has no such table — it has the individual leads, as `Contact` rows
 * tagged `lead`, pushed by the Oz Reports bridge. Everything below is rebuilt
 * from those rows.
 *
 * ── LOOMI'S LEAD COUNT IS NOT ODT'S LEAD COUNT ──────────────────────────────
 * The bridge deliberately drops junk before pushing
 * (`oz-reports/app/Controllers/Loomi.php`):
 *
 *     $q->whereNotIn('lead_status', ['BAD', 'DUPLICATE']);
 *
 * That filter is correct — those are the CRM's own junk markers, someone in
 * the store already dismissed them, and re-importing routes junk to a
 * salesperson. But it means **bad and duplicate leads never reach Loomi at
 * all**, so:
 *
 *   - Loomi's "Leads" ≈ ODT's `good_leads`, NOT ODT's `total_leads`.
 *   - A good/bad split is not merely unimplemented here — it is unobtainable,
 *     because the bad ones do not exist on this side.
 *
 * The gap is not small: at Young Nissan Riverdale it was 20 of 68 leads (~29%).
 * Anyone comparing this report to ODT's will see a persistently lower number.
 * The UI says so; do not "fix" it by relabelling.
 *
 * ── CONVERSION IS COMPUTED, NOT IMPORTED ────────────────────────────────────
 * ODT's `sold_from_leads` and `total_gross` came from the DMS's own attribution
 * and are not pushed. Loomi derives conversion itself: a lead `Contact` that
 * later has a `sale` `ContactEvent`. That is a different measurement from
 * ODT's — it is Loomi's own join, not the DMS's opinion — and it inherits the
 * contact-linkage caveat documented in service-retention.ts. Gross is not
 * available at all (see the gross gap in docs/odt-reporting-migration.md).
 *
 * ── THE PRORATION IMPROVEMENT ───────────────────────────────────────────────
 * ODT compared a partial month by prorating the comparison month LINEARLY:
 * `total × (throughDay / daysInMonth)` (`getLeadsSummaryProrated`). It had to —
 * monthly aggregates were all it had. That assumes leads arrive evenly through
 * a month, which they do not: weekends, month-end pushes and campaign flights
 * all break it.
 *
 * Loomi has a timestamp on every lead, so it compares the prior period through
 * the SAME DAY OF MONTH, exactly. No assumption, no estimate. `proratePartial`
 * is kept for reference and testing but is not what the report uses.
 */
import { prisma } from '@/lib/prisma';

export interface LeadMonthRow {
  period: string;
  leads: number;
  converted: number;
}

export interface LeadMonth {
  period: string;
  label: string;
  leads: number;
  converted: number;
  /** Null when the month had no leads — a rate over zero is not zero percent. */
  conversionRate: number | null;
}

export interface LeadBreakdown {
  label: string;
  leads: number;
  share: number;
}

export interface LeadComparison {
  currentPeriod: string;
  priorPeriod: string;
  currentLeads: number;
  priorLeads: number;
  /** Null when the prior period had no leads — the change is undefined, not ∞. */
  changePct: number | null;
  /** True when the current period is still running. */
  partial: boolean;
  /** Day of month the comparison is cut at; null for a whole closed month. */
  throughDay: number | null;
  /**
   * The day the PRIOR period was actually counted through. Differs from
   * `throughDay` only when the prior month is shorter — see `clampDay`.
   */
  priorThroughDay: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Days in a calendar month. `month` is 1-based. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Clamp a day-of-month to a target month's length.
 *
 * Comparing 31 March against February has no 31st to compare to. Clamping to
 * the 28th (or 29th) compares the whole of February against the whole of March
 * — which is the honest answer, and why `priorThroughDay` is reported
 * separately rather than assumed equal to `throughDay`.
 */
export function clampDay(day: number, year: number, month: number): number {
  return Math.min(day, daysInMonth(year, month));
}

/** "2026-07" → { year: 2026, month: 7 }. */
export function parsePeriod(period: string): { year: number; month: number } {
  const [y, m] = period.split('-').map(Number);
  return { year: y, month: m };
}

export function periodLabel(period: string): string {
  const { year, month } = parsePeriod(period);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The period `back` months before `period`. */
export function shiftPeriod(period: string, back: number): string {
  const { year, month } = parsePeriod(period);
  const d = new Date(Date.UTC(year, month - 1 - back, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Percent change, or null when there is no base to change from.
 *
 * Returning 0 for "0 → 12" would read as no growth; returning Infinity renders
 * as junk. Null lets the UI say "no prior leads", which is the actual fact.
 */
export function pctChange(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return round1(((current - prior) / prior) * 100);
}

/**
 * ODT's linear proration, kept for reference.
 *
 * NOT used by this report — Loomi counts the prior period through the same day
 * exactly. Retained so the difference between the two methods is testable and
 * so anyone reconciling against ODT can reproduce its number.
 */
export function proratePartial(total: number, throughDay: number, monthLength: number): number {
  if (monthLength <= 0) return 0;
  return round2(total * (throughDay / monthLength));
}

export function foldMonths(rows: LeadMonthRow[]): LeadMonth[] {
  return rows
    .map((r) => {
      const leads = Number(r.leads) || 0;
      const converted = Number(r.converted) || 0;
      return {
        period: r.period,
        label: periodLabel(r.period),
        leads,
        converted,
        conversionRate: leads > 0 ? round1((converted / leads) * 100) : null,
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));
}

export function foldBreakdown(
  rows: { label: string | null; leads: number }[],
  unknownLabel = 'Unknown',
): LeadBreakdown[] {
  const total = rows.reduce((n, r) => n + (Number(r.leads) || 0), 0);
  return rows
    .map((r) => ({
      label: r.label?.trim() || unknownLabel,
      leads: Number(r.leads) || 0,
      share: total > 0 ? (Number(r.leads) || 0) / total : 0,
    }))
    .sort((a, b) => b.leads - a.leads || a.label.localeCompare(b.label));
}

/** UTC bounds for a period, optionally cut at a day of month (inclusive). */
function periodBounds(period: string, throughDay?: number | null) {
  const { year, month } = parsePeriod(period);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const endExclusive =
    throughDay != null
      ? new Date(Date.UTC(year, month - 1, clampDay(throughDay, year, month) + 1))
      : new Date(Date.UTC(year, month, 1));
  return { start, endExclusive };
}

// ── Queries ──

/** Lead rows are `Contact`s carrying the `lead` tag the bridge sets. */
const LEAD_TAG = '["lead"]';

async function countLeads(
  accountKey: string,
  period: string,
  throughDay: number | null,
): Promise<number> {
  const { start, endExclusive } = periodBounds(period, throughDay);
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM "Contact"
    WHERE "accountKey" = ${accountKey}
      AND "tags" @> ${LEAD_TAG}::jsonb
      AND "dateAdded" >= ${start}
      AND "dateAdded" <  ${endExclusive}
  `;
  return rows[0]?.n ?? 0;
}

/**
 * Monthly lead counts plus how many of those leads later bought.
 *
 * Conversion keys off `ContactEvent.contactId`, so an unlinked sale can't be
 * credited to the lead that produced it — the same linkage tax the retention
 * report pays, and the reason the UI reports conversion as a floor.
 */
export async function getLeadMonths(
  accountKey: string,
  from: string,
  to: string,
): Promise<LeadMonth[]> {
  const { start } = periodBounds(from);
  const { endExclusive } = periodBounds(to);

  const rows = await prisma.$queryRaw<LeadMonthRow[]>`
    SELECT
      to_char(date_trunc('month', c."dateAdded"), 'YYYY-MM') AS period,
      count(*)::int                                          AS leads,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM "ContactEvent" e
        WHERE e."contactId"  = c."id"
          AND e."accountKey" = c."accountKey"
          AND e."type"       = 'sale'
          AND e."eventDate" >= c."dateAdded"
      ))::int                                                AS converted
    FROM "Contact" c
    WHERE c."accountKey" = ${accountKey}
      AND c."tags" @> ${LEAD_TAG}::jsonb
      AND c."dateAdded" >= ${start}
      AND c."dateAdded" <  ${endExclusive}
    GROUP BY 1
    ORDER BY 1
  `;
  return foldMonths(rows);
}

async function breakdown(
  accountKey: string,
  period: string,
  throughDay: number | null,
  column: 'source' | 'category',
): Promise<LeadBreakdown[]> {
  const { start, endExclusive } = periodBounds(period, throughDay);

  // `source` is a real column; category lives in the customFields blob the
  // bridge writes. Both are nullable, and null is a real answer — folded into
  // "Unknown" rather than dropped, so the breakdown sums to the headline.
  const rows =
    column === 'source'
      ? await prisma.$queryRaw<{ label: string | null; leads: number }[]>`
          SELECT "source" AS label, count(*)::int AS leads
          FROM "Contact"
          WHERE "accountKey" = ${accountKey}
            AND "tags" @> ${LEAD_TAG}::jsonb
            AND "dateAdded" >= ${start}
            AND "dateAdded" <  ${endExclusive}
          GROUP BY 1
        `
      : await prisma.$queryRaw<{ label: string | null; leads: number }[]>`
          SELECT "customFields"->>'lead_category' AS label, count(*)::int AS leads
          FROM "Contact"
          WHERE "accountKey" = ${accountKey}
            AND "tags" @> ${LEAD_TAG}::jsonb
            AND "dateAdded" >= ${start}
            AND "dateAdded" <  ${endExclusive}
          GROUP BY 1
        `;

  return foldBreakdown(rows, column === 'source' ? 'Unknown source' : 'Uncategorised');
}

/**
 * Compare a period against the one `back` months earlier.
 *
 * When `throughDay` is given the CURRENT period is still running, so the prior
 * period is counted through the same day rather than prorated — see the file
 * header. `priorThroughDay` reports where the prior cut actually landed, which
 * differs whenever the prior month is shorter.
 */
export async function compareLeads(
  accountKey: string,
  period: string,
  back: number,
  throughDay: number | null,
): Promise<LeadComparison> {
  const priorPeriod = shiftPeriod(period, back);
  const prior = parsePeriod(priorPeriod);
  const priorThroughDay =
    throughDay != null ? clampDay(throughDay, prior.year, prior.month) : null;

  const [currentLeads, priorLeads] = await Promise.all([
    countLeads(accountKey, period, throughDay),
    countLeads(accountKey, priorPeriod, priorThroughDay),
  ]);

  return {
    currentPeriod: period,
    priorPeriod,
    currentLeads,
    priorLeads,
    changePct: pctChange(currentLeads, priorLeads),
    partial: throughDay != null,
    throughDay,
    priorThroughDay,
  };
}

/** Year-to-date total through the given period, cut at `throughDay` if partial. */
export async function getYtd(
  accountKey: string,
  period: string,
  throughDay: number | null,
): Promise<number> {
  const { year, month } = parsePeriod(period);
  const start = new Date(Date.UTC(year, 0, 1));
  const { endExclusive } = periodBounds(period, throughDay);

  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM "Contact"
    WHERE "accountKey" = ${accountKey}
      AND "tags" @> ${LEAD_TAG}::jsonb
      AND "dateAdded" >= ${start}
      AND "dateAdded" <  ${endExclusive}
  `;
  void month;
  return rows[0]?.n ?? 0;
}

export async function getLeadPerformance(
  accountKey: string,
  period: string,
  throughDay: number | null,
  trailingMonths = 12,
) {
  const from = shiftPeriod(period, trailingMonths - 1);

  const [months, momCompare, yoyCompare, ytd, ytdPrior, bySource, byCategory] =
    await Promise.all([
      getLeadMonths(accountKey, from, period),
      compareLeads(accountKey, period, 1, throughDay),
      compareLeads(accountKey, period, 12, throughDay),
      getYtd(accountKey, period, throughDay),
      getYtd(accountKey, shiftPeriod(period, 12), throughDay),
      breakdown(accountKey, period, throughDay, 'source'),
      breakdown(accountKey, period, throughDay, 'category'),
    ]);

  const current = months.find((m) => m.period === period) ?? null;

  return {
    period,
    label: periodLabel(period),
    partial: throughDay != null,
    throughDay,
    current,
    months,
    momCompare,
    yoyCompare,
    ytd,
    ytdPrior,
    ytdChangePct: pctChange(ytd, ytdPrior),
    bySource,
    byCategory,
  };
}
