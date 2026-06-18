import { describe, it, expect } from 'vitest';
import {
  isEligibleForLivePacing,
  isLifetimeInProgress,
  isCrossMonthStraddler,
  effectiveActual,
  effectiveTarget,
  classifyAdVariance,
  decomposeMonthVariance,
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

  it("uses Meta's actual dates over the planner's for the boundary test", () => {
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
    ).toBe(true);
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

  it('excludes a flagged straddler from live pacing (§0.2 un-stub)', () => {
    const straddler = mk({
      adStatus: 'Live',
      budgetType: 'Daily',
      flightStart: '2026-05-29',
      flightEnd: '2026-06-05',
      allocation: '80',
      pacerActual: '49.79',
    });
    expect(isCrossMonthStraddler(straddler)).toBe(true);
    expect(isEligibleForLivePacing(straddler, NOW, TZ)).toBe(false);
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

// Cross-month clarity — per-ad variance contribution + the real-vs-timing split
// that powers the "this gap is just timing, not an over/under" callouts.
describe('classifyAdVariance / decomposeMonthVariance (cross-month clarity)', () => {
  it('a normal ad is real — contribution = actual − allocation', () => {
    const v = classifyAdVariance(mk({ allocation: '100', pacerActual: '120' }), PERIOD, NOW, TZ);
    expect(v.klass).toBe('real');
    expect(v.contribution).toBeCloseTo(20);
    expect(v.heldOutSpend).toBe(0);
  });

  it('an UNRESOLVED daily straddler is timing — its slice-vs-target shortfall', () => {
    const v = classifyAdVariance(
      mk({ flightStart: '2026-05-29', flightEnd: '2026-06-05', allocation: '80', pacerActual: '49.79' }),
      PERIOD,
      NOW,
      TZ,
    );
    expect(v.klass).toBe('timing-straddler');
    expect(v.contribution).toBeCloseTo(49.79 - 80);
  });

  it('a straddler RESOLVED into its own month is real — full run vs full target', () => {
    const v = classifyAdVariance(
      mk({
        period: '2026-06',
        fullRunAppliedToMonth: '2026-06',
        flightStart: '2026-05-29',
        flightEnd: '2026-06-05',
        allocation: '80',
        pacerActual: '49.79',
        pacerRunSpend: '79.91',
      }),
      '2026-06',
      NOW,
      TZ,
    );
    expect(v.klass).toBe('real');
    expect(v.contribution).toBeCloseTo(79.91 - 80);
  });

  it('a resolved straddler viewed in a DIFFERENT month contributes 0', () => {
    const v = classifyAdVariance(
      mk({ period: '2026-06', fullRunAppliedToMonth: '2026-06', allocation: '80', pacerActual: '49.79', pacerRunSpend: '79.91' }),
      '2026-07',
      NOW,
      TZ,
    );
    expect(v.contribution).toBe(0);
  });

  it('an in-progress lifetime ad is timing-lifetime — $0 booked, spend held out', () => {
    const v = classifyAdVariance(
      mk({ budgetType: 'Lifetime', adStatus: 'Live', allocation: '500', pacerActual: '180' }),
      PERIOD,
      NOW,
      TZ,
    );
    expect(v.klass).toBe('timing-lifetime');
    expect(v.contribution).toBe(0);
    expect(v.heldOutSpend).toBeCloseTo(180);
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

  it('decomposeMonthVariance splits real vs timing vs held-out lifetime', () => {
    const ads = [
      mk({ allocation: '100', pacerActual: '120' }), // real +20
      mk({ flightStart: '2026-05-29', flightEnd: '2026-06-05', allocation: '80', pacerActual: '49.79' }), // timing −30.21
      mk({ budgetType: 'Lifetime', adStatus: 'Live', allocation: '500', pacerActual: '180' }), // held-out 180
    ];
    const d = decomposeMonthVariance(ads, PERIOD, NOW, TZ);
    expect(d.real).toBeCloseTo(20);
    expect(d.timing).toBeCloseTo(49.79 - 80);
    expect(d.heldOutLifetime).toBeCloseTo(180);
    expect(d.timingAdCount).toBe(1);
    expect(d.heldOutAdCount).toBe(1);
    expect(d.perAd).toHaveLength(3);
  });
});
