/**
 * Comparison-period resolution — parity port of Oz Dealer Tools'
 * `resolveComparisonDates()` (identical across the Google/Meta/StackAdapt ad
 * reports, so it lives here once).
 *
 * Given the primary [start, end] window and a comparison mode, returns the
 * comparison window plus the human label the report renders. All dates are
 * date-only `YYYY-MM-DD` strings.
 *
 *   previous_period → the immediately-preceding window of the same length,
 *                     ending the day before `start`. Label "Previous N Days".
 *   previous_month  → [start, end] each shifted back one calendar month.
 *   previous_year   → [start, end] each shifted back one calendar year.
 *   custom          → the explicit custom window (or no comparison if missing).
 *   none / unknown  → no comparison.
 *
 * Month/year shifting reproduces PHP `DateTime::modify('-1 month')`'s
 * end-of-month overflow: subtracting a month from a day that doesn't exist in
 * the target month rolls forward into the next month (e.g. 2026-05-31 → -1
 * month → 2026-05-01, because April has no 31st). JS `Date` with explicit
 * (year, monthIndex, day) components normalizes the same way, so we get parity
 * for free as long as we do the arithmetic on UTC date components.
 */

export type CompareMode =
  | 'none'
  | 'previous_period'
  | 'previous_month'
  | 'previous_year'
  | 'custom';

export interface ComparisonWindow {
  /** `null` when no comparison applies. */
  start: string | null;
  end: string | null;
  /** Display label, e.g. "Previous 30 Days" or "May 1 – May 31, 2026". */
  label: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NO_COMPARISON: ComparisonWindow = { start: null, end: null, label: '' };

/** Parse `YYYY-MM-DD` into a UTC midnight Date (date-only, TZ-stable). */
function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Format a UTC Date back to `YYYY-MM-DD`. */
function toIso(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** PHP `format('M j')` → "May 1" (no leading zero on the day). */
function fmtMonthDay(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** PHP `format('M j, Y')` → "May 31, 2026". */
function fmtMonthDayYear(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Shift a UTC date back by whole calendar months (overflow rolls forward). */
function shiftMonths(date: Date, months: number): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() - months,
      date.getUTCDate(),
    ),
  );
}

export function resolveComparisonDates(
  startDate: string,
  endDate: string,
  compareTo: CompareMode | string,
  customStart?: string | null,
  customEnd?: string | null,
): ComparisonWindow {
  const start = parseIso(startDate);
  const end = parseIso(endDate);
  // PHP `$start->diff($end)->days` — whole days between the two dates.
  const days = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);

  switch (compareTo) {
    case 'previous_period': {
      const cEnd = new Date(start.getTime() - MS_PER_DAY);
      const cStart = new Date(cEnd.getTime() - days * MS_PER_DAY);
      return {
        start: toIso(cStart),
        end: toIso(cEnd),
        label: `Previous ${days + 1} Days`,
      };
    }
    case 'previous_month': {
      const cStart = shiftMonths(start, 1);
      const cEnd = shiftMonths(end, 1);
      return {
        start: toIso(cStart),
        end: toIso(cEnd),
        label: `${fmtMonthDay(cStart)} – ${fmtMonthDayYear(cEnd)}`,
      };
    }
    case 'previous_year': {
      const cStart = shiftMonths(start, 12);
      const cEnd = shiftMonths(end, 12);
      return {
        start: toIso(cStart),
        end: toIso(cEnd),
        label: `${fmtMonthDay(cStart)} – ${fmtMonthDayYear(cEnd)}`,
      };
    }
    case 'custom': {
      if (customStart && customEnd) {
        return {
          start: customStart,
          end: customEnd,
          label: `${fmtMonthDay(parseIso(customStart))} – ${fmtMonthDayYear(parseIso(customEnd))}`,
        };
      }
      return NO_COMPARISON;
    }
    default:
      return NO_COMPARISON;
  }
}
