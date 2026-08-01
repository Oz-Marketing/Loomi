/**
 * Agreement term arithmetic — how a signed term maps onto calendar years.
 *
 * Prisma-free on purpose, like `period` and `settlement`: this is the math that
 * decides what a client's target for a year IS, and it should be testable
 * without a database standing up behind it.
 *
 * THE PROBLEM THIS SOLVES. The old model keyed a plan to a year, which quietly
 * assumed every agreement runs January to December. Most don't — they run
 * twelve months from whenever the client signed. A March-to-February term under
 * the old model either got filed under the wrong year or got split into two
 * plans that nobody kept in sync. A term with real dates can belong to two
 * years at once, each holding its own share.
 */

/** Months of a term that fall inside a calendar year. 0–12. */
export function monthsInYear(startDate: Date, endDate: Date, year: number): number {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year, 11, 31));
  const s = startDate > from ? startDate : from;
  const e = endDate < to ? endDate : to;
  if (s > e) return 0;
  return (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()) + 1;
}

/** Total months in a term. The denominator when pro-rating. */
export function termMonths(startDate: Date, endDate: Date): number {
  return (
    (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
    (endDate.getUTCMonth() - startDate.getUTCMonth()) +
    1
  );
}

/**
 * The share of a commitment that belongs to one calendar year.
 *
 * PRO-RATED BY MONTHS, NOT DAYS. Budget is planned, spent and billed monthly,
 * so a term starting on the 17th of March is a March month. Counting 15/31 of
 * it would produce a year target that reconciles against nothing — the ledger
 * underneath it only ever has whole months in it.
 *
 * Returns null when there's no commitment to divide (the caller then shows no
 * target rather than a target of zero, which reads as "they committed nothing"
 * instead of "we haven't been told").
 */
export function commitmentForYear(
  term: { startDate: Date; endDate: Date; committedAmount: number | null },
  year: number,
): number | null {
  if (term.committedAmount == null) return null;
  const total = termMonths(term.startDate, term.endDate);
  if (total <= 0) return null;
  const inYear = monthsInYear(term.startDate, term.endDate, year);
  if (inYear <= 0) return 0;
  return (term.committedAmount * inYear) / total;
}

/** The 1-based months of `year` a term covers, in order. */
export function termMonthsInYear(startDate: Date, endDate: Date, year: number): number[] {
  const out: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const first = new Date(Date.UTC(year, m - 1, 1));
    const last = new Date(Date.UTC(year, m, 0));
    if (last >= startDate && first <= endDate) out.push(m);
  }
  return out;
}
