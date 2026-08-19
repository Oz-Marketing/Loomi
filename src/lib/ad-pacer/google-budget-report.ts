/**
 * The Google-native budget report behind the delivery panel (budget-report
 * addendum §4.1). Pure: no React, no DB, no API — it turns the already-synced
 * daily series into the two charts' geometry and nothing else.
 *
 * WHY IT IS ITS OWN MODULE. Every series here is a different statement about the
 * same month, and three of them are routinely confused for one another:
 *
 *  - **Target pace** is Loomi's plan — the even-spend line to the monthly target.
 *    It is what the pace badge grades against and Google has never heard of it.
 *  - **Billing ceiling** is Google's, and it is a LIMIT, not a plan: the daily
 *    budget × 30.4, re-averaged when the rate changes mid-month. It is the most
 *    Google can bill, which is a completely different number from what we
 *    intended to spend.
 *  - **Loomi projection** is a forecast, and the only one of the three that can
 *    be wrong.
 *
 * Rendering them as one chart is only safe if the arithmetic that separates them
 * lives somewhere it can be read and tested, which is here.
 */

import { GOOGLE_DAILY_MULTIPLIER } from './constants';
import { monthlyLimitAfterChange, monthlyLimitFlat } from './google-allocator';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * How far the projection band fans out from the dotted line, as a fraction of
 * the spend being projected. A soft ±18% by the end of the month: enough that
 * nobody reads a straight-line forecast to the dollar, not so much that the band
 * swamps the lines it sits between.
 */
const PROJECTION_SPREAD = 0.18;

export interface DailyPoint {
  date: string;
  spend: number;
  dailyBudget: number | null;
}

/** One day of the report — every series' value at that date, in one row. */
export interface ReportDay {
  date: string;
  /** 1-based position in the charted window. */
  index: number;
  /** Finalized spend. Null for today and every future day: today is partial and
   *  the rest has not happened, and a zero in either would read as a collapse in
   *  delivery rather than an absence of data. */
  spend: number | null;
  /** Cumulative finalized spend through this day, null once the data runs out. */
  cumulative: number | null;
  /** The daily budget in effect that day — frozen per day by the sync, so it
   *  steps on its own at each budget change. Filled forward past the data edge
   *  with the current daily, since that is what a future day would bill at. */
  dailyBudget: number;
  /** Google's single-day spending limit that day: 2× the daily budget. */
  dailyLimit: number;
  /** The even-spend line: where cumulative spend should be by this day. */
  targetPace: number;
  /** Google's monthly charging limit given the rates seen through this day. */
  billingCeiling: number;
  /** True on the data edge's day and everything after it. */
  future: boolean;
  /** The daily budget changed on this day (a chart divider, §4.5). */
  budgetChange: boolean;
}

export interface BudgetReport {
  days: ReportDay[];
  /** Cumulative finalized spend at the data edge. */
  costToDate: number;
  /** The last day with finalized data, or null when there is none. */
  edgeIndex: number | null;
  /**
   * The projection from the data edge to the end of the window: the recent-pace
   * line, and a band that fans out around it. Empty when there is no rate to
   * project from.
   *
   * The band is UNCERTAINTY, not a second scenario. It first held the
   * at-current-daily line as its upper edge, which was a real number but drew a
   * lens — pinched at the edge where both scenarios start from the same spend,
   * pinched again once both would exceed the billing ceiling, and bulging in
   * between — and a shape that closes at both ends reads as a rendering
   * artifact, not as a forecast. It now widens with distance from the last day
   * we actually know about, which is the honest shape for a straight-line
   * projection and needs no explaining. The pace-vs-daily comparison still
   * exists, in the money line's tooltip, where it can be stated in words.
   */
  projection: { index: number; low: number; high: number; pace: number }[];
  /** Every day the daily budget changed, for the "set on" line and the chart
   *  markers (§4.5). Derived from `dailyBudget` transitions in the series, which
   *  is a permanent record — unlike Google's change_event, which only retains
   *  30 days and so can never be the source of truth. */
  changes: { date: string; from: number; to: number }[];
  /** Tallest value any chart has to fit: the biggest single-day limit or spend. */
  dailyScale: number;
  /** Tallest value the cumulative chart has to fit. */
  cumulativeScale: number;
}

export interface BudgetReportInput {
  /** Finalized daily rows, ascending, already clamped to the flight window. */
  series: readonly DailyPoint[];
  /** Every date in the charted window, ascending — the flight, not the data. A
   *  window built from the rows alone would end wherever the sync stopped, and
   *  the whole point of the cumulative chart is the days that have not happened. */
  window: readonly string[];
  /** The campaign's monthly target — the top of the target-pace line. */
  target: number;
  /** The daily budget currently set in Google. Fills forward past the edge. */
  currentDaily: number;
  /** Finalized average daily delivery, or null when there is too little history. */
  recentAvgDaily: number | null;
  /** Calendar days in the month, for the ceiling's re-average. */
  daysInMonth: number;
}

/**
 * Build every series the two charts draw.
 *
 * The one subtlety is the billing ceiling, and it is Google's rule rather than
 * an intuition about it:
 *
 *  - A daily budget set and left alone limits the month to daily × 30.4.
 *  - CHANGE it mid-month and the limit becomes what has been spent so far plus
 *    the new daily × the calendar days remaining in the month. Google's own
 *    example: $5/day from Nov 1 is a $152.00 limit; raise it to $10 on the 24th
 *    with $103 spent and the limit for November becomes $103 + $10 × 7 = $173.00.
 *
 * So the ceiling is a CONSTANT that re-bases at each change, not a re-average of
 * the month. It steps exactly where the budget does, which is what makes a step
 * readable as "someone changed the budget here" rather than as noise — and it
 * never lands below the spend already booked, which a naive newDaily × 30.4
 * does the moment a budget is cut late in a month.
 */
export function buildBudgetReport(input: BudgetReportInput): BudgetReport {
  const spendByDate = new Map(input.series.map((p) => [p.date, p]));
  const lastWithData = input.series.length > 0 ? input.series[input.series.length - 1].date : null;

  const days: ReportDay[] = [];
  const changes: BudgetReport['changes'] = [];
  let cumulative = 0;
  let haveData = true;
  let rate = input.currentDaily;
  // The ceiling in force. Seeded flat from the starting rate and re-based at
  // each change by Google's mid-month rule (see the doc above). A constant, not
  // a running average.
  let ceiling = 0;
  let seededCeiling = false;

  input.window.forEach((date, i) => {
    const point = spendByDate.get(date);
    const future = lastWithData == null || date > lastWithData;
    if (future) haveData = false;

    // The rate in effect this day. Past the data edge nothing more is known, so
    // the current daily carries forward — that IS what a future day bills at.
    const previousRate = rate;
    const synced = point?.dailyBudget;
    if (!future && synced != null && synced > 0) rate = synced;
    else if (future) rate = input.currentDaily;
    // A change on day one is the starting rate, not a change.
    if (i > 0 && Math.abs(rate - previousRate) > 0.005 && !future) {
      changes.push({ date, from: round2(previousRate), to: round2(rate) });
    }

    // Spend through YESTERDAY, captured before this day is added — the exact
    // term Google's mid-month limit rule takes.
    const cumulativeBefore = cumulative;
    if (!future && point) cumulative += Number(point.spend) || 0;

    // Ceiling. Calendar-month positions, never the flight's: Google's limit is
    // a property of the month, so a campaign flighted Aug 10–20 still has its
    // limit counted over all 31 days.
    const dayOfMonth = Number(date.slice(8, 10)) || i + 1;
    const remainingCalendarDays = Math.max(0, input.daysInMonth - dayOfMonth + 1);
    if (!seededCeiling) {
      // Nothing has changed yet, so the standing rate limits the whole month.
      ceiling = monthlyLimitFlat(rate);
      seededCeiling = true;
    } else if (Math.abs(rate - previousRate) > 0.005) {
      // A change: re-base on what is actually spent plus the new rate over the
      // days that are left. `cumulative` has not taken this day's spend yet, so
      // it is spend through YESTERDAY — which is the term Google's rule wants.
      ceiling = monthlyLimitAfterChange({
        spentToDate: cumulativeBefore,
        newDaily: rate,
        remainingCalendarDays,
      });
    }

    days.push({
      date,
      index: i,
      spend: future || !point ? null : Number(point.spend) || 0,
      cumulative: haveData ? round2(cumulative) : null,
      dailyBudget: round2(rate),
      dailyLimit: round2(rate * GOOGLE_DAILY_MULTIPLIER),
      targetPace:
        input.window.length > 1
          ? round2((input.target * (i + 1)) / input.window.length)
          : round2(input.target),
      billingCeiling: round2(ceiling),
      future,
      budgetChange: false,
    });
  });

  const changeDates = new Set(changes.map((c) => c.date));
  for (const day of days) day.budgetChange = changeDates.has(day.date);

  const edgeIndex = days.reduce<number | null>((acc, d) => (d.future ? acc : d.index), null);
  const costToDate = edgeIndex != null ? (days[edgeIndex].cumulative ?? 0) : 0;

  // The projection band: recent delivery on one edge, the current daily on the
  // other, both held under the billing ceiling because Google cannot bill past
  // it however fast the campaign would otherwise spend.
  const projection: BudgetReport['projection'] = [];
  if (edgeIndex != null && input.recentAvgDaily != null) {
    for (let i = edgeIndex; i < days.length; i++) {
      const elapsed = i - edgeIndex;
      const ceiling = days[i].billingCeiling;
      // The dotted line: where the campaign lands if it keeps behaving as it
      // has, held under what Google can actually bill.
      const pace = Math.min(costToDate + input.recentAvgDaily * elapsed, ceiling);
      // …and the halo around it, widening with every day projected. Zero on the
      // edge itself, because the spend up to there is not a forecast.
      const spread = (pace - costToDate) * PROJECTION_SPREAD;
      projection.push({
        index: i,
        low: round2(Math.max(costToDate, pace - spread)),
        high: round2(Math.min(pace + spread, ceiling)),
        pace: round2(pace),
      });
    }
  }

  const dailyScale =
    days.reduce((m, d) => Math.max(m, d.spend ?? 0, d.dailyLimit), 0) * 1.08 || 1;
  const cumulativeScale =
    Math.max(
      input.target,
      costToDate,
      days.reduce((m, d) => Math.max(m, d.billingCeiling), 0),
      projection.reduce((m, p) => Math.max(m, p.high), 0),
    ) * 1.08 || 1;

  return {
    days,
    costToDate,
    edgeIndex,
    projection,
    changes,
    dailyScale,
    cumulativeScale,
  };
}

/**
 * The most recent daily-budget transition the stored series knows about: the
 * first day whose budget-in-effect differs from the previous budgeted day's.
 *
 * The same rule `buildBudgetReport` uses for its own change markers, exposed on
 * its own because the projection needs the change date BEFORE the report is
 * built (the report's forecast line runs on the since-change rate — spec
 * additions §D). If these two ever disagree, the chart's markers and the rate's
 * window would be describing different days.
 *
 * It is a first-day-of-the-new-rate date, not a timestamp: the sync stamps each
 * day with the rate it saw, so the day returned here ran partly at the old rate.
 * Callers therefore treat it as the change day and measure the rate from the day
 * AFTER it. It can also be a day late when the change was made in Google between
 * syncs, which errs the safe way — a late date shortens the rate window rather
 * than letting an old-rate day into it.
 */
export function lastSeriesBudgetChange(
  series: readonly DailyPoint[],
): { date: string; from: number; to: number } | null {
  const budgeted = series.filter((p) => p.dailyBudget != null && p.dailyBudget > 0);
  let last: { date: string; from: number; to: number } | null = null;
  for (let i = 1; i < budgeted.length; i++) {
    const from = budgeted[i - 1].dailyBudget as number;
    const to = budgeted[i].dailyBudget as number;
    if (Math.abs(to - from) > 0.005) {
      last = { date: budgeted[i].date, from: round2(from), to: round2(to) };
    }
  }
  return last;
}

/** Every ISO date from `start` to `end` inclusive. */
export function isoRange(start: string, end: string): string[] {
  const out: string[] = [];
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return out;
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}
