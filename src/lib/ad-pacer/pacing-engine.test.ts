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
  warmupThresholdDays,
  pacingDirection,
  type DailySpendPoint,
  type PacingHealth,
  type MetaRecommendation,
} from './pacing-engine';
import { classifyPacerHealth } from './helpers';

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
    // A full week of history — past any warm-up threshold, so the state-machine
    // tests below exercise the four states rather than the §4 gate (which has
    // its own describe block).
    daysLive: 7,
    ...overrides,
  };
}

/**
 * Health fixture pinned to a demonstrated $/day rate on a given daily budget,
 * keeping `pacingRatio` (the delivery efficiency the engine projects from) and
 * `runRate` (descriptive only) mutually consistent.
 *
 * Prefer this over raw `health({ pacingRatio, runRate })`: those two are not
 * independent — `runRate == dailyBudget × pacingRatio` by construction — and
 * setting them separately lets a fixture describe an ad that cannot exist. Three
 * tests here did exactly that, which is the same latent inconsistency the
 * production card had.
 */
function healthAtRate(
  dailyBudget: number,
  ratePerDay: number,
  overrides: Partial<PacingHealth> = {},
): PacingHealth {
  return health({
    pacingRatio: ratePerDay / dailyBudget,
    runRate: ratePerDay,
    ...overrides,
  });
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
      health: healthAtRate(11.55, 11.55, { verdict: 'healthy' }),
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
      health: healthAtRate(11.55, 11.55, { verdict: 'healthy' }),
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
      health: healthAtRate(15, 15, { verdict: 'healthy' }),
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
      health: healthAtRate(13, 6, { verdict: 'low' }),
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
      health: healthAtRate(13, 6, { verdict: 'low' }),
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
      health: healthAtRate(11.55, 8, { verdict: 'low' }),
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
      health: healthAtRate(11.55, 11.55, { verdict: 'healthy' }),
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

// ─── Addendum §3: daysLive is populated on every path ───────────────────────
// The warm-up gate reads health.daysLive, so the paths that WITHHOLD a verdict
// must still carry it — those are exactly the newest ads the gate exists for.

describe('computeMetaPacingHealth — daysLive', () => {
  const NOW = Date.UTC(2026, 6, 10, 22, 31, 0); // Jul 10 2026, 16:31 MDT

  it('carries daysLive alongside a resolved verdict', () => {
    const h = computeMetaPacingHealth({
      dailyBudget: 11.55,
      liveDateIso: '2026-07-06',
      series: [],
      cumulativeSpend: 42.35,
      nowMs: NOW,
      timeZone: TZ,
    });
    expect(h.daysLive).toBeCloseTo(4.69, 2);
  });

  it('carries daysLive even under the minimum-history floor (verdict withheld)', () => {
    const h = computeMetaPacingHealth({
      dailyBudget: 10,
      liveDateIso: '2026-07-10',
      series: [],
      cumulativeSpend: 3,
      nowMs: Date.UTC(2026, 6, 10, 8, 0, 0), // 02:00 MDT → 0.08 days live
      timeZone: TZ,
    });
    expect(h.verdict).toBeNull();
    expect(h.daysLive).toBeCloseTo(0.08, 2); // the gate can still see it
  });

  it('carries daysLive with no daily budget (CBO row)', () => {
    const h = computeMetaPacingHealth({
      dailyBudget: 0,
      liveDateIso: '2026-07-09',
      series: [],
      cumulativeSpend: null,
      nowMs: NOW,
      timeZone: TZ,
    });
    expect(h.pacingRatio).toBeNull();
    expect(h.daysLive).toBeCloseTo(1.69, 2);
  });

  it('leaves daysLive null when go-live is unknown (gate fails open)', () => {
    const h = computeMetaPacingHealth({
      dailyBudget: 10,
      liveDateIso: null,
      series: [],
      cumulativeSpend: 100,
      nowMs: NOW,
      timeZone: TZ,
    });
    expect(h.daysLive).toBeNull();
  });

  it('daysLive tracks history while windowDays stops at the rolling cap', () => {
    // 40 days live: the window saturates at ~7 but history keeps climbing.
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
    expect(h.windowDays).toBeCloseTo(6.69, 2);
    expect(h.daysLive).toBeCloseTo(39.69, 2);
  });
});

// ─── Per-day-budget denominator: mid-window budget changes ──────────────────
// The health % is spend ÷ what the ad was BUDGETED each day, not ÷ today's
// budget applied retroactively. Without this, changing a budget mid-window
// distorted the percentage and — through the run-rate projection — invented an
// overspend warning on an ad that was on target.

describe('computeMetaPacingHealth — per-day budget denominator', () => {
  const NOW = Date.UTC(2026, 6, 10, 22, 31, 0); // Jul 10 2026, 16:31 MDT

  it('is a no-op when the budget held steady: expected == dailyBudget × windowDays', () => {
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
    // The property that bounds this change's blast radius: every ad whose budget
    // didn't move reads exactly as it did before.
    expect(h.expected).toBeCloseTo(10 * h.windowDays, 6);
    // And the identity the engine's projection relies on.
    expect(10 * h.pacingRatio!).toBeCloseTo(h.runRate!, 6);
  });

  it('a mid-window budget CUT no longer reads as overdelivery', () => {
    // Production Runs 2026: ~$68/day through Jul 27, cut to $53.42 on Jul 28.
    // The ad spent exactly its budget every day — it never overdelivered.
    const series: DailySpendPoint[] = [
      { date: '2026-07-22', spend: 68, dailyBudget: 68 },
      { date: '2026-07-23', spend: 68, dailyBudget: 68 },
      { date: '2026-07-24', spend: 68, dailyBudget: 68 },
      { date: '2026-07-25', spend: 68, dailyBudget: 68 },
      { date: '2026-07-26', spend: 68, dailyBudget: 68 },
      { date: '2026-07-27', spend: 68, dailyBudget: 68 },
      { date: '2026-07-28', spend: 20.04, dailyBudget: 53.42 },
    ];
    const CUT_NOW = Date.UTC(2026, 6, 28, 19, 0, 0); // Jul 28 13:00 MDT
    const h = computeMetaPacingHealth({
      dailyBudget: 53.42,
      liveDateIso: '2026-07-01',
      series,
      cumulativeSpend: null,
      nowMs: CUT_NOW,
      timeZone: TZ,
    });
    expect(h.windowDays).toBeCloseTo(6.5417, 3); // Jul 22 → Jul 28 13:00
    expect(h.windowSpend).toBeCloseTo(428.04, 2);
    // Denominator sums each day's own budget: 6 × $68 + $53.42 × 0.5417.
    expect(h.expected).toBeCloseTo(6 * 68 + 53.42 * (13 / 24), 2);
    // ~98%: delivering what it was told to. The OLD denominator
    // ($53.42 × 6.5417 = $349.46) produced 122% — pure artifact of the cut.
    expect(h.pacingRatio!).toBeCloseTo(0.98, 2);
    expect(428.04 / (53.42 * h.windowDays)).toBeCloseTo(1.22, 2); // what it used to read
    expect(h.verdict).toBe('healthy');
  });

  it('falls back to the current budget for days with no stored budget', () => {
    // Pre-tool backfilled days carry no dailyBudget; those days behave as before.
    const series: DailySpendPoint[] = [
      { date: '2026-07-04', spend: 10, dailyBudget: null },
      { date: '2026-07-05', spend: 10, dailyBudget: null },
      { date: '2026-07-06', spend: 10, dailyBudget: 10 },
      { date: '2026-07-07', spend: 10, dailyBudget: 10 },
      { date: '2026-07-08', spend: 10, dailyBudget: 10 },
      { date: '2026-07-09', spend: 10, dailyBudget: 10 },
      { date: '2026-07-10', spend: 5, dailyBudget: 10 },
    ];
    const h = computeMetaPacingHealth({
      dailyBudget: 10,
      liveDateIso: '2026-06-01',
      series,
      cumulativeSpend: null,
      nowMs: NOW,
      timeZone: TZ,
    });
    expect(h.expected).toBeCloseTo(10 * h.windowDays, 6);
  });
});

describe('projection basis after a budget change', () => {
  // Same card as above, at the moment of the cut.
  const CARD = {
    target: 2021.25,
    actualSpend: 1842.47,
    daysRemaining: 3.4566,
    totalDays: 31,
    dailyBudget: 53.42,
    overageAllowance: 0.75,
    flightLengthDays: 31,
  };
  /** What the Projected Spend card shows — current daily × days left. */
  const boxProjection =
    CARD.actualSpend + CARD.dailyBudget * CARD.daysRemaining;

  it('the corrected efficiency lands the ad on track, matching the Projected Spend card', () => {
    const rec = buildMetaRecommendation({
      ...CARD,
      health: health({ pacingRatio: 0.98, runRate: 65.44, verdict: 'healthy' }),
    })!;
    // Within a couple of dollars of the box, instead of $39 away from it.
    expect(Math.abs(rec.projectedRunrate - boxProjection)).toBeLessThan(5);
    expect(rec.state).toBe('on_track');
    expect(pacingDirection(rec, CARD.target)).toBe('on_target');
  });

  it('the old distorted ratio would have invented an overspend', () => {
    // 122% — what the pre-fix denominator reported for this same ad.
    const rec = buildMetaRecommendation({
      ...CARD,
      health: health({ pacingRatio: 1.22, verdict: 'healthy' }),
    })!;
    expect(rec.state).toBe('adjust');
    expect(rec.direction).toBe('trim');
    expect(rec.projectedRunrate - CARD.target).toBeGreaterThan(40);
    expect(pacingDirection(rec, CARD.target)).toBe('over');
  });

  it('still catches genuine underdelivery — the projection drops below the box', () => {
    // The property that must survive: an ad delivering half its budget projects
    // materially under, even though the box (budget × days) says on target.
    const rec = buildMetaRecommendation({
      ...CARD,
      health: healthAtRate(CARD.dailyBudget, CARD.dailyBudget * 0.5, {
        verdict: 'low',
      }),
    })!;
    expect(rec.projectedRunrate).toBeLessThan(boxProjection - 80);
    expect(rec.state).toBe('delivery_low');
    expect(pacingDirection(rec, CARD.target)).toBe('under');
  });

  it('no health data → efficiency 1.0, projection equals the box exactly', () => {
    const rec = buildMetaRecommendation({ ...CARD, health: null })!;
    expect(rec.projectedRunrate).toBeCloseTo(boxProjection, 6);
    expect(rec.healthKnown).toBe(false);
  });
});

// ─── Addendum §4: warm-up threshold + gate ──────────────────────────────────

describe('warmupThresholdDays', () => {
  it('floors at 3 days for a month-length flight', () => {
    expect(warmupThresholdDays(30)).toBeCloseTo(3.0, 3);
  });

  it('a 13-day flight also lands on the 3-day floor (min of 3 and 3.25)', () => {
    expect(warmupThresholdDays(13)).toBeCloseTo(3.0, 3);
  });

  it('caps at 25% of a short flight — a 6-day event warms up in 1.5 days', () => {
    expect(warmupThresholdDays(6)).toBeCloseTo(1.5, 3);
  });

  it('falls back to the clamped window when flight dates are missing', () => {
    expect(warmupThresholdDays(0, 8)).toBeCloseTo(2.0, 3);
  });

  it('with neither a flight length nor a fallback, uses the full floor', () => {
    expect(warmupThresholdDays(0, 0)).toBeCloseTo(3.0, 3);
  });
});

describe('buildMetaRecommendation — warm-up gate', () => {
  // The Triumph Demo Days case: flight Jul 27 – Aug 8 (13 days), set up
  // mid-afternoon Jul 27, read Jul 28 ~11 AM → 1.46 days of history. Before the
  // gate this surfaced "Add $0.88 to current Daily Budget" off a window too
  // short to mean anything.
  const triumph = {
    target: 200,
    actualSpend: 19.41,
    daysRemaining: 3.5,
    totalDays: 5, // July slice — deliberately NOT the warm-up basis
    dailyBudget: 15.4,
    overageAllowance: 0.75,
    flightLengthDays: 13,
  };

  it('suppresses the recommendation on a window that is too short', () => {
    const rec = buildMetaRecommendation({
      ...triumph,
      health: healthAtRate(15.4, 13.3, { daysLive: 1.46, windowDays: 1.46 }),
    })!;
    expect(rec.state).toBe('warmup');
    expect(rec.warmupActive).toBe(true);
    expect(rec.warmupThresholdDays).toBeCloseTo(3.0, 2);
    expect(rec.warmupDaysLive).toBeCloseTo(1.46, 2);
  });

  it('still computes the catch-up math behind the gate (nothing is lost)', () => {
    const rec = buildMetaRecommendation({
      ...triumph,
      health: healthAtRate(15.4, 13.3, { daysLive: 1.46, windowDays: 1.46 }),
    })!;
    expect(rec.requiredRate).toBeCloseTo((200 - 19.41) / 3.5, 2);
    expect(rec.projectedRunrate).toBeCloseTo(19.41 + 13.3 * 3.5, 2);
  });

  it('keys off accumulated history, NOT the window: a stale sync must not re-warm-up a mature ad', () => {
    // 40 days live, but the last sync was days ago so the rolling window only
    // spans ~3. Gating on windowDays (the spec's literal §4.2 wording) would
    // suppress recommendations on an ad that has been running for six weeks.
    const rec = buildMetaRecommendation({
      target: 360,
      actualSpend: 128,
      daysRemaining: 17.35,
      totalDays: 30,
      dailyBudget: 11.55,
      health: healthAtRate(11.55, 11.55, {
        daysLive: 40,
        windowDays: 2.9,
        verdict: 'healthy',
      }),
      overageAllowance: 0.75,
      flightLengthDays: 30,
    })!;
    expect(rec.warmupActive).toBe(false);
    expect(rec.state).toBe('adjust');
  });

  it('releases the gate once history reaches the threshold', () => {
    const rec = buildMetaRecommendation({
      ...triumph,
      health: healthAtRate(15.4, 15.4, {
        daysLive: 3.0,
        windowDays: 3.0,
        verdict: 'healthy',
      }),
    })!;
    expect(rec.warmupActive).toBe(false);
    expect(rec.state).not.toBe('warmup');
  });

  it('a short flight clears warm-up early (25% cap, not the 3-day floor)', () => {
    // 6-day event flight, 2 days live → threshold 1.5, already past it.
    const rec = buildMetaRecommendation({
      target: 120,
      actualSpend: 40,
      daysRemaining: 4,
      totalDays: 6,
      dailyBudget: 20,
      health: healthAtRate(20, 20, {
        daysLive: 2,
        windowDays: 2,
        verdict: 'healthy',
      }),
      overageAllowance: 0.75,
      flightLengthDays: 6,
    })!;
    expect(rec.warmupThresholdDays).toBeCloseTo(1.5, 2);
    expect(rec.warmupActive).toBe(false);
  });

  it('fails open when go-live is unknown (no basis to call the ad new)', () => {
    const rec = buildMetaRecommendation({
      ...triumph,
      health: healthAtRate(15.4, 13.3, { daysLive: null, windowDays: 1.46 }),
    })!;
    expect(rec.warmupActive).toBe(false);
    expect(rec.state).not.toBe('warmup');
  });
});

// ─── Addendum §6: one shared verdict for badge, box and message ──────────────

describe('pacingDirection', () => {
  // The $400 card from §6.7: projected $396.43 vs $400 target — 0.9% under, i.e.
  // inside the band. Green badge beside a neutral "$13.91/day to land on
  // $400.00" box is the CORRECT output, not a contradiction.
  const fourHundred = {
    target: 400,
    actualSpend: 350.86,
    daysRemaining: 3.53,
    totalDays: 31,
    dailyBudget: 12.9,
    health: healthAtRate(12.9, 12.9, { verdict: 'healthy' }),
    overageAllowance: 0.75,
    flightLengthDays: 31,
  };

  it('reads on_target for the $400 worked example', () => {
    const rec = buildMetaRecommendation(fourHundred)!;
    expect(rec.projectedRunrate).toBeCloseTo(396.4, 1);
    expect(rec.state).toBe('on_track');
    expect(pacingDirection(rec, 400)).toBe('on_target');
  });

  it('withholds a direction during warm-up (the engine is not calling it)', () => {
    const rec = buildMetaRecommendation({
      ...fourHundred,
      health: healthAtRate(12.9, 12.9, { daysLive: 1 }),
    })!;
    expect(rec.state).toBe('warmup');
    expect(pacingDirection(rec, 400)).toBeNull();
  });

  it('never disagrees with the state it was derived from', () => {
    const cases: { rec: MetaRecommendation; target: number }[] = [
      { rec: buildMetaRecommendation(fourHundred)!, target: 400 },
      {
        rec: buildMetaRecommendation({
          target: 300,
          actualSpend: 200,
          daysRemaining: 10,
          totalDays: 30,
          dailyBudget: 15,
          health: healthAtRate(15, 15, { verdict: 'healthy' }),
          overageAllowance: 0.75,
        })!,
        target: 300,
      },
      {
        rec: buildMetaRecommendation({
          target: 360,
          actualSpend: 128,
          daysRemaining: 17.35,
          totalDays: 30,
          dailyBudget: 11.55,
          health: healthAtRate(11.55, 11.55, { verdict: 'healthy' }),
          overageAllowance: 0.75,
        })!,
        target: 360,
      },
      {
        rec: buildMetaRecommendation({
          target: 360,
          actualSpend: 80,
          daysRemaining: 19.5,
          totalDays: 30,
          dailyBudget: 13,
          health: healthAtRate(13, 6, { verdict: 'low' }),
          overageAllowance: 0.75,
        })!,
        target: 360,
      },
    ];
    for (const { rec, target } of cases) {
      const dir = pacingDirection(rec, target);
      if (rec.state === 'on_track') expect(dir).toBe('on_target');
      // Every under-tolerance state (adjust/raise, delivery_low) reads as
      // `under`; only a trim reads as `over` (§6.4).
      if (rec.state === 'delivery_low') expect(dir).toBe('under');
      if (rec.state === 'adjust') {
        expect(dir).toBe(rec.direction === 'trim' ? 'over' : 'under');
      }
    }
  });
});

describe('pacingDirection on the DISPLAYED projection', () => {
  // The reported card: $385 target, $34.78 spent, $12.42/day, 27.53 days left,
  // 86% delivery ("light"). Two projections disagreed on screen — the box showed
  // $376.69 (budget rate) while the badge and message spoke for the engine's
  // efficiency-weighted $328.84, hence "underspend by $54.73" under a box that
  // was $8.31 short. Passing the box projection makes one verdict of it.
  const CARD = {
    target: 385,
    actualSpend: 34.78,
    daysRemaining: 27.53,
    totalDays: 31,
    dailyBudget: 12.42,
    // 86% delivery — 'soft' (the card labels it "light"), NOT the 'low' verdict
    // that would trip the delivery gate.
    health: healthAtRate(12.42, 12.42 * 0.8642, { verdict: 'soft' }),
    overageAllowance: 0.75,
    flightLengthDays: 31,
  };
  /** What the Projected Spend box shows — current daily × days left. */
  const boxProjection = CARD.actualSpend + CARD.dailyBudget * CARD.daysRemaining;

  it('the two projections really are far apart on this card', () => {
    const rec = buildMetaRecommendation(CARD)!;
    expect(boxProjection).toBeCloseTo(376.69, 1);
    expect(rec.projectedRunrate).toBeCloseTo(330.27, 1);
    // $54.73 vs $8.31 — the variance the operator couldn't reconcile.
    expect(CARD.target - rec.projectedRunrate).toBeCloseTo(54.73, 1);
    expect(CARD.target - boxProjection).toBeCloseTo(8.3, 1);
  });

  it('reads the displayed projection against the band, not the run rate', () => {
    const rec = buildMetaRecommendation(CARD)!;
    // The engine still wants a raise off its own projection…
    expect(rec.state).toBe('adjust');
    expect(rec.direction).toBe('raise');
    expect(pacingDirection(rec, CARD.target)).toBe('under');
    // …but $8.31 on $385 with 27.53 of 31 days left is inside the ±4.4% band,
    // so what the card SHOWS is on target. Badge and message follow the card.
    expect(pacingDirection(rec, CARD.target, boxProjection)).toBe('on_target');
  });

  it('still calls a genuine box-projected shortfall under', () => {
    const rec = buildMetaRecommendation(CARD)!;
    // Same ad at a $6/day budget: box projection 34.78 + 6 × 27.53 = $199.96.
    expect(pacingDirection(rec, CARD.target, 34.78 + 6 * 27.53)).toBe('under');
  });

  it('calls a box-projected overspend over', () => {
    const rec = buildMetaRecommendation(CARD)!;
    expect(pacingDirection(rec, CARD.target, 34.78 + 20 * 27.53)).toBe('over');
  });

  it('delivery-low is not overridden by the arithmetic — it stays under', () => {
    // Half its budget delivering, while the box projection lands dead on
    // target. A green badge here would be a lie: the ad is not spending it.
    const rec = buildMetaRecommendation({
      ...CARD,
      health: healthAtRate(CARD.dailyBudget, CARD.dailyBudget * 0.5, {
        verdict: 'low',
      }),
    })!;
    expect(rec.state).toBe('delivery_low');
    expect(pacingDirection(rec, CARD.target, CARD.target)).toBe('under');
  });

  it('warm-up still withholds the call regardless of the projection', () => {
    const rec = buildMetaRecommendation({
      ...CARD,
      health: healthAtRate(CARD.dailyBudget, CARD.dailyBudget, { daysLive: 1 }),
    })!;
    expect(rec.state).toBe('warmup');
    expect(pacingDirection(rec, CARD.target, boxProjection)).toBeNull();
  });

  it('ignores a non-finite projection and falls back to the run rate', () => {
    const rec = buildMetaRecommendation(CARD)!;
    expect(pacingDirection(rec, CARD.target, NaN)).toBe('under');
  });
});

describe('badge ↔ recommendation agreement (§6.1)', () => {
  const calc = (over: Partial<Parameters<typeof classifyPacerHealth>[1]> = {}) => ({
    budget: 300,
    spent: 100,
    projected: 300,
    hasDates: true,
    endsBeforeToday: false,
    lifetimePacingPct: null,
    ...over,
  });
  const ad = { adStatus: 'Live', budgetType: 'Daily' as const };

  // The audit case: an ON TRACK badge beside an active recommendation. The badge
  // used to run its own ±5% test on the BUDGET-RATE projection (spend + daily ×
  // days), which is blind to underdelivery, while the engine tested the RUN-RATE
  // projection against a tapering band. Here they disagree, and the badge must
  // follow the engine.
  const underdelivering = buildMetaRecommendation({
    target: 300,
    actualSpend: 100,
    daysRemaining: 10,
    totalDays: 30,
    dailyBudget: 20,
    health: healthAtRate(20, 10, { verdict: 'low' }),
    overageAllowance: 0.75,
    flightLengthDays: 30,
  })!;

  it('the legacy budget-rate test would call this ad on track', () => {
    // spend + daily × days = 100 + 20 × 10 = 300 → dead on target.
    expect(classifyPacerHealth(ad, calc()).state).toBe('on-track');
  });

  it('the engine sees the underdelivery and the badge follows it', () => {
    expect(underdelivering.state).toBe('delivery_low');
    const dir = pacingDirection(underdelivering, 300);
    expect(dir).toBe('under');
    expect(classifyPacerHealth(ad, calc(), dir).state).toBe('underpacing');
  });

  it('renders a neutral warming-up badge instead of guessing a direction', () => {
    expect(classifyPacerHealth(ad, calc(), null).state).toBe('warming-up');
  });

  it('absolute states still outrank any direction', () => {
    // Already over budget is a fact, not a projection.
    expect(
      classifyPacerHealth(ad, calc({ spent: 400 }), 'on_target').state,
    ).toBe('over-budget');
    expect(
      classifyPacerHealth({ ...ad, adStatus: 'Off' }, calc(), 'under').state,
    ).toBe('stopped');
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
