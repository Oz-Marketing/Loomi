import { describe, it, expect } from 'vitest';
import {
  buildBudgetReport,
  isoRange,
  lastSeriesBudgetChange,
  type DailyPoint,
} from './google-budget-report';

// August 2026, a campaign flighted the whole month, data through the 7th.
const WINDOW = isoRange('2026-08-01', '2026-08-31');
const DAYS_IN_MONTH = 31;

function series(spends: number[], dailyBudget: number | number[]): DailyPoint[] {
  return spends.map((spend, i) => ({
    date: WINDOW[i],
    spend,
    dailyBudget: Array.isArray(dailyBudget) ? dailyBudget[i] : dailyBudget,
  }));
}

describe('isoRange', () => {
  it('covers both endpoints', () => {
    expect(isoRange('2026-08-01', '2026-08-31')).toHaveLength(31);
    expect(isoRange('2026-08-05', '2026-08-05')).toEqual(['2026-08-05']);
  });

  it('crosses a month boundary without skipping a day', () => {
    expect(isoRange('2026-08-30', '2026-09-02')).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
  });

  it('yields nothing for a backwards range rather than looping forever', () => {
    expect(isoRange('2026-08-10', '2026-08-01')).toEqual([]);
  });
});

describe('buildBudgetReport', () => {
  const base = {
    window: WINDOW,
    target: 3100,
    currentDaily: 100,
    recentAvgDaily: 90,
    daysInMonth: DAYS_IN_MONTH,
  };

  it('charts the whole flight, not just the days with data', () => {
    const r = buildBudgetReport({ ...base, series: series(Array(7).fill(90), 100) });
    expect(r.days).toHaveLength(31);
    // Everything past the 7th is future — that gap is the point of the chart.
    expect(r.days.filter((d) => d.future)).toHaveLength(24);
    expect(r.edgeIndex).toBe(6);
  });

  it('accumulates cost to date and stops at the data edge', () => {
    const r = buildBudgetReport({ ...base, series: series(Array(7).fill(90), 100) });
    expect(r.costToDate).toBeCloseTo(630, 2);
    expect(r.days[6].cumulative).toBeCloseTo(630, 2);
    // Null, not a repeated last value: a flat line past the edge would read as
    // "it stopped spending" rather than "we do not know yet".
    expect(r.days[7].cumulative).toBeNull();
    expect(r.days[7].spend).toBeNull();
  });

  it('draws the target pace to exactly the target on the last day', () => {
    const r = buildBudgetReport({ ...base, series: series([90], 100) });
    expect(r.days[30].targetPace).toBeCloseTo(3100, 2);
    expect(r.days[0].targetPace).toBeCloseTo(100, 2);
  });

  it('holds the billing ceiling at daily × 30.4 when the budget never changes', () => {
    const r = buildBudgetReport({ ...base, series: series(Array(7).fill(90), 100) });
    for (const day of r.days) expect(day.billingCeiling).toBeCloseTo(3040, 1);
  });

  it('steps the ceiling — and records a change — when the daily budget moves', () => {
    // $100/day for six days, then $200/day.
    const budgets = [100, 100, 100, 100, 100, 100, 200];
    const r = buildBudgetReport({ ...base, series: series(Array(7).fill(90), budgets) });

    expect(r.changes).toEqual([{ date: '2026-08-07', from: 100, to: 200 }]);
    expect(r.days[6].budgetChange).toBe(true);
    expect(r.days[5].budgetChange).toBe(false);

    // Before the change the ceiling is the old rate × 30.4. After it, Google's
    // mid-month rule: what is already spent, plus the new rate over the calendar
    // days left — $540 spent through Aug 6, then $200 × the 25 days from Aug 7
    // to Aug 31 inclusive. NOT $200 × 30.4, which would price the six days at
    // $100 as though they had been $200 days.
    expect(r.days[5].billingCeiling).toBeCloseTo(3040, 1);
    expect(r.days[6].billingCeiling).toBeCloseTo(6 * 90 + 200 * 25, 1);
    expect(r.days[6].billingCeiling).toBeLessThan(200 * 30.4);
  });

  it('does not call day one a budget change', () => {
    const r = buildBudgetReport({ ...base, currentDaily: 250, series: series([90], 100) });
    expect(r.changes).toEqual([]);
    expect(r.days[0].budgetChange).toBe(false);
  });

  it('carries the current daily forward past the data edge', () => {
    const r = buildBudgetReport({
      ...base,
      currentDaily: 150,
      series: series(Array(7).fill(90), 100),
    });
    expect(r.days[6].dailyBudget).toBeCloseTo(100, 2);
    expect(r.days[10].dailyBudget).toBeCloseTo(150, 2);
  });

  it('draws the single-day limit at 2× the daily budget', () => {
    const r = buildBudgetReport({ ...base, series: series(Array(7).fill(90), 100) });
    expect(r.days[3].dailyLimit).toBeCloseTo(200, 2);
  });

  it('projects from the edge at recent pace, fanning out as it goes', () => {
    const r = buildBudgetReport({ ...base, series: series(Array(7).fill(90), 100) });
    const first = r.projection[0];
    const last = r.projection[r.projection.length - 1];
    // The band is pinned shut on the edge: the spend up to there is not a
    // forecast, so there is nothing to be uncertain about.
    expect(first.low).toBeCloseTo(630, 2);
    expect(first.high).toBeCloseTo(630, 2);
    expect(first.pace).toBeCloseTo(630, 2);
    // The line is recent delivery ($90/day) carried across the 24 days left…
    expect(last.pace).toBeCloseTo(630 + 90 * 24, 2);
    // …and the band widens around it rather than closing again, which is what
    // made the old pace-vs-daily version render as a lens.
    expect(last.high - last.low).toBeGreaterThan(first.high - first.low);
    expect(last.high).toBeLessThanOrEqual(r.days[30].billingCeiling);
    expect(last.low).toBeGreaterThanOrEqual(r.costToDate);
  });

  it('never lets the projection climb past what Google can bill', () => {
    // A daily budget far above anything the ceiling allows.
    const r = buildBudgetReport({
      ...base,
      currentDaily: 5000,
      recentAvgDaily: 5000,
      series: series(Array(7).fill(90), 100),
    });
    for (const p of r.projection) {
      expect(p.high).toBeLessThanOrEqual(r.days[p.index].billingCeiling + 0.01);
    }
  });

  it('projects nothing when there is no run rate to project from', () => {
    const r = buildBudgetReport({
      ...base,
      recentAvgDaily: null,
      series: series(Array(7).fill(90), 100),
    });
    expect(r.projection).toEqual([]);
  });

  it('survives a campaign with no synced days at all', () => {
    const r = buildBudgetReport({ ...base, series: [] });
    expect(r.days).toHaveLength(31);
    expect(r.days.every((d) => d.future)).toBe(true);
    expect(r.edgeIndex).toBeNull();
    expect(r.costToDate).toBe(0);
    expect(r.projection).toEqual([]);
  });
});

describe('lastSeriesBudgetChange — the change date the projection measures from (§D)', () => {
  it('returns the first day the new rate appears, not the last day of the old one', () => {
    const s = series([10, 10, 10, 10], [20, 20, 35, 35]);
    expect(lastSeriesBudgetChange(s)).toEqual({ date: '2026-08-03', from: 20, to: 35 });
  });

  it('returns the MOST RECENT change when a budget moved twice', () => {
    const s = series([10, 10, 10, 10, 10], [20, 35, 35, 50, 50]);
    expect(lastSeriesBudgetChange(s)?.date).toBe('2026-08-04');
  });

  it('agrees with the report own change markers', () => {
    const s = series([10, 10, 10, 10], [20, 20, 35, 35]);
    const report = buildBudgetReport({
      series: s,
      window: WINDOW,
      target: 900,
      currentDaily: 35,
      recentAvgDaily: 10,
      daysInMonth: DAYS_IN_MONTH,
    });
    expect(report.changes[report.changes.length - 1].date).toBe(lastSeriesBudgetChange(s)?.date);
  });

  it('ignores cent-level noise and days with no stored budget', () => {
    expect(lastSeriesBudgetChange(series([10, 10, 10], [20, 20.004, 20]))).toBeNull();
    expect(lastSeriesBudgetChange(series([10, 10], [null as unknown as number, null as unknown as number]))).toBeNull();
  });

  it('is null when the budget never moved', () => {
    expect(lastSeriesBudgetChange(series([10, 10, 10], 20))).toBeNull();
  });
});
