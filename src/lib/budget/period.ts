/**
 * Budget period ("YYYY-MM") helpers and the year/period invariant.
 *
 * Pure — no prisma, no React — so the API layer can validate a period without
 * dragging the service (and a DB client) in, and so the invariant is unit
 * testable. Mirrors `ad-pacer/period.ts`, and uses the same period shape as
 * `MetaAdsPacerPeriodBudget.period` so the two systems line up on one string.
 */

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidPeriod(period: string): boolean {
  return PERIOD_RE.test(period);
}

export function yearOfPeriod(period: string): number {
  return Number(period.slice(0, 4));
}

export function periodOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Resolve the year to store for a write, enforcing BudgetLine invariant 1:
 * `year` is always set, and agrees with `period` whenever `period` is set.
 *
 * A period always wins — passing one implies its year, so a caller can't store
 * an inconsistent pair. A pool line (no period) must say which year its money
 * belongs to, since nothing else anchors it to a BudgetPlan.
 *
 * @throws if the period is malformed, the two disagree, or a pool line has no year.
 */
export function resolveYear(
  period: string | null | undefined,
  year: number | undefined,
): number {
  if (period) {
    if (!isValidPeriod(period)) {
      throw new Error(`Invalid period "${period}" (expected YYYY-MM)`);
    }
    const py = yearOfPeriod(period);
    if (year != null && year !== py) {
      throw new Error(`year ${year} disagrees with period ${period}`);
    }
    return py;
  }
  if (year == null || !Number.isInteger(year)) {
    throw new Error('A pool line (no period) requires an explicit year');
  }
  return year;
}
