/**
 * Pacing-health + recommendation engine for the per-ad pacing cards.
 *
 * Two platform-specific engines built on one shared design principle: "am I
 * off target" is two questions answered in order —
 *   1. Is the campaign actually spending the budget it was given? (pacing
 *      health — the gate)
 *   2. Given where it is, will it land on target, and what should I do?
 *      (the recommendation state machine)
 * The recommendation box never hands over a number unless setting it will
 * actually work: when the ad is on track it says leave it alone, and when a
 * number would mislead (delivery broken, or too late to catch up) it escalates
 * to the honest alternative instead.
 *
 * The platforms share the state names and the "suppress when fine, escalate
 * when unrecoverable" behavior but differ in the math, because their budget
 * models differ:
 *   - Meta: a daily budget averaged over a rolling 7 days (single day may
 *     overdeliver by a per-account 25%/75% overage). Health = rolling 7-day
 *     window vs budget; attainment = run-rate projection vs target.
 *   - Google: an average daily budget feeding a MONTHLY model (billing capped
 *     at daily × 30.4 per calendar month, 2× daily on any single day; Google
 *     itself paces to the monthly ceiling). Health = month-to-date vs
 *     expected-to-date on the way to the ceiling; attainment = ceiling vs
 *     target; projection is capped at the ceiling because Google will not
 *     bill past it.
 *
 * Pure math — no React, no DB, no API. All tunables live in constants.ts.
 */

import {
  GOOGLE_DAILY_MULTIPLIER,
  HEALTH_HEALTHY_THRESHOLD,
  HEALTH_LOW_THRESHOLD,
  HEALTH_MIN_DAYS,
  HEALTH_WINDOW_DAYS,
  ON_TRACK_TOLERANCE,
  ON_TRACK_TOLERANCE_FLOOR,
  OVERAGE_ALLOWANCE_DEFAULT,
  OVERAGE_ALLOWANCE_MAX,
  OVERAGE_ALLOWANCE_MIN,
  OVERAGE_MIN_HISTORY_DAYS,
  RAISE_STEP_CAP,
} from './constants';
import { zonedMidnightMs, zonedTodayIso } from '@/lib/timezone';

const DAY_MS = 86_400_000;

/** One day of synced spend for a linked platform object (account-TZ date). */
export interface DailySpendPoint {
  date: string; // YYYY-MM-DD
  spend: number; // $
  /** Daily budget in effect that day ($), when known — feeds the empirical
   *  overage derivation. Backfilled days carry the budget at backfill time
   *  (best available approximation). */
  dailyBudget: number | null;
}

export type PacingHealthVerdict = 'healthy' | 'soft' | 'low';

/**
 * Meta recommendation states. `shortfall` is deliberately no longer emitted:
 * the rec box is now unconditional catch-up arithmetic (never "impossible"),
 * and an unrecoverable gap emerges from reading the (large) catch-up number
 * against a low pacing-health reading — the operator makes that call, the tool
 * doesn't declare it. `delivery_low` is a pacing-health descriptor (the ad is
 * behind AND underdelivering), not a rec-box takeover.
 */
export type MetaRecommendationState = 'on_track' | 'adjust' | 'delivery_low';

/** The four Google recommendation states. Same set as Meta except the third:
 *  Google's is `delivery_limited` because the cause is usually traffic (low
 *  search volume, bids, ad rank, schedule), not a broken feed. */
export type GoogleRecommendationState =
  | 'on_track'
  | 'adjust'
  | 'delivery_limited'
  | 'shortfall';

export interface PacingHealth {
  /** Fractional days the health window covers (≤ 7 for Meta; month-to-date
   *  elapsed for Google). */
  windowDays: number;
  /** Spend inside the window ($). */
  windowSpend: number;
  /** What a fully-delivering campaign would have spent over the window ($). */
  expected: number;
  /** windowSpend ÷ expected. null when not computable (no budget / too young
   *  / rolling window needs the spend series and none is synced yet). */
  pacingRatio: number | null;
  /** Demonstrated daily spend ($/day). Read as a floor for a healthy ad
   *  (budget-capped) and roughly the true ceiling for a low ad
   *  (capacity-capped). null when not computable. */
  runRate: number | null;
  verdict: PacingHealthVerdict | null;
  /** Spend so far today ($) — diagnostic breadcrumb ONLY. Feeds no
   *  calculation anywhere (a partial day is exactly the noise the window
   *  avoids); its one job is "did it break today or has it been soft all
   *  week." null when unknown. */
  spendToday: number | null;
}

function verdictOf(ratio: number): PacingHealthVerdict {
  if (ratio >= HEALTH_HEALTHY_THRESHOLD) return 'healthy';
  if (ratio >= HEALTH_LOW_THRESHOLD) return 'soft';
  return 'low';
}

/** Date-only day arithmetic on YYYY-MM-DD strings (UTC math, no TZ shift). */
function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const noHealth = (spendToday: number | null = null): PacingHealth => ({
  windowDays: 0,
  windowSpend: 0,
  expected: 0,
  pacingRatio: null,
  runRate: null,
  verdict: null,
  spendToday,
});

// ─── Meta: rolling 7-day pacing health ──────────────────────────────────────

export interface MetaPacingHealthInput {
  /** Current daily budget ($). */
  dailyBudget: number;
  /** The ad's ACTUAL go-live calendar date (account TZ) — metaStartDate ??
   *  liveDate ?? flightStart. All elapsed-day math keys off this, never the
   *  planned start: counting from the plan would compute a false underspend
   *  on a late launch. */
  liveDateIso: string | null;
  /** Per-day spend for the linked object (any range covering the last 8
   *  days; extra rows are ignored). Required once the ad is > 7 days live —
   *  the rolling window subtracts spend older than 7 days. */
  series: DailySpendPoint[];
  /** Cumulative all-time spend ($) — used while the ad is ≤ 7 days live
   *  (all-time equals the window) if the series hasn't synced yet. */
  cumulativeSpend: number | null;
  nowMs: number;
  timeZone: string;
  /** When the spend series was last synced (ms epoch), i.e. the "data edge" —
   *  the moment up to which spend is known. Pacing health is a BACKWARD-looking
   *  measure, so its denominator (day count) ends here, NOT at now(): counting
   *  budget for the sync-lag gap (a day of budget with no spend to compare
   *  against) silently deflates the reading. Null falls back to now() (a fresh
   *  or unknown sync collapses to the live clock — the pre-fix behavior). The
   *  forward-looking surfaces (projection, days-remaining, rec box) keep using
   *  now() and are unaffected. */
  syncedAtMs?: number | null;
}

/**
 * Meta pacing health: "is the ad spending the budget I set." Measured over a
 * rolling 7-day window (capped at how long the ad has been live) against
 * Meta's own 7-day averaging mechanic — recent enough to catch a break
 * quickly, wide enough to ignore single-day swings.
 *
 * The window ENDS at the data edge (last synced spend), not the live clock, so
 * a stale sync describes a slightly older window instead of dividing real
 * spend by phantom (budgeted-but-unsynced) days. The numerator is unchanged —
 * only the day-count denominator moves to the data edge, keeping the invariant
 * "days summed == days counted."
 */
export function computeMetaPacingHealth(
  input: MetaPacingHealthInput,
): PacingHealth {
  const { dailyBudget, liveDateIso, series, nowMs, timeZone } = input;
  const todayIso = zonedTodayIso(nowMs, timeZone);

  // ── Data edge: where the numerator's real coverage ends. ──
  // The sync moment (capped at now — data can't be from the future).
  const anchorMs = Math.min(input.syncedAtMs ?? nowMs, nowMs);
  const anchorIso = zonedTodayIso(anchorMs, timeZone);
  const lastDataIso = series.length
    ? series.reduce((mx, p) => (p.date > mx ? p.date : mx), series[0].date)
    : null;
  let edgeIso: string;
  let edgeMs: number;
  if (lastDataIso != null && lastDataIso < anchorIso) {
    // Sync ran but its own day has no synced spend yet → the honest edge is the
    // END of the last day that does have data (a complete past day).
    const [ly, lm, ld] = lastDataIso.split('-').map(Number);
    edgeIso = lastDataIso;
    edgeMs = zonedMidnightMs(ly, lm, ld, timeZone) + DAY_MS;
  } else {
    // Fresh/normal: the trailing partial day, at the sync moment.
    edgeIso = anchorIso;
    edgeMs = anchorMs;
  }
  const edgeRow = series.find((p) => p.date === edgeIso);
  const spendToday = edgeRow ? edgeRow.spend : null;

  if (!(dailyBudget > 0) || !liveDateIso) return noHealth(spendToday);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(liveDateIso);
  if (!m) return noHealth(spendToday);
  // Loomi stores go-live as a date (no time), so days-live counts from that
  // day's midnight in the account zone — the same clock Meta resets budgets on.
  const liveMs = zonedMidnightMs(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    timeZone,
  );
  // Days from go-live to the DATA EDGE (not now) — the span the denominator
  // must match.
  const daysToEdge = (edgeMs - liveMs) / DAY_MS;
  if (daysToEdge < HEALTH_MIN_DAYS) return noHealth(spendToday);

  let windowDays: number;
  let windowSpend: number;
  if (daysToEdge <= HEALTH_WINDOW_DAYS) {
    // All-time equals the window (go-live → data edge). Prefer summing the
    // series (exact); fall back to the cumulative figure already on the card.
    windowDays = daysToEdge;
    if (series.length > 0) {
      windowSpend = series.reduce(
        (s, p) => (p.date >= liveDateIso && p.date <= edgeIso ? s + p.spend : s),
        0,
      );
    } else if (input.cumulativeSpend != null) {
      windowSpend = input.cumulativeSpend;
    } else {
      return noHealth(spendToday);
    }
  } else {
    // Rolling window: the last HEALTH_WINDOW_DAYS calendar dates. The START
    // stays clock-anchored (today − 6) so the numerator is unchanged; only the
    // END/day-count moves to the data edge. span = data_edge − window_start.
    if (series.length === 0) return noHealth(spendToday); // needs the series
    const startIso = addDaysIso(todayIso, -(HEALTH_WINDOW_DAYS - 1));
    windowSpend = series.reduce(
      (s, p) => (p.date >= startIso && p.date <= edgeIso ? s + p.spend : s),
      0,
    );
    const [sy, sm, sd] = startIso.split('-').map(Number);
    const startMs = zonedMidnightMs(sy, sm, sd, timeZone);
    windowDays = Math.min(daysToEdge, (edgeMs - startMs) / DAY_MS);
  }

  const expected = dailyBudget * windowDays;
  if (!(expected > 0) || !(windowDays > 0)) return noHealth(spendToday);
  const pacingRatio = windowSpend / expected;
  return {
    windowDays,
    windowSpend,
    expected,
    pacingRatio,
    runRate: windowSpend / windowDays,
    verdict: verdictOf(pacingRatio),
    spendToday,
  };
}

// ─── Meta: budget-change detection + pacing-health hover ────────────────────

/** A detected daily-budget step-change in the stored spend series. */
export interface BudgetChange {
  /** First post-change day (YYYY-MM-DD) — the "ramping since" anchor. */
  date: string;
  prevBudget: number; // $ before the change
  newBudget: number; // $ after the change
}

/** Budgets within this many dollars are the same reading (cent noise). */
const BUDGET_CHANGE_EPS = 0.005;

/**
 * The most recent daily-budget step-change in the series: the day whose stored
 * budget-in-effect differs from the prior stored day's. Relies on
 * writeDailySpendSeries preserving each past day's real budget (an incremental
 * re-pull that overwrote history with today's budget would erase this). Returns
 * null when fewer than two budgeted days exist or the budget never moved.
 */
export function detectBudgetChange(series: DailySpendPoint[]): BudgetChange | null {
  const budgeted = series
    .filter((p) => p.dailyBudget != null && p.dailyBudget > 0)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let change: BudgetChange | null = null;
  for (let i = 1; i < budgeted.length; i++) {
    const prev = budgeted[i - 1].dailyBudget as number;
    const cur = budgeted[i].dailyBudget as number;
    // Last match wins → the most recent change is what "ramping" keys off.
    if (Math.abs(cur - prev) > BUDGET_CHANGE_EPS) {
      change = { date: budgeted[i].date, prevBudget: prev, newBudget: cur };
    }
  }
  return change;
}

/**
 * Whether the rolling health window still straddles a budget change — i.e. it
 * contains pre-change (old-budget) days, so the low pacing % is "hasn't ramped
 * yet," not a delivery fault. True while the change sits strictly inside the
 * window (some window day predates it); false once the window is entirely
 * post-change (the annotation drops on its own) or there was no change.
 */
export function budgetRampStatus(
  series: DailySpendPoint[],
  todayIso: string,
): { change: BudgetChange | null; ramping: boolean } {
  const change = detectBudgetChange(series);
  if (!change) return { change: null, ramping: false };
  const windowStart = addDaysIso(todayIso, -(HEALTH_WINDOW_DAYS - 1));
  return { change, ramping: change.date > windowStart };
}

/** One day in the pacing-health hover breakdown. */
export interface HealthHoverDay {
  date: string; // YYYY-MM-DD
  spend: number; // $ that day
  budget: number | null; // $ budget in effect that day
  /** spend ÷ that-day's-budget (the proportional bar fill), or null when the
   *  budget is unknown. Unclamped — the bar clamps for display. */
  ratio: number | null;
  isToday: boolean; // a partial, in-progress day
}

/**
 * The per-day rows behind the pacing-health percentage: the rolling window's
 * days (last 7 dates incl. today), each paired with the budget in effect that
 * day and its delivery ratio. Reads the stored series only — the hover makes no
 * live API call. Days without a synced point simply don't appear.
 */
export function buildHealthHoverRows(
  series: DailySpendPoint[],
  todayIso: string,
): HealthHoverDay[] {
  const windowStart = addDaysIso(todayIso, -(HEALTH_WINDOW_DAYS - 1));
  return series
    .filter((p) => p.date >= windowStart && p.date <= todayIso)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((p) => ({
      date: p.date,
      spend: p.spend,
      budget: p.dailyBudget,
      ratio:
        p.dailyBudget != null && p.dailyBudget > 0 ? p.spend / p.dailyBudget : null,
      isToday: p.date === todayIso,
    }));
}

// ─── Meta: per-account overage allowance ────────────────────────────────────

/**
 * Meta's single-day daily-budget flexibility, derived empirically from the
 * spend series (preferred over any config): the highest observed single-day
 * spend ÷ that day's budget, across recent history. A max ratio near 1.75
 * means the account is on the 75% rollout; nothing above ~1.25 means 25%.
 *
 * Early in an ad's life no day may have run hot enough to reveal the ceiling,
 * so with thin history (or no day that ever exceeded its budget) this falls
 * back to `fallback` (the account-level setting, else 0.75). Only affects the
 * shortfall feasibility boundary — never day-to-day pacing.
 */
export function deriveOverageAllowance(
  series: DailySpendPoint[],
  opts: { todayIso?: string; fallback?: number } = {},
): number {
  const fallback = opts.fallback ?? OVERAGE_ALLOWANCE_DEFAULT;
  let maxRatio = 0;
  let usableDays = 0;
  for (const p of series) {
    // Today is a partial day — it can only under-read the ceiling.
    if (opts.todayIso && p.date === opts.todayIso) continue;
    if (!(p.spend > 0) || p.dailyBudget == null || !(p.dailyBudget > 0)) continue;
    usableDays += 1;
    const r = p.spend / p.dailyBudget;
    if (r > maxRatio) maxRatio = r;
  }
  if (usableDays < OVERAGE_MIN_HISTORY_DAYS || maxRatio <= 1) return fallback;
  return Math.min(
    OVERAGE_ALLOWANCE_MAX,
    Math.max(OVERAGE_ALLOWANCE_MIN, maxRatio - 1),
  );
}

// ─── Shared: on-track tolerance ─────────────────────────────────────────────

/**
 * The on-track band tightens as the period runs out: early, a small variance
 * self-corrects, so the full band applies; in the final days there is no
 * runway, so it shrinks toward the floor. `fractionRemaining` ∈ [0, 1].
 */
export function onTrackTolerance(fractionRemaining: number): number {
  const f = Math.min(1, Math.max(0, fractionRemaining));
  return Math.max(ON_TRACK_TOLERANCE_FLOOR, ON_TRACK_TOLERANCE * f);
}

// ─── Meta: recommendation state machine ─────────────────────────────────────

export interface MetaRecommendationInput {
  /** Period spend target ($) — the card's effective month target. */
  target: number;
  /** Live cumulative actual spend for the period ($). */
  actualSpend: number;
  /** Fractional days left in the pacing window. */
  daysRemaining: number;
  /** Total days in the pacing window (for tolerance tightening). */
  totalDays: number;
  /** Current daily budget ($). */
  dailyBudget: number;
  /** Pacing health (the gate). null = not computable — the machine then
   *  assumes budget-rate delivery, flagged via `healthKnown: false`. */
  health: PacingHealth | null;
  /** Per-account single-day flexibility (0.25–0.75), see
   *  deriveOverageAllowance. */
  overageAllowance: number;
}

export interface MetaRecommendation {
  state: MetaRecommendationState;
  /** (target − actual) ÷ days remaining — the rate that lands exactly on
   *  target ($/day, floored at 0). The number `adjust` hands over. */
  requiredRate: number;
  /** actual + run_rate × days remaining — where CURRENT behavior lands ($). */
  projectedRunrate: number;
  /** Most the ad could plausibly spend per day ($): daily × (1 + headroom),
   *  headroom = raise_step_cap for a delivering ad (bigger single jumps risk
   *  re-triggering learning), the account overage for a low ad (its broken
   *  run rate understates what fixing delivery unlocks). Advisory context now —
   *  no longer gates a state. */
  recoverableCapacity: number;
  /** For `adjust`: which way the correction points (raise vs trim). Advisory —
   *  the rec box shows the catch-up number regardless of state. */
  direction: 'raise' | 'trim' | null;
  /** The correction is a big single move (> raise_step_cap either way) —
   *  "large jump, stage it and monitor." */
  largeJump: boolean;
  /** target − actual ($). */
  remainingBudget: number;
  /** Diagnostic: what the ad will realistically still spend at its demonstrated
   *  rate (run_rate × days remaining). Read against remainingBudget, a large
   *  shortfall is what tells the operator recovery is unrealistic — the tool
   *  presents it, never declares it. */
  maxSpendable: number;
  /** Diagnostic: remainingBudget − maxSpendable ($) — the emergent gap. */
  gap: number;
  /** Resolved on-track tolerance (fraction of target). */
  tolerance: number;
  /** False when no pacing-health data was available (pre-series sync) and the
   *  machine assumed budget-rate delivery. */
  healthKnown: boolean;
}

/**
 * The Meta state machine (a descriptor now, not the rec-box driver).
 * Evaluated top to bottom, first match wins. The rec box reads the arithmetic
 * fields directly (requiredRate / remainingBudget) and never the state; the
 * state only colors the pacing-health descriptor and prose:
 *   - on_track: current behavior lands within tolerance of target.
 *   - adjust:   off target with a correction to make (raise or trim).
 *   - delivery_low: behind AND underdelivering (health verdict low) — a bigger
 *     number won't help; the fix is diagnosing delivery.
 * `shortfall` is gone: an unrecoverable gap is left for the operator to read
 * off the (large) catch-up number vs a low pacing-health reading, not declared.
 */
export function buildMetaRecommendation(
  input: MetaRecommendationInput,
): MetaRecommendation | null {
  const { target, actualSpend, daysRemaining, totalDays, dailyBudget } = input;
  // Without a target there's nothing to attain; without a daily budget (CBO
  // ad set / unsynced row) the capacity math would misread the ad as an
  // unrecoverable shortfall — both are "engine doesn't apply", not verdicts.
  if (!(target > 0) || !(dailyBudget > 0)) return null;

  const healthKnown = input.health?.verdict != null;
  const verdict = input.health?.verdict ?? 'healthy';
  // No health data → assume the ad keeps spending its budget (the pre-engine
  // assumption), so the machine still resolves; the flag lets the UI hedge.
  const runRate = input.health?.runRate ?? dailyBudget;

  const remainingBudget = target - actualSpend;
  const tolerance = onTrackTolerance(
    totalDays > 0 ? daysRemaining / totalDays : 0,
  );
  const projectedRunrate = actualSpend + runRate * daysRemaining;
  const requiredRate =
    daysRemaining > 0 ? Math.max(0, remainingBudget) / daysRemaining : Infinity;
  const headroom =
    verdict === 'low' ? input.overageAllowance : RAISE_STEP_CAP;
  const recoverableCapacity = dailyBudget * (1 + headroom);
  const maxSpendable = Math.max(0, runRate * Math.max(0, daysRemaining));
  const gap = Math.max(0, remainingBudget) - maxSpendable;

  const base = {
    requiredRate: Number.isFinite(requiredRate) ? requiredRate : 0,
    projectedRunrate,
    recoverableCapacity,
    remainingBudget,
    maxSpendable,
    gap,
    tolerance,
    healthKnown,
    direction: null as MetaRecommendation['direction'],
    largeJump: false,
  };

  // 1. On track: current behavior lands within tolerance of target.
  if (Math.abs(projectedRunrate - target) <= tolerance * target) {
    return { state: 'on_track', ...base };
  }

  // 2. Ahead / overspending → always feasible to slow down.
  if (projectedRunrate > target * (1 + tolerance)) {
    return {
      state: 'adjust',
      ...base,
      direction: 'trim',
      largeJump:
        dailyBudget > 0 &&
        (dailyBudget - base.requiredRate) / dailyBudget > RAISE_STEP_CAP,
    };
  }

  // 3. Behind. If the ad is also underdelivering (low health verdict), the
  //    honest read is "diagnose delivery" — the rec box still shows the
  //    catch-up number, but a bigger budget won't fix a delivery problem.
  //    Otherwise it's a straightforward raise; largeJump flags a big single
  //    move (including the old "shortfall" case, where the catch-up rate far
  //    outruns the current daily — shown, never blocked).
  if (verdict === 'low') {
    return { state: 'delivery_low', ...base };
  }
  return {
    state: 'adjust',
    ...base,
    direction: 'raise',
    largeJump:
      dailyBudget > 0 &&
      (base.requiredRate - dailyBudget) / dailyBudget > RAISE_STEP_CAP,
  };
}

// ─── Google: month-to-date pacing health + state machine ────────────────────

export interface GoogleRecommendationInput {
  /** Planned monthly allocation ($). */
  target: number;
  /** Month-to-date served spend ($). */
  actualSpend: number;
  /** Current average daily budget ($). */
  dailyBudget: number;
  /** The monthly charging limit ($): daily × 30.4, reprorated across
   *  mid-month rate changes (server-computed). For a campaign eligible only
   *  part of the month it is prorated again below. */
  monthlyCeiling: number;
  /** Fractional calendar days elapsed since the campaign became eligible
   *  this month (effective start → now). */
  daysElapsed: number;
  /** Fractional calendar days remaining in the campaign's eligible window
   *  this month. */
  daysRemaining: number;
  /** Calendar days in the month (proration denominator). */
  daysInMonth: number;
}

export interface GoogleRecommendation {
  state: GoogleRecommendationState;
  /** Month-to-date pacing health vs. expected-to-date on the way to the
   *  ceiling (NOT vs. the daily budget — Google may spend 0–2× the daily on
   *  any single day and only commits to landing at the ceiling). */
  health: PacingHealth;
  /** The ceiling used for pacing this month ($) — prorated by eligible days
   *  for a mid-month start. */
  effectiveCeiling: number;
  /** How much a fully-delivering campaign should have spent by now ($). */
  expectedToDate: number;
  /** min(actual + run_rate × days remaining, ceiling) — Google will not bill
   *  past the ceiling, so a linear extrapolation above it is impossible. */
  projectedSpend: number;
  /** Catch-up rate ($/day): (target − actual) ÷ remaining calendar days —
   *  Google paces the remainder of the month to new_daily × remaining
   *  calendar days, so this (not target ÷ 30.4) lands the month on target.
   *  Floored at 0 (a trim past what's already spent just stops spending). */
  requiredRate: number;
  /** Most the campaign can still bill this month ($): 2 × daily × days
   *  remaining (Google's fixed single-day limit). */
  recoverableMax: number;
  direction: 'raise' | 'trim' | null;
  largeJump: boolean;
  remainingBudget: number;
  /** For `shortfall`: (target − actual) − recoverableMax ($). */
  gap: number;
  tolerance: number;
}

/**
 * The Google engine. The monthly ceiling (daily × 30.4) is the anchor: Google
 * itself paces to it, so attainment is ceiling vs target — never projection
 * vs ceiling (both derive from the same daily budget, so that comparison is a
 * ~2% artifact no rate change can fix). Health is month-to-date actual vs
 * expected-to-date, matching the calendar-month boundary Google's charging
 * limit resets on (deliberately not Meta's rolling week).
 */
export function buildGoogleRecommendation(
  input: GoogleRecommendationInput,
): GoogleRecommendation | null {
  const { target, actualSpend, dailyBudget, daysInMonth } = input;
  // Same guard as Meta: no target or no daily budget → the engine doesn't
  // apply (a $0 capacity would misread the line as a shortfall).
  if (!(target > 0) || !(dailyBudget > 0)) return null;
  const daysElapsed = Math.max(0, input.daysElapsed);
  const daysRemaining = Math.max(0, input.daysRemaining);
  const daysEligible = daysElapsed + daysRemaining;

  // Mid-month start: Google only counts the days the campaign was running,
  // so the month's ceiling shrinks proportionally.
  const effectiveCeiling =
    daysInMonth > 0 && daysEligible < daysInMonth - 1e-9
      ? input.monthlyCeiling * (daysEligible / daysInMonth)
      : input.monthlyCeiling;

  const expectedToDate =
    daysEligible > 0 ? effectiveCeiling * (daysElapsed / daysEligible) : 0;
  const runRate = daysElapsed > 0 ? actualSpend / daysElapsed : null;
  // Under a day of history the ratio is single-day noise — withhold the
  // verdict and let the machine assume delivery until the month has data.
  const ratioKnown = daysElapsed >= HEALTH_MIN_DAYS && expectedToDate > 0;
  const pacingRatio = ratioKnown ? actualSpend / expectedToDate : null;
  const health: PacingHealth = {
    windowDays: daysElapsed,
    windowSpend: actualSpend,
    expected: expectedToDate,
    pacingRatio,
    runRate,
    verdict: pacingRatio != null ? verdictOf(pacingRatio) : null,
    spendToday: null,
  };

  const remainingBudget = target - actualSpend;
  const tolerance = onTrackTolerance(
    daysEligible > 0 ? daysRemaining / daysEligible : 0,
  );
  const projectedSpend = Math.min(
    actualSpend + (runRate ?? dailyBudget) * daysRemaining,
    effectiveCeiling > 0 ? effectiveCeiling : Infinity,
  );
  const requiredRate =
    daysRemaining > 0 ? Math.max(0, remainingBudget) / daysRemaining : Infinity;
  const recoverablePerDay = GOOGLE_DAILY_MULTIPLIER * dailyBudget;
  const recoverableMax = recoverablePerDay * daysRemaining;
  const gap = Math.max(0, remainingBudget) - recoverableMax;

  const base = {
    health,
    effectiveCeiling,
    expectedToDate,
    projectedSpend,
    requiredRate: Number.isFinite(requiredRate) ? requiredRate : 0,
    recoverableMax,
    remainingBudget,
    gap,
    tolerance,
    direction: null as GoogleRecommendation['direction'],
    largeJump: false,
  };

  // 1. On track: the current ceiling lands the month on target AND the
  //    campaign is delivering toward it.
  if (
    Math.abs(effectiveCeiling - target) <= tolerance * target &&
    (pacingRatio == null || pacingRatio >= HEALTH_HEALTHY_THRESHOLD)
  ) {
    return { state: 'on_track', ...base };
  }

  // 2. Delivery-limited: cannot spend its current budget — a bigger number
  //    won't help (low search volume, bids, ad rank, schedule; diagnose).
  if (pacingRatio != null && pacingRatio < HEALTH_LOW_THRESHOLD) {
    return { state: 'delivery_limited', ...base };
  }

  // 3. Off target but a catch-up rate can fix it in the days left
  //    (required ≤ 2 × daily, the fixed single-day limit).
  if (requiredRate <= recoverablePerDay) {
    const direction = base.requiredRate >= dailyBudget ? 'raise' : 'trim';
    return {
      state: 'adjust',
      ...base,
      direction,
      largeJump:
        dailyBudget > 0 &&
        Math.abs(base.requiredRate - dailyBudget) / dailyBudget >
          RAISE_STEP_CAP,
    };
  }

  // 4. Cannot catch up even at the 2× ceiling in the days left.
  return { state: 'shortfall', ...base };
}
