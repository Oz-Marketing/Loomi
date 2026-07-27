import { describe, it, expect } from 'vitest';
import {
  computeMetaPacingHealth,
  deriveOverageAllowance,
  buildMetaRecommendation,
  buildGoogleRecommendation,
  onTrackTolerance,
  detectBudgetChange,
  budgetRampStatus,
  buildHealthHoverRows,
  type DailySpendPoint,
  type PacingHealth,
} from './pacing-engine';

const TZ = 'America/Denver';

/** A resolved health object for the state-machine tests (which gate on the
 *  verdict + run rate, not on how the window was computed). */
function health(overrides: Partial<PacingHealth>): PacingHealth {
  return {
    windowDays: 7,
    windowSpend: 0,
    expected: 0,
    pacingRatio: 1,
    runRate: 0,
    verdict: 'healthy',
    spendToday: null,
    ...overrides,
  };
}

// ─── Meta pacing health (spec §3) ───────────────────────────────────────────

describe('computeMetaPacingHealth', () => {
  // Worked example (Low Rider ST): live Jul 6, measured Jul 10 @ ~16:31 MDT
  // → days_live ≈ 4.69 from midnight (the spec's 3.90 measured from the 19:00
  // go-live; Loomi stores dates only, so the window starts at midnight).
  const NOW = Date.UTC(2026, 6, 10, 22, 31, 0); // Jul 10 2026, 16:31 MDT

  it('young ad (≤7 days live): all-time equals the window, healthy verdict', () => {
    const h = computeMetaPacingHealth({
      dailyBudget: 11.55,
      liveDateIso: '2026-07-06',
      series: [],
      cumulativeSpend: 42.35,
      nowMs: NOW,
      timeZone: TZ,
    });
    expect(h.windowDays).toBeCloseTo(4.69, 2);
    expect(h.windowSpend).toBeCloseTo(42.35, 2);
    // 42.35 / (11.55 × 4.69) ≈ 0.78 — soft from midnight-counting; with the
    // spec's 3.90 intra-day figure it would be 0.94. Verdict bands still apply.
    expect(h.pacingRatio).toBeCloseTo(42.35 / (11.55 * 4.69), 2);
    expect(h.runRate).toBeCloseTo(42.35 / 4.69, 2);
    expect(h.verdict).toBe('soft');
  });

  it('young ad prefers the series sum over the cumulative fallback', () => {
    const series: DailySpendPoint[] = [
      { date: '2026-07-06', spend: 10, dailyBudget: 11.55 },
      { date: '2026-07-07', spend: 11, dailyBudget: 11.55 },
      { date: '2026-07-08', spend: 12, dailyBudget: 11.55 },
      { date: '2026-07-09', spend: 11, dailyBudget: 11.55 },
      { date: '2026-07-10', spend: 8, dailyBudget: 11.55 },
    ];
    const h = computeMetaPacingHealth({
      dailyBudget: 11.55,
      liveDateIso: '2026-07-06',
      series,
      cumulativeSpend: 9999, // ignored when the series is present
      nowMs: NOW,
      timeZone: TZ,
    });
    expect(h.windowSpend).toBeCloseTo(52, 2);
    expect(h.spendToday).toBeCloseTo(8, 2);
  });

  it('older ad (>7 days live): rolling window over the last 7 dates', () => {
    // Live since June 1; window = Jul 4..Jul 10 (today partial).
    const series: DailySpendPoint[] = [];
    for (let d = 1; d <= 10; d++) {
      series.push({
        date: `2026-07-${String(d).padStart(2, '0')}`,
        spend: 10,
        dailyBudget: 10,
      });
    }
    const h = computeMetaPacingHealth({
      dailyBudget: 10,
      liveDateIso: '2026-06-01',
      series,
      cumulativeSpend: null,
      nowMs: NOW,
      timeZone: TZ,
    });
    expect(h.windowSpend).toBeCloseTo(70, 2); // Jul 4..10 inclusive
    // Span = 6 full days + today's elapsed fraction (16:31 ≈ 0.69).
    expect(h.windowDays).toBeCloseTo(6.69, 2);
    expect(h.pacingRatio).toBeCloseTo(70 / (10 * 6.69), 2);
    expect(h.verdict).toBe('healthy');
  });

  it('older ad without a synced series: verdict withheld (needs the series)', () => {
    const h = computeMetaPacingHealth({
      dailyBudget: 10,
      liveDateIso: '2026-06-01',
      series: [],
      cumulativeSpend: 400,
      nowMs: NOW,
      timeZone: TZ,
    });
    expect(h.verdict).toBeNull();
    expect(h.pacingRatio).toBeNull();
  });

  it('a recent break shows as low even after earlier good days', () => {
    const series: DailySpendPoint[] = [];
    for (let d = 1; d <= 10; d++) {
      series.push({
        date: `2026-07-${String(d).padStart(2, '0')}`,
        spend: d <= 6 ? 10 : 0, // feed died Jul 7
        dailyBudget: 10,
      });
    }
    const h = computeMetaPacingHealth({
      dailyBudget: 10,
      liveDateIso: '2026-06-01',
      series,
      cumulativeSpend: null,
      nowMs: NOW,
      timeZone: TZ,
    });
    // Window Jul 4..10: three good days then zeros → 30 / 66.9 ≈ 0.45.
    expect(h.verdict).toBe('low');
    expect(h.spendToday).toBe(0);
  });

  it('withholds a verdict under the minimum-history floor', () => {
    const h = computeMetaPacingHealth({
      dailyBudget: 10,
      liveDateIso: '2026-07-10', // went live today; now is 16:31 → <1d but ≥0.5d
      series: [],
      cumulativeSpend: 3,
      nowMs: Date.UTC(2026, 6, 10, 8, 0, 0), // 02:00 MDT → 0.08 days live
      timeZone: TZ,
    });
    expect(h.verdict).toBeNull();
  });
});

// ─── Pacing-health time-anchor fix (P1): denominator → data edge ─────────────

describe('computeMetaPacingHealth — data-edge anchoring', () => {
  // Certified Pre-Owned card: flight Jul 1–31, daily $5.37. The rolling window
  // (Jul 17–22) sums $23.63; the data edge is Jul 22 at ~10:19 MDT (last sync,
  // trailing partial $0.56) while the clock is a full day ahead (Jul 23 10:19).
  const CPO_SERIES: DailySpendPoint[] = [
    { date: '2026-07-17', spend: 5.0, dailyBudget: 5.37 },
    { date: '2026-07-18', spend: 4.8, dailyBudget: 5.37 },
    { date: '2026-07-19', spend: 5.1, dailyBudget: 5.37 },
    { date: '2026-07-20', spend: 4.2, dailyBudget: 5.37 },
    { date: '2026-07-21', spend: 3.97, dailyBudget: 5.37 },
    { date: '2026-07-22', spend: 0.56, dailyBudget: 5.37 },
  ];
  const CLOCK = Date.UTC(2026, 6, 23, 16, 19, 0); // Jul 23 10:19 MDT
  const DATA_EDGE = Date.UTC(2026, 6, 22, 16, 19, 0); // Jul 22 10:19 MDT

  it('anchors the denominator to the data edge, not the clock (→ 81%, not 68%)', () => {
    const h = computeMetaPacingHealth({
      dailyBudget: 5.37,
      liveDateIso: '2026-07-01',
      series: CPO_SERIES,
      cumulativeSpend: null,
      nowMs: CLOCK,
      syncedAtMs: DATA_EDGE,
      timeZone: TZ,
    });
    expect(h.windowSpend).toBeCloseTo(23.63, 2); // numerator unchanged
    expect(h.windowDays).toBeCloseTo(5.43, 2); // data edge, NOT 6.43 (clock)
    expect(h.pacingRatio!).toBeCloseTo(0.81, 2); // NOT the deflated 0.68
    expect(h.verdict).toBe('soft'); // ≥0.75 → the "underdelivering" warning won't fire
  });

  it('does not deflate: the same data read to the clock would score lower', () => {
    const h = computeMetaPacingHealth({
      dailyBudget: 5.37,
      liveDateIso: '2026-07-01',
      series: CPO_SERIES,
      cumulativeSpend: null,
      nowMs: CLOCK,
      syncedAtMs: DATA_EDGE,
      timeZone: TZ,
    });
    const deflatedToClock = h.windowSpend / (5.37 * 6.43); // phantom sync-lag day
    expect(h.windowDays).toBeLessThan(6.43);
    expect(h.pacingRatio!).toBeGreaterThan(deflatedToClock);
  });

  it('fresh sync (data edge == now) is byte-identical to the pre-fix path', () => {
    const series: DailySpendPoint[] = [];
    for (let d = 1; d <= 10; d++) {
      series.push({
        date: `2026-07-${String(d).padStart(2, '0')}`,
        spend: 10,
        dailyBudget: 10,
      });
    }
    const NOW = Date.UTC(2026, 6, 10, 22, 31, 0);
    const base = {
      dailyBudget: 10,
      liveDateIso: '2026-06-01',
      series,
      cumulativeSpend: null,
      nowMs: NOW,
      timeZone: TZ,
    };
    const withSync = computeMetaPacingHealth({ ...base, syncedAtMs: NOW });
    const withoutSync = computeMetaPacingHealth(base); // falls back to now()
    expect(withSync.windowDays).toBeCloseTo(6.69, 2);
    expect(withSync.windowDays).toBeCloseTo(withoutSync.windowDays, 6);
    expect(withSync.pacingRatio!).toBeCloseTo(withoutSync.pacingRatio!, 6);
  });
});

// ─── Overage allowance (spec §5.2) ──────────────────────────────────────────

describe('deriveOverageAllowance', () => {
  const mkSeries = (n: number, ratioHot: number): DailySpendPoint[] =>
    Array.from({ length: n }, (_, i) => ({
      date: `2026-06-${String(i + 1).padStart(2, '0')}`,
      spend: i === 3 ? 10 * ratioHot : 9.8,
      dailyBudget: 10,
    }));

  it('reads a 75% account from a ~1.75× hot day', () => {
    expect(deriveOverageAllowance(mkSeries(20, 1.75))).toBeCloseTo(0.75, 2);
  });

  it('floors at 25% when the hottest day barely exceeded budget', () => {
    expect(deriveOverageAllowance(mkSeries(20, 1.1))).toBeCloseTo(0.25, 2);
  });

  it('caps at 75% even if a day somehow read hotter', () => {
    expect(deriveOverageAllowance(mkSeries(20, 2.4))).toBeCloseTo(0.75, 2);
  });

  it('falls back with thin history or no hot day', () => {
    expect(deriveOverageAllowance(mkSeries(5, 1.75), { fallback: 0.3 })).toBe(0.3);
    expect(deriveOverageAllowance(mkSeries(20, 0.9), { fallback: 0.3 })).toBe(0.3);
  });

  it('ignores today (a partial day only under-reads the ceiling)', () => {
    const series = mkSeries(20, 1.0);
    series.push({ date: '2026-06-30', spend: 2, dailyBudget: 10 });
    expect(
      deriveOverageAllowance(series, { todayIso: '2026-06-30', fallback: 0.75 }),
    ).toBe(0.75);
  });
});

// ─── Tolerance tightening ───────────────────────────────────────────────────

describe('onTrackTolerance', () => {
  it('is the full band early and the floor near the end', () => {
    expect(onTrackTolerance(1)).toBeCloseTo(0.05, 3);
    expect(onTrackTolerance(0.5)).toBeCloseTo(0.025, 3);
    expect(onTrackTolerance(0.01)).toBeCloseTo(0.02, 3); // floored
  });
});

// ─── Meta recommendation state machine (spec §5) ────────────────────────────

describe('buildMetaRecommendation', () => {
  it('on track (Low Rider ST): projection within tolerance, no number', () => {
    const rec = buildMetaRecommendation({
      target: 288.75,
      actualSpend: 42.35,
      daysRemaining: 21.34,
      totalDays: 26,
      dailyBudget: 11.55,
      health: health({ pacingRatio: 0.94, runRate: 11.55, verdict: 'healthy' }),
      overageAllowance: 0.75,
    })!;
    // projected_runrate = 42.35 + 11.55 × 21.34 = 288.83 ≈ target
    expect(rec.projectedRunrate).toBeCloseTo(288.83, 1);
    expect(rec.state).toBe('on_track');
  });

  it('adjust, raise (healthy but behind, achievable)', () => {
    const rec = buildMetaRecommendation({
      target: 360,
      actualSpend: 128,
      daysRemaining: 17.35,
      totalDays: 30,
      dailyBudget: 11.55,
      health: health({ pacingRatio: 1, runRate: 11.55, verdict: 'healthy' }),
      overageAllowance: 0.75,
    })!;
    expect(rec.state).toBe('adjust');
    expect(rec.direction).toBe('raise');
    expect(rec.requiredRate).toBeCloseTo(13.37, 2); // (360−128)/17.35
    expect(rec.recoverableCapacity).toBeCloseTo(13.86, 2); // 11.55 × 1.20
    expect(rec.largeJump).toBe(false); // +16%, under the raise cap
  });

  it('adjust, trim (ahead / overspending — always feasible to slow down)', () => {
    const rec = buildMetaRecommendation({
      target: 300,
      actualSpend: 200,
      daysRemaining: 10,
      totalDays: 30,
      dailyBudget: 15,
      health: health({ pacingRatio: 1, runRate: 15, verdict: 'healthy' }),
      overageAllowance: 0.75,
    })!;
    // projected 200 + 150 = 350 > 300 × 1.05
    expect(rec.state).toBe('adjust');
    expect(rec.direction).toBe('trim');
    expect(rec.requiredRate).toBeCloseTo(10, 2);
    expect(rec.largeJump).toBe(true); // −33% is a big single move
  });

  it('delivery low (feed broke, gap would be closable if delivery were fixed)', () => {
    const rec = buildMetaRecommendation({
      target: 360,
      actualSpend: 80,
      daysRemaining: 19.5,
      totalDays: 30,
      dailyBudget: 13,
      health: health({ pacingRatio: 0.46, runRate: 6, verdict: 'low' }),
      overageAllowance: 0.75,
    })!;
    expect(rec.requiredRate).toBeCloseTo(14.36, 2);
    expect(rec.recoverableCapacity).toBeCloseTo(22.75, 2); // 13 × 1.75, off daily
    expect(rec.state).toBe('delivery_low');
  });

  it('delivery low holds on a 25% account too (same verdict)', () => {
    const rec = buildMetaRecommendation({
      target: 360,
      actualSpend: 80,
      daysRemaining: 19.5,
      totalDays: 30,
      dailyBudget: 13,
      health: health({ pacingRatio: 0.46, runRate: 6, verdict: 'low' }),
      overageAllowance: 0.25,
    })!;
    expect(rec.recoverableCapacity).toBeCloseTo(16.25, 2);
    expect(rec.state).toBe('delivery_low');
  });

  it('behind + underdelivering at end of month → delivery_low (gap surfaced, not declared)', () => {
    // Formerly `shortfall`. The state no longer exists — a low health verdict
    // reads as delivery_low; the emergent gap (maxSpendable/gap) is still
    // computed for the operator to read, never announced as impossible.
    const rec = buildMetaRecommendation({
      target: 360,
      actualSpend: 230,
      daysRemaining: 1.5,
      totalDays: 30,
      dailyBudget: 11.55,
      health: health({ pacingRatio: 0.69, runRate: 8, verdict: 'low' }),
      overageAllowance: 0.75,
    })!;
    expect(rec.state).toBe('delivery_low');
    expect(rec.maxSpendable).toBeCloseTo(12, 2); // realistic: run_rate × days
    expect(rec.gap).toBeCloseTo(118, 2); // 130 − 12
  });

  it('behind, healthy verdict, catch-up far above current daily → adjust/raise + largeJump (no shortfall)', () => {
    // The old "unrecoverable but delivering fine" case: the rec box still hands
    // over the catch-up number and flags the big jump; it never says impossible.
    const rec = buildMetaRecommendation({
      target: 360,
      actualSpend: 230,
      daysRemaining: 1.5,
      totalDays: 30,
      dailyBudget: 11.55,
      health: health({ pacingRatio: 1, runRate: 11.55, verdict: 'healthy' }),
      overageAllowance: 0.75,
    })!;
    expect(rec.state).toBe('adjust');
    expect(rec.direction).toBe('raise');
    expect(rec.requiredRate).toBeCloseTo(86.67, 2); // (360−230)/1.5, shown not blocked
    expect(rec.largeJump).toBe(true);
  });

  it('resolves with an assumed budget-rate when health is unknown, flagged', () => {
    const rec = buildMetaRecommendation({
      target: 300,
      actualSpend: 100,
      daysRemaining: 20,
      totalDays: 30,
      dailyBudget: 10,
      health: null,
      overageAllowance: 0.75,
    })!;
    expect(rec.healthKnown).toBe(false);
    expect(rec.state).toBe('on_track'); // 100 + 10×20 = 300
  });

  it('returns null without a target', () => {
    expect(
      buildMetaRecommendation({
        target: 0,
        actualSpend: 0,
        daysRemaining: 10,
        totalDays: 30,
        dailyBudget: 10,
        health: null,
        overageAllowance: 0.75,
      }),
    ).toBeNull();
  });
});

// ─── Google recommendation engine (Google spec §5–§7) ───────────────────────

describe('buildGoogleRecommendation', () => {
  const JULY = { daysInMonth: 31 };

  it('on track (Used Cars): ceiling matches target and delivering', () => {
    const rec = buildGoogleRecommendation({
      target: 1270.5,
      actualSpend: 381.22,
      dailyBudget: 42,
      monthlyCeiling: 42 * 30.4, // 1276.80
      daysElapsed: 9.78,
      daysRemaining: 21.22,
      ...JULY,
    })!;
    expect(rec.state).toBe('on_track');
    expect(rec.requiredRate).toBeCloseTo(41.91, 2);
  });

  it('adjust, raise (Price Point): ceiling below target, catch-up achievable', () => {
    const rec = buildGoogleRecommendation({
      target: 1270.5,
      actualSpend: 377.76,
      dailyBudget: 36,
      monthlyCeiling: 36 * 30.4, // 1094.40 — underfunded
      daysElapsed: 9.78,
      daysRemaining: 21.22,
      ...JULY,
    })!;
    expect(rec.state).toBe('adjust');
    expect(rec.direction).toBe('raise');
    expect(rec.requiredRate).toBeCloseTo(42.07, 2); // ≤ 2×36
  });

  it('adjust, lower (Auto Finance) — and the corrected projection', () => {
    const rec = buildGoogleRecommendation({
      target: 1694,
      actualSpend: 562.75,
      dailyBudget: 58,
      monthlyCeiling: 58 * 30.4, // 1763.20
      daysElapsed: 9.78,
      daysRemaining: 21.22,
      ...JULY,
    })!;
    // Health: expected = 1763.20 × (9.78/31) ≈ 556.3; 562.75/556.3 ≈ 1.01.
    expect(rec.health.pacingRatio).toBeCloseTo(1.01, 2);
    expect(rec.health.verdict).toBe('healthy');
    // Projection: run_rate 57.54 → min(562.75 + 57.54×21.22, 1763.20) = the
    // ceiling — NOT the impossible linear 1793.44 the old formula produced.
    expect(rec.health.runRate).toBeCloseTo(57.54, 1);
    expect(rec.projectedSpend).toBeCloseTo(1763.2, 1);
    expect(rec.state).toBe('adjust');
    expect(rec.direction).toBe('trim');
    expect(rec.requiredRate).toBeCloseTo(53.31, 2);
  });

  it('delivery limited (low search volume): budget is fine, raising does nothing', () => {
    const rec = buildGoogleRecommendation({
      target: 1200,
      actualSpend: 176,
      dailyBudget: 40,
      monthlyCeiling: 40 * 30.4, // 1216 ≈ target
      daysElapsed: 9.78,
      daysRemaining: 21.22,
      ...JULY,
    })!;
    // expected_to_date = 1216 × (9.78/31) ≈ 383.6 → ratio ≈ 0.46 (low)
    expect(rec.health.pacingRatio).toBeCloseTo(0.46, 2);
    expect(rec.state).toBe('delivery_limited');
  });

  it('shortfall (end of month, cannot recover even at 2× daily)', () => {
    const rec = buildGoogleRecommendation({
      target: 1200,
      actualSpend: 900,
      dailyBudget: 40,
      monthlyCeiling: 40 * 30.4,
      daysElapsed: 29.5,
      daysRemaining: 1.5,
      ...JULY,
    })!;
    // required = 300/1.5 = 200 > 2×40 → shortfall
    expect(rec.state).toBe('shortfall');
    expect(rec.recoverableMax).toBeCloseTo(120, 2); // max billable
    expect(rec.gap).toBeCloseTo(180, 2); // 300 − 120
  });

  it('a trim below what is already spent floors at $0, never negative', () => {
    const rec = buildGoogleRecommendation({
      target: 500,
      actualSpend: 600, // already past target
      dailyBudget: 40,
      monthlyCeiling: 40 * 30.4,
      daysElapsed: 15,
      daysRemaining: 16,
      ...JULY,
    })!;
    expect(rec.requiredRate).toBe(0);
    expect(rec.state).toBe('adjust');
    expect(rec.direction).toBe('trim');
  });

  it('prorates the ceiling for a mid-month start', () => {
    const rec = buildGoogleRecommendation({
      target: 600,
      actualSpend: 200,
      dailyBudget: 40,
      monthlyCeiling: 40 * 30.4, // 1216 full-month
      daysElapsed: 5,
      daysRemaining: 10.5, // eligible window = 15.5 of 31 days
      ...JULY,
    })!;
    expect(rec.effectiveCeiling).toBeCloseTo(1216 * (15.5 / 31), 1); // 608
    // expected_to_date = 608 × (5/15.5) ≈ 196 → delivering ≈ on pace,
    // ceiling ≈ target → on_track.
    expect(rec.state).toBe('on_track');
  });

  it('early month (under the minimum history) assumes delivery, no false alarm', () => {
    const rec = buildGoogleRecommendation({
      target: 1216,
      actualSpend: 5,
      dailyBudget: 40,
      monthlyCeiling: 1216,
      daysElapsed: 0.3,
      daysRemaining: 30.7,
      ...JULY,
    })!;
    expect(rec.health.verdict).toBeNull();
    expect(rec.state).toBe('on_track'); // ceiling matches target; no ratio yet
  });

  it('returns null without a target', () => {
    expect(
      buildGoogleRecommendation({
        target: 0,
        actualSpend: 0,
        dailyBudget: 40,
        monthlyCeiling: 1216,
        daysElapsed: 5,
        daysRemaining: 26,
        ...JULY,
      }),
    ).toBeNull();
  });
});

// ─── Budget-change detection + ramping (Meta spec M2/M4) ─────────────────────

// The Kawasaki SXS window: 5 pre-raise days at $6, raised to $19.09 on Jul 21.
const KAWASAKI: DailySpendPoint[] = [
  { date: '2026-07-16', spend: 5.4, dailyBudget: 6 },
  { date: '2026-07-17', spend: 4.8, dailyBudget: 6 },
  { date: '2026-07-18', spend: 5.1, dailyBudget: 6 },
  { date: '2026-07-19', spend: 4.2, dailyBudget: 6 },
  { date: '2026-07-20', spend: 5.55, dailyBudget: 6 },
  { date: '2026-07-21', spend: 6.8, dailyBudget: 19.09 },
  { date: '2026-07-22', spend: 1.99, dailyBudget: 19.09 },
];

describe('detectBudgetChange', () => {
  it('finds the raise between the last pre-change day and the first post-change day', () => {
    const c = detectBudgetChange(KAWASAKI);
    expect(c).toEqual({ date: '2026-07-21', prevBudget: 6, newBudget: 19.09 });
  });

  it('returns null when the budget never moves', () => {
    const flat = KAWASAKI.map((p) => ({ ...p, dailyBudget: 6 }));
    expect(detectBudgetChange(flat)).toBeNull();
  });

  it('ignores cent-level noise', () => {
    const noisy: DailySpendPoint[] = [
      { date: '2026-07-20', spend: 5, dailyBudget: 6.0 },
      { date: '2026-07-21', spend: 5, dailyBudget: 6.004 },
    ];
    expect(detectBudgetChange(noisy)).toBeNull();
  });

  it('reports the MOST RECENT change when the budget stepped twice', () => {
    const twice: DailySpendPoint[] = [
      { date: '2026-07-18', spend: 5, dailyBudget: 6 },
      { date: '2026-07-19', spend: 8, dailyBudget: 10 },
      { date: '2026-07-20', spend: 15, dailyBudget: 19.09 },
    ];
    expect(detectBudgetChange(twice)).toEqual({
      date: '2026-07-20',
      prevBudget: 10,
      newBudget: 19.09,
    });
  });

  it('skips days with no stored budget without treating the gap as a change', () => {
    const gappy: DailySpendPoint[] = [
      { date: '2026-07-19', spend: 4, dailyBudget: 6 },
      { date: '2026-07-20', spend: 4, dailyBudget: null },
      { date: '2026-07-21', spend: 4, dailyBudget: 6 },
    ];
    expect(detectBudgetChange(gappy)).toBeNull();
  });
});

describe('budgetRampStatus', () => {
  it('ramping while the window still contains pre-change days', () => {
    // On Jul 22 the window starts Jul 16 — the Jul 21 raise sits inside it.
    const s = budgetRampStatus(KAWASAKI, '2026-07-22');
    expect(s.ramping).toBe(true);
    expect(s.change?.date).toBe('2026-07-21');
  });

  it('clean once the window is entirely post-change (annotation drops itself)', () => {
    // A week later (Jul 28) the window starts Jul 22 — all post-raise.
    const s = budgetRampStatus(KAWASAKI, '2026-07-28');
    expect(s.ramping).toBe(false);
    expect(s.change?.date).toBe('2026-07-21'); // still detected, just not ramping
  });

  it('not ramping when there was no change', () => {
    const flat = KAWASAKI.map((p) => ({ ...p, dailyBudget: 6 }));
    expect(budgetRampStatus(flat, '2026-07-22')).toEqual({ change: null, ramping: false });
  });
});

describe('buildHealthHoverRows', () => {
  it('returns the window days with spend, budget, ratio, and today flagged', () => {
    const rows = buildHealthHoverRows(KAWASAKI, '2026-07-22');
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ date: '2026-07-16', spend: 5.4, budget: 6 });
    expect(rows[0].ratio).toBeCloseTo(0.9, 5); // 5.40 / 6.00
    expect(rows.at(-1)).toMatchObject({ date: '2026-07-22', isToday: true });
    expect(rows.every((r, i) => i === rows.length - 1 || !r.isToday)).toBe(true);
  });

  it('excludes days older than the 7-day window', () => {
    const withOld: DailySpendPoint[] = [
      { date: '2026-07-10', spend: 9, dailyBudget: 6 }, // outside the window
      ...KAWASAKI,
    ];
    const rows = buildHealthHoverRows(withOld, '2026-07-22');
    expect(rows.find((r) => r.date === '2026-07-10')).toBeUndefined();
    expect(rows).toHaveLength(7);
  });

  it('carries a null ratio when the budget is unknown', () => {
    const rows = buildHealthHoverRows(
      [{ date: '2026-07-22', spend: 2, dailyBudget: null }],
      '2026-07-22',
    );
    expect(rows[0].ratio).toBeNull();
  });
});
