/**
 * Flight splitting — turning a media buy's date range into monthly amounts.
 *
 * Prisma-free, like `period`, `term` and `settlement`, so the arithmetic that
 * decides how much of a buy lands in each month is unit-tested without a
 * database.
 *
 * THE PROBLEM. A buy running 20 March – 10 May is one commercial fact: one
 * insertion order, one total, one flight. The ledger is at month grain, so
 * today it has to be entered as three lines with the split done in someone's
 * head — and when the flight moves or the total changes, all three have to be
 * found and corrected together. Nobody does that reliably.
 *
 * SPLIT BY DAYS, NOT MONTHS. This is the opposite of `term.ts`, deliberately.
 * An agreement's commitment is pro-rated by whole months because it's *billed*
 * monthly — a term starting on the 17th still owes a full March. A media flight
 * *spends* daily: 12 days of March is 12 days of impressions, and giving that
 * month a full share would overstate March's pacing target by a factor of two
 * and understate April's. Different money, different rule.
 *
 * Shares are exact to the cent — see `splitToCents`. A flight whose parts don't
 * sum to its total is a flight someone will have to reconcile by hand.
 */
import { periodOf } from './period';
import { splitToCents } from './settlement';

export interface FlightMonth {
  /** `YYYY-MM`. */
  period: string;
  /** Days of the flight that fall in this month. */
  days: number;
  /** This month's share of the flight total, exact to the cent. */
  amount: number;
}

/** Whole days from `start` to `end`, inclusive. Both ends are flight days. */
export function flightDays(start: Date, end: Date): number {
  const ms = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) -
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  return Math.floor(ms / 86_400_000) + 1;
}

/**
 * The months a flight touches, with how many of its days fall in each.
 *
 * Returned even for months with a single day — a one-day tail is still real
 * spend and still needs somewhere to sit in the grid.
 */
export function flightMonths(start: Date, end: Date): { period: string; days: number }[] {
  if (end < start) return [];
  const out: { period: string; days: number }[] = [];

  let y = start.getUTCFullYear();
  let m = start.getUTCMonth(); // 0-based
  while (y < end.getUTCFullYear() || (y === end.getUTCFullYear() && m <= end.getUTCMonth())) {
    const monthStart = new Date(Date.UTC(y, m, 1));
    const monthEnd = new Date(Date.UTC(y, m + 1, 0));
    const from = monthStart > start ? monthStart : start;
    const to = monthEnd < end ? monthEnd : end;
    out.push({ period: periodOf(y, m + 1), days: flightDays(from, to) });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

/**
 * Split a flight's total across the months it runs in, weighted by days.
 *
 * The parts sum to the total exactly, via largest-remainder — the same
 * machinery settlement uses, for the same reason: a buy whose monthly lines
 * add up to $0.02 less than the insertion order is one somebody has to chase.
 */
export function splitFlight(start: Date, end: Date, total: number): FlightMonth[] {
  const months = flightMonths(start, end);
  if (months.length === 0) return [];

  const split = splitToCents(
    months.map((mo) => ({ id: mo.period, spendTarget: mo.days })),
    total,
  );
  const byPeriod = new Map(split.map((s) => [s.id, s.actual]));
  return months.map((mo) => ({ ...mo, amount: byPeriod.get(mo.period) ?? 0 }));
}

/** A flight confined to one calendar year keeps the ledger's year invariant simple. */
export function flightCrossesYears(start: Date, end: Date): boolean {
  return start.getUTCFullYear() !== end.getUTCFullYear();
}
