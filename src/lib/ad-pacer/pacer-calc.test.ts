import { describe, it, expect } from 'vitest';
import {
  isEligibleForLivePacing,
  isLifetimeInProgress,
  isCrossMonthStraddler,
  effectiveActual,
  effectiveTarget,
  classifyAdVariance,
  decomposeMonthVariance,
  clampToMonth,
} from './pacer-calc';
import type { PacerAd } from './types';

// §0.2 eligibility for live account pacing. Mid-June 2026 in the account zone,
// so "today" resolves to 2026-06-15 and a June flight starting on the 1st is
// already running while one starting on the 20th has not begun.
const NOW = Date.UTC(2026, 5, 15, 18, 0, 0); // 2026-06-15 12:00 MDT
const TZ = 'America/Denver';
const PERIOD = '2026-06';

// The predicate only reads adStatus, budgetType, and the flight dates (via
// clampToMonth); a minimal object is enough for the unit under test.
function mk(overrides: Partial<PacerAd>): PacerAd {
  return {
    adStatus: 'Live',
    budgetType: 'Daily',
    period: PERIOD,
    flightStart: '2026-06-01',
    flightEnd: '2026-06-30',
    metaStartDate: null,
    metaEndDate: null,
    liveDate: null,
    ...overrides,
  } as unknown as PacerAd;
}

describe('isEligibleForLivePacing (§0.2)', () => {
  it('includes a live, started, daily ad (e.g. a running carousel)', () => {
    expect(isEligibleForLivePacing(mk({}), NOW, TZ)).toBe(true);
  });

  it("includes 'Live - Changes Required' (still delivering spend)", () => {
    expect(
      isEligibleForLivePacing(mk({ adStatus: 'Live - Changes Required' }), NOW, TZ),
    ).toBe(true);
  });

  it('excludes a not-yet-started flight (the Sidewalk Sale ads)', () => {
    expect(
      isEligibleForLivePacing(mk({ flightStart: '2026-06-20' }), NOW, TZ),
    ).toBe(false);
  });

  it('excludes non-delivering statuses (Scheduled / Waiting on Rep)', () => {
    expect(isEligibleForLivePacing(mk({ adStatus: 'Scheduled' }), NOW, TZ)).toBe(
      false,
    );
    expect(
      isEligibleForLivePacing(mk({ adStatus: 'Waiting on Rep' }), NOW, TZ),
    ).toBe(false);
  });

  it('excludes a completed run (the Bike Night runs)', () => {
    expect(
      isEligibleForLivePacing(mk({ adStatus: 'Completed Run' }), NOW, TZ),
    ).toBe(false);
  });

  it('excludes an Off ad', () => {
    expect(isEligibleForLivePacing(mk({ adStatus: 'Off' }), NOW, TZ)).toBe(false);
  });

  it('excludes a lifetime ad — booked once on completion (§3), not paced (CFMOTO Event Ad)', () => {
    expect(
      isEligibleForLivePacing(mk({ budgetType: 'Lifetime' }), NOW, TZ),
    ).toBe(false);
  });

  it("uses Meta's actual start over the planner's (a late launch isn't paced yet)", () => {
    expect(
      isEligibleForLivePacing(mk({ metaStartDate: '2026-06-20' }), NOW, TZ),
    ).toBe(false);
  });
});

// §3 — a LIFETIME ad still running is excluded from the over/under base (both
// its actual slice and its allocation) so it contributes $0 variance; once it
// completes it re-enters the base and books its single variance naturally.
describe('isLifetimeInProgress (§3)', () => {
  it('flags a lifetime ad that is live and has started', () => {
    expect(
      isLifetimeInProgress(mk({ budgetType: 'Lifetime', adStatus: 'Live' }), NOW, TZ),
    ).toBe(true);
  });

  it("flags a 'Live - Changes Required' lifetime ad (still delivering)", () => {
    expect(
      isLifetimeInProgress(
        mk({ budgetType: 'Lifetime', adStatus: 'Live - Changes Required' }),
        NOW,
        TZ,
      ),
    ).toBe(true);
  });

  it('does NOT flag a daily ad (only lifetime ads leave the base while running)', () => {
    expect(isLifetimeInProgress(mk({ budgetType: 'Daily' }), NOW, TZ)).toBe(false);
  });

  it('does NOT flag a COMPLETED lifetime ad — it re-enters the base and books once', () => {
    expect(
      isLifetimeInProgress(
        mk({ budgetType: 'Lifetime', adStatus: 'Completed Run' }),
        NOW,
        TZ,
      ),
    ).toBe(false);
  });

  it('does NOT flag an Off lifetime ad', () => {
    expect(
      isLifetimeInProgress(mk({ budgetType: 'Lifetime', adStatus: 'Off' }), NOW, TZ),
    ).toBe(false);
  });

  it('does NOT flag a not-yet-started lifetime ad', () => {
    expect(
      isLifetimeInProgress(
        mk({ budgetType: 'Lifetime', adStatus: 'Live', flightStart: '2026-06-20' }),
        NOW,
        TZ,
      ),
    ).toBe(false);
  });
});

// §1 — a daily ad whose flight straddles a month boundary with a materially
// short in-month slice is flagged ("variance expected") and excluded from the
// account pacing badge. The Bike Night case ($49.79 May slice / $80 full target,
// $79.91 full run) is the canonical example from the spec.
describe('isCrossMonthStraddler (§1)', () => {
  it('flags the Bike Night case (May 29 – Jun 5, $49.79 slice / $80 target)', () => {
    expect(
      isCrossMonthStraddler(
        mk({
          flightStart: '2026-05-29',
          flightEnd: '2026-06-05',
          allocation: '80',
          pacerActual: '49.79',
        }),
      ),
    ).toBe(true);
  });

  it('does NOT flag a flight ~95% within one month (slice near full target)', () => {
    expect(
      isCrossMonthStraddler(
        mk({
          flightStart: '2026-05-29',
          flightEnd: '2026-06-02',
          allocation: '80',
          pacerActual: '76',
        }),
      ),
    ).toBe(false);
  });

  it('does NOT flag a single-calendar-month flight (no boundary crossed)', () => {
    expect(
      isCrossMonthStraddler(
        mk({
          flightStart: '2026-06-01',
          flightEnd: '2026-06-20',
          allocation: '80',
          pacerActual: '40',
        }),
      ),
    ).toBe(false);
  });

  it('detects on the planner FLIGHT window, not Meta\'s actual run dates', () => {
    // Planned cross-month (May 29 → Jun 5) flags, even though Meta reported a
    // single-month run — detection follows the plan.
    expect(
      isCrossMonthStraddler(
        mk({
          flightStart: '2026-05-29',
          flightEnd: '2026-06-05',
          metaStartDate: '2026-06-01',
          metaEndDate: '2026-06-10',
          allocation: '80',
          pacerActual: '49.79',
        }),
      ),
    ).toBe(true);
    // Inverse: planned single-month, but Meta straddled → NOT flagged.
    expect(
      isCrossMonthStraddler(
        mk({
          flightStart: '2026-06-01',
          flightEnd: '2026-06-10',
          metaStartDate: '2026-05-29',
          metaEndDate: '2026-06-05',
          allocation: '80',
          pacerActual: '49.79',
        }),
      ),
    ).toBe(false);
  });

  it('does NOT flag a LIFETIME straddler (owned by §3 / §2b, not §1)', () => {
    expect(
      isCrossMonthStraddler(
        mk({
          budgetType: 'Lifetime',
          flightStart: '2026-05-29',
          flightEnd: '2026-06-05',
          allocation: '80',
          pacerActual: '49.79',
        }),
      ),
    ).toBe(false);
  });

  it('does NOT flag when there is no target to judge against', () => {
    expect(
      isCrossMonthStraddler(
        mk({ flightStart: '2026-05-29', flightEnd: '2026-06-05', pacerActual: '49.79' }),
      ),
    ).toBe(false);
  });

  it('no longer auto-excludes a cross-month daily ad from live pacing', () => {
    const straddler = mk({
      adStatus: 'Live',
      budgetType: 'Daily',
      flightStart: '2026-05-29',
      flightEnd: '2026-06-05',
      allocation: '80',
      pacerActual: '49.79',
    });
    // The predicate still recognizes the cross-month flight, but eligibility no
    // longer consults it (no auto-detect) — a mid-flight daily ad is paced on
    // its own window (§7), not silently dropped.
    expect(isCrossMonthStraddler(straddler)).toBe(true);
    expect(isEligibleForLivePacing(straddler, NOW, TZ)).toBe(true);
  });
});

// §2 — a resolved straddler counts its FULL run + full target in its own month;
// any other month it touched contributes 0 (count-once). Unresolved ads are the
// month slice, unchanged.
describe('effectiveActual / effectiveTarget (§2)', () => {
  it('unresolved → the month slice + month allocation', () => {
    const ad = mk({ allocation: '80', pacerActual: '49.79', pacerRunSpend: '79.91' });
    expect(effectiveActual(ad)).toBeCloseTo(49.79);
    expect(effectiveTarget(ad)).toBeCloseTo(80);
  });

  it('resolved in its own month → full run + full target', () => {
    const ad = mk({
      period: '2026-06',
      fullRunAppliedToMonth: '2026-06',
      allocation: '80',
      pacerActual: '49.79',
      pacerRunSpend: '79.91',
    });
    expect(effectiveActual(ad)).toBeCloseTo(79.91);
    expect(effectiveTarget(ad)).toBeCloseTo(80);
  });

  it('resolved but pacerRunSpend missing → falls back to the slice', () => {
    const ad = mk({
      period: '2026-06',
      fullRunAppliedToMonth: '2026-06',
      allocation: '80',
      pacerActual: '49.79',
      pacerRunSpend: null,
    });
    expect(effectiveActual(ad)).toBeCloseTo(49.79);
  });

  it('resolved into a DIFFERENT month → contributes 0 there (count-once)', () => {
    const ad = mk({
      period: '2026-06',
      fullRunAppliedToMonth: '2026-06',
      allocation: '80',
      pacerActual: '49.79',
      pacerRunSpend: '79.91',
    });
    expect(effectiveActual(ad, '2026-07')).toBe(0);
    expect(effectiveTarget(ad, '2026-07')).toBe(0);
  });
});

// Cross-month split — inMonthSpend (what spent this calendar month) vs
// billedActual (what the over/under counts). No auto-detection; cross-month is
// the user's manual "Bill in one month" choice (fullRunAppliedToMonth).
describe('classifyAdVariance / decomposeMonthVariance (cross-month split)', () => {
  it('a normal ad is real — billed equals the in-month slice', () => {
    const v = classifyAdVariance(mk({ allocation: '100', pacerActual: '120' }), PERIOD, NOW, TZ);
    expect(v.klass).toBe('real');
    expect(v.inMonthSpend).toBeCloseTo(120);
    expect(v.billedActual).toBeCloseTo(120);
    expect(v.contribution).toBeCloseTo(20);
  });

  it('a daily cross-month ad is NOT auto-flagged — real, billed = slice', () => {
    const v = classifyAdVariance(
      mk({ flightStart: '2026-05-29', flightEnd: '2026-06-05', allocation: '80', pacerActual: '49.79' }),
      PERIOD,
      NOW,
      TZ,
    );
    expect(v.klass).toBe('real');
    expect(v.billedActual).toBeCloseTo(49.79);
    expect(v.contribution).toBeCloseTo(49.79 - 80);
  });

  it('billed in one month → billed-cross-month: full run billed, slice spent here', () => {
    const v = classifyAdVariance(
      mk({
        period: '2026-06',
        fullRunAppliedToMonth: '2026-06',
        allocation: '80',
        pacerActual: '49.79', // in-month slice
        pacerRunSpend: '79.91', // full run
      }),
      '2026-06',
      NOW,
      TZ,
    );
    expect(v.klass).toBe('billed-cross-month');
    expect(v.inMonthSpend).toBeCloseTo(49.79);
    expect(v.billedActual).toBeCloseTo(79.91);
    expect(v.contribution).toBeCloseTo(79.91 - 80);
  });

  it('billed in one month but full run == slice → stays real (no cross-month gap)', () => {
    const v = classifyAdVariance(
      mk({
        period: '2026-06',
        fullRunAppliedToMonth: '2026-06',
        allocation: '80',
        pacerActual: '79.91',
        pacerRunSpend: '79.91',
      }),
      '2026-06',
      NOW,
      TZ,
    );
    expect(v.klass).toBe('real');
  });

  it('an in-progress lifetime ad → lifetime-in-progress: $0 billed, slice held out', () => {
    const v = classifyAdVariance(
      mk({ budgetType: 'Lifetime', adStatus: 'Live', allocation: '500', pacerActual: '180' }),
      PERIOD,
      NOW,
      TZ,
    );
    expect(v.klass).toBe('lifetime-in-progress');
    expect(v.billedActual).toBe(0);
    expect(v.contribution).toBe(0);
    expect(v.inMonthSpend).toBeCloseTo(180);
    // Flight ends this month → settles at month-close, NOT deferred (Prompt 2).
    expect(v.settlesThisMonth).toBe(true);
  });

  it('a single-month ad settles this month; a cross-month lifetime run is deferred', () => {
    const single = classifyAdVariance(mk({ allocation: '100', pacerActual: '120' }), PERIOD, NOW, TZ);
    expect(single.settlesThisMonth).toBe(true);
    // Lifetime run whose flight extends into a later month → deferred (settles
    // in the final month at flight completion), so settlesThisMonth is false.
    const crossMonth = classifyAdVariance(
      mk({
        budgetType: 'Lifetime',
        adStatus: 'Live',
        flightEnd: '2026-07-20',
        allocation: '500',
        pacerActual: '180',
      }),
      PERIOD,
      NOW,
      TZ,
    );
    expect(crossMonth.klass).toBe('lifetime-in-progress');
    expect(crossMonth.settlesThisMonth).toBe(false);
  });

  it('a stale metaEndDate (prior run) does not mask a cross-month lifetime run', () => {
    // Genuine cross-month run (planner flightEnd in July) but the ad set still
    // carries a prior run's stop date in May — the stale-end guard must defer to
    // flightEnd, so the run is still recognized as deferred (settles later).
    const v = classifyAdVariance(
      mk({
        budgetType: 'Lifetime',
        adStatus: 'Live',
        flightEnd: '2026-07-15',
        metaEndDate: '2026-05-20', // stale — before the pacing month
        allocation: '500',
        pacerActual: '180',
      }),
      PERIOD,
      NOW,
      TZ,
    );
    expect(v.klass).toBe('lifetime-in-progress');
    expect(v.settlesThisMonth).toBe(false);
  });

  it('an open-ended lifetime run (no end date) settles this month, not deferred', () => {
    const v = classifyAdVariance(
      mk({
        budgetType: 'Lifetime',
        adStatus: 'Live',
        flightEnd: null,
        metaEndDate: null,
        allocation: '500',
        pacerActual: '180',
      }),
      PERIOD,
      NOW,
      TZ,
    );
    expect(v.klass).toBe('lifetime-in-progress');
    expect(v.settlesThisMonth).toBe(true);
  });

  it('a COMPLETED lifetime ad is real — its single variance books', () => {
    const v = classifyAdVariance(
      mk({ budgetType: 'Lifetime', adStatus: 'Completed Run', allocation: '500', pacerActual: '520' }),
      PERIOD,
      NOW,
      TZ,
    );
    expect(v.klass).toBe('real');
    expect(v.contribution).toBeCloseTo(20);
  });

  it('decomposeMonthVariance reconciles total-spent vs over/under basis + the gap', () => {
    const ads = [
      mk({ allocation: '100', pacerActual: '120' }), // real: in 120 / billed 120
      mk({
        period: '2026-06',
        fullRunAppliedToMonth: '2026-06',
        allocation: '80',
        pacerActual: '49.79',
        pacerRunSpend: '79.91',
      }), // billed-cross-month: in 49.79 / billed 79.91
      mk({ budgetType: 'Lifetime', adStatus: 'Live', allocation: '500', pacerActual: '180' }), // lifetime in-progress: in 180 / billed 0
    ];
    const d = decomposeMonthVariance(ads, PERIOD, NOW, TZ);
    expect(d.totalInMonth).toBeCloseTo(120 + 49.79 + 180); // what spent this month
    expect(d.overUnderActual).toBeCloseTo(120 + 79.91 + 0); // over/under basis
    expect(d.billedElsewhere).toBeCloseTo(79.91 - 49.79); // billed cross-month
    expect(d.heldOutLifetime).toBeCloseTo(180);
    expect(d.crossMonthCount).toBe(1);
    expect(d.heldOutCount).toBe(1);
    expect(d.heldOutDeferredCount).toBe(0); // its flight ends this month
    expect(d.perAd).toHaveLength(3);
  });
});

describe('clampToMonth — Meta end vs planner flight', () => {
  it('a same-month Meta end still wins over a later planner flight end', () => {
    const { effectiveEnd } = clampToMonth(
      mk({ metaEndDate: '2026-06-10', flightEnd: '2026-06-30' }),
    );
    expect(effectiveEnd).toBe('2026-06-10');
  });

  it('a STALE Meta end (before the pacing month) defers to the planner flight', () => {
    // Recurring ad: the linked ad set still carries last month's end date, but
    // the planner flight was extended into June. June must not read as complete.
    const { effectiveEnd } = clampToMonth(
      mk({ metaEndDate: '2026-05-20', flightEnd: '2026-06-30', period: '2026-06' }),
    );
    expect(effectiveEnd).toBe('2026-06-30');
  });

  it('falls back to the planner flight when there is no Meta end', () => {
    const { effectiveEnd } = clampToMonth(
      mk({ metaEndDate: null, flightEnd: '2026-06-20' }),
    );
    expect(effectiveEnd).toBe('2026-06-20');
  });

  it('clamps a flight that runs past the month to the month end', () => {
    const { effectiveEnd } = clampToMonth(
      mk({ metaEndDate: null, flightEnd: '2026-07-15', period: '2026-06' }),
    );
    expect(effectiveEnd).toBe('2026-06-30');
  });
});
