import { describe, it, expect } from 'vitest';
import {
  reconcileSeriesBudgets,
  dailySpendKey,
  type DailySpendWriteRow,
} from './meta-ads-pacer';

// ─── reconcileSeriesBudgets: historical budget-in-effect preservation ────────
//
// Meta/Google report only the CURRENT budget, so an incremental re-pull carries
// today's budget on every row. reconcileSeriesBudgets must keep a past day's
// already-stored budget and let only today's row (`until`) take the new one —
// otherwise a mid-flight raise erases the pre-change history the budget-change
// divider + "ramping" annotation read.

const UNTIL = '2026-07-22'; // "today" for the sync window

function row(
  date: string,
  spend: number,
  dailyBudget: number | null,
  objectId = 'as1',
): DailySpendWriteRow {
  return { objectId, date, spend, dailyBudget };
}

describe('reconcileSeriesBudgets', () => {
  it('preserves a past day’s stored budget over the incoming current budget', () => {
    // Budget was raised $6 → $19.09; the re-pull carries $19.09 on every row.
    const rows = [
      row('2026-07-20', 5.55, 19.09), // pre-raise day, already stored at $6
      row('2026-07-21', 6.8, 19.09), // raise day, already stored at $19.09
      row('2026-07-22', 1.99, 19.09), // today
    ];
    const prior = new Map<string, string>([
      [dailySpendKey('as1', '2026-07-20'), '6.00'],
      [dailySpendKey('as1', '2026-07-21'), '19.09'],
    ]);
    const out = reconcileSeriesBudgets(rows, prior, UNTIL);
    expect(out.map((r) => r.dailyBudget)).toEqual(['6.00', '19.09', '19.09']);
    // Spend is always taken fresh, formatted to cents.
    expect(out.map((r) => r.spend)).toEqual(['5.55', '6.80', '1.99']);
  });

  it("today's row always takes the incoming current budget (a same-day raise updates it)", () => {
    const rows = [row('2026-07-22', 1.99, 19.09)];
    // Even if today already had a stored budget, today re-syncs to current.
    const prior = new Map<string, string>([
      [dailySpendKey('as1', '2026-07-22'), '6.00'],
    ]);
    const out = reconcileSeriesBudgets(rows, prior, UNTIL);
    expect(out[0].dailyBudget).toBe('19.09');
  });

  it('first backfill (no prior rows) stamps the current budget on every day', () => {
    const rows = [
      row('2026-07-18', 5.1, 6),
      row('2026-07-19', 4.2, 6),
      row('2026-07-22', 1.99, 6),
    ];
    const out = reconcileSeriesBudgets(rows, new Map(), UNTIL);
    expect(out.map((r) => r.dailyBudget)).toEqual(['6.00', '6.00', '6.00']);
  });

  it('carries a null budget through when neither prior nor incoming has one', () => {
    const rows = [row('2026-07-19', 4.2, null)];
    const out = reconcileSeriesBudgets(rows, new Map(), UNTIL);
    expect(out[0].dailyBudget).toBeNull();
  });

  it('keeps a stored budget for a past day even when the incoming budget is null', () => {
    // A CBO/unsynced re-pull may lose the budget; the past day keeps its history.
    const rows = [row('2026-07-20', 5.55, null)];
    const prior = new Map<string, string>([
      [dailySpendKey('as1', '2026-07-20'), '6.00'],
    ]);
    const out = reconcileSeriesBudgets(rows, prior, UNTIL);
    expect(out[0].dailyBudget).toBe('6.00');
  });

  it('scopes preservation per object (same date, different ad sets)', () => {
    const rows = [
      row('2026-07-20', 5.55, 19.09, 'as1'),
      row('2026-07-20', 3.0, 10.0, 'as2'),
    ];
    const prior = new Map<string, string>([
      [dailySpendKey('as1', '2026-07-20'), '6.00'],
      // as2 has no stored history → takes its incoming budget.
    ]);
    const out = reconcileSeriesBudgets(rows, prior, UNTIL);
    expect(out.find((r) => r.objectId === 'as1')?.dailyBudget).toBe('6.00');
    expect(out.find((r) => r.objectId === 'as2')?.dailyBudget).toBe('10.00');
  });
});
