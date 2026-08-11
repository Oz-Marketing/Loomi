/**
 * Google top-down budget allocator + flight-aware pacing (google-pacing-card
 * spec, §3–§12). Pure math: no React, no DB, no API.
 *
 * WHY THIS EXISTS. The old Google card paced each campaign against its own
 * hand-set budget, so there was no single account total driving the dailies:
 * moving spend meant editing every campaign by hand, and nothing showed whether
 * the account as a whole was allocated correctly. This module makes the account's
 * payable the source and derives every campaign's daily from it.
 *
 * THREE INVARIANTS, each one a bug that already happened:
 *
 *  1. ONE UNIT for the whole card (§3). Percent is always percent of PAYABLE —
 *     never percent of "payable minus the locked lines". There is no pool. Mixed
 *     units per line, and percentages measured against a shrinking pool, are what
 *     produced the toggle-drift and pool-shrink bugs in the earlier drafts.
 *  2. WHOLE DAYS anchored to the data edge (§10). The recommended daily is
 *     (target − spent) ÷ remaining, and both terms must be measured to the same
 *     point in time. Google's spend data lags and today is incomplete, so pairing
 *     a fractional day count with a lagging numerator makes the recommendation
 *     creep up through the day and drop when new data lands — a visible sawtooth
 *     with no real cause. Elapsed time shows up in `spent`, never in the day
 *     count. (Meta's card keeps fractional days: its budget model is a rolling
 *     7-day average, not a monthly one. Deliberately not shared.)
 *  3. THE RECOMMENDATION IS STATELESS (§5, do-not-change #6). It is arithmetic on
 *     target, spent, and remaining days — nothing else. Delivery diagnosis
 *     ("can this campaign even absorb more?") lives on its own surface, because a
 *     number that silently means something different depending on delivery is a
 *     number nobody can check.
 */

import { num } from './helpers';
import { clampToMonth } from './pacer-calc';
import { effMarkupOf } from './helpers';
import { googlePacingTypeLabel, isSharedBudget } from './google-pacer-calc';
import { eventBudgetFor, hasTag, parseTags } from './labels';
import { monthBoundsIso } from '@/lib/timezone';
import type { PacerAd } from './types';

// ── tunables (§5/§8) ──

/** §5 pace bands. Wider than a naive ±5% on purpose: Google can spend up to 2×
 *  the daily budget on a single day, so a tight band would flip a healthy
 *  campaign to "over" on any busy Saturday. */
export const PACE_OVER_RATIO = 1.12;
export const PACE_UNDER_RATIO = 0.88;

/**
 * §8 push threshold. Frequent daily-budget edits disrupt smart bidding's
 * learning (tCPA/tROAS, Performance Max), so a push only goes out when the drift
 * between the campaign's current daily and the recommended daily is material.
 * Two-part on purpose: the percentage keeps big budgets from being nudged for
 * pennies, and the dollar floor keeps a $3/day campaign from being "5% off" at
 * fifteen cents.
 */
export const PUSH_DRIFT_FRACTION = 0.05;
export const PUSH_DRIFT_MIN_DOLLARS = 1;

/** Dollar amounts inside a cent of each other are equal. Every "does the plan
 *  match payable" check goes through this, so a $0.004 float artifact never
 *  renders as a mismatch. */
export const MONEY_EPSILON = 0.005;
export const moneyEq = (a: number, b: number): boolean => Math.abs(a - b) < MONEY_EPSILON;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export type AllocationMode = 'pct' | 'amt';
export type PaceStatus = 'over' | 'under' | 'on' | 'none';

// ── §2 payable ──

export interface PayableInput {
  /** Client-gross budget goals for the month (the numbers typed on the card).
   *  Strings, mirroring how the pacer stores every money field. */
  baseBudgetGoal: string | null | undefined;
  addedBudgetGoal: string | null | undefined;
  /** Resolved gross→spend factor (Account.markup, else the agency default). */
  markup: number | null | undefined;
}

export interface Payable {
  /** Raw client budget before the markup — display only (§2 `totalBudget`). */
  totalBudget: number;
  /** The month's adjusted spend target: what actually gets spent on the
   *  platform, and the denominator every allocation is measured against. */
  payable: number;
  markup: number;
}

/**
 * Resolve the month's payable from the budget goals already on the card.
 *
 * Deliberately EXCLUDES the reconciliation carryover, even though the Planner's
 * budget panels add it into their derived target. Prior-month over/underspend is
 * applied by hand into the budget number when the desk wants it, so folding it in
 * here as well would double-count it — and an allocator whose denominator moves
 * on its own is one nobody can reconcile against a spreadsheet. If a month does
 * carry a carryover, say so next to the payable rather than absorbing it.
 */
export function resolvePayable(input: PayableInput): Payable {
  const markup = effMarkupOf(input.markup);
  const totalBudget = (num(input.baseBudgetGoal) ?? 0) + (num(input.addedBudgetGoal) ?? 0);
  return { totalBudget, payable: round2(totalBudget * markup), markup };
}

// ── §2/§10 the data edge ──

export interface AllocatorClock {
  period: string;
  daysInMonth: number;
  /**
   * Day-of-month of the last WHOLE day with complete Google data. 0 = the month
   * hasn't started yet (nothing elapsed). Every day count anchors here, never to
   * a live clock.
   */
  dataEdgeDay: number;
  dataEdgeIso: string | null;
  /** Day-of-month of "today" when the month in view is the current one, else null.
   *  Display only ("day 8 of 31") — it never enters a calculation. */
  todayDay: number | null;
  /**
   * The synced series ends further back than yesterday, i.e. the account hasn't
   * been synced recently. Surfaced so a stale card says so instead of quietly
   * pacing against a week-old edge.
   */
  stale: boolean;
}

/**
 * Resolve the month's data edge.
 *
 *  - Current month: the last settled day — the latest date in the synced spend
 *    series, capped at YESTERDAY because today is always partial. Capping at
 *    yesterday and reading the series edge both matter: the cap keeps a partial
 *    day out of the denominator, and the series edge keeps the edge honest when
 *    the sync is behind (spend and days then stop at the same moment, which is
 *    the whole point of §10).
 *  - Past month: the month end. Every day is settled; nothing remains.
 *  - Future month: day 0. Nothing has elapsed; the whole month remains.
 */
/** Month bounds that never come back null. A malformed period can't produce
 *  meaningful pacing, so it degrades to an inert full-month shape rather than
 *  throwing inside a render. */
function monthShape(period: string): { start: string; end: string } {
  return monthBoundsIso(period) ?? { start: `${period}-01`, end: `${period}-31` };
}

export function resolveClock(
  period: string,
  todayIso: string,
  seriesDates: readonly string[] = [],
): AllocatorClock {
  const bounds = monthShape(period);
  const daysInMonth = Number(bounds.end.slice(8, 10));
  const dayOf = (iso: string) => Number(iso.slice(8, 10));

  // Past month — fully settled.
  if (todayIso > bounds.end) {
    return {
      period,
      daysInMonth,
      dataEdgeDay: daysInMonth,
      dataEdgeIso: bounds.end,
      todayDay: null,
      stale: false,
    };
  }
  // Future month — nothing has happened yet.
  if (todayIso < bounds.start) {
    return { period, daysInMonth, dataEdgeDay: 0, dataEdgeIso: null, todayDay: null, stale: false };
  }

  const todayDay = dayOf(todayIso);
  // Yesterday, within this month. On the 1st there is no settled day yet.
  const yesterdayDay = todayDay - 1;
  const inMonth = seriesDates.filter((d) => d >= bounds.start && d <= bounds.end);
  const seriesEdgeDay = inMonth.length > 0 ? dayOf(inMonth.reduce((a, b) => (a > b ? a : b))) : null;
  // No series at all (never synced): fall back to yesterday. Spend is 0 in that
  // case anyway, so the edge only affects how the month is described.
  const edge = clamp(
    seriesEdgeDay == null ? yesterdayDay : Math.min(seriesEdgeDay, yesterdayDay),
    0,
    daysInMonth,
  );
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    period,
    daysInMonth,
    dataEdgeDay: edge,
    dataEdgeIso: edge > 0 ? `${period}-${pad(edge)}` : null,
    todayDay,
    stale: edge > 0 && edge < yesterdayDay,
  };
}

// ── §6 flight windows ──

export interface FlightDays {
  /** Day-of-month bounds of the flight WITHIN the month in view. */
  startDay: number;
  endDay: number;
  total: number;
  elapsed: number;
  remaining: number;
  /** False when the window is narrower than the month — drives the row's flight
   *  tag, which only appears when there's something to say. */
  fullMonth: boolean;
}

/**
 * Flight-day counts, anchored to the data edge, in whole days (§6).
 *
 * `remaining` counts from the first UNSETTLED day through the flight end, so it
 * includes today. That pairs with a `spent` figure that already contains whatever
 * of today Google has reported — the same instant on both sides of the division.
 */
export function flightDayCounts(
  startDay: number,
  endDay: number,
  dataEdgeDay: number,
  daysInMonth: number,
): FlightDays {
  const start = clamp(Math.round(startDay), 1, daysInMonth);
  const end = clamp(Math.round(endDay), start, daysInMonth);
  const total = Math.max(0, end - start + 1);
  const elapsed = clamp(Math.min(dataEdgeDay, end) - start + 1, 0, total);
  const remaining = Math.max(0, end - Math.max(dataEdgeDay, start - 1));
  return {
    startDay: start,
    endDay: end,
    total,
    elapsed,
    remaining,
    fullMonth: start === 1 && end === daysInMonth,
  };
}

/**
 * The flight window for one ad, as day-of-month bounds inside the month in view.
 *
 * REQUIRED CLAMPING (§6): a campaign that started in a prior month is simply the
 * full current month. The campaign's raw lifetime start is an INPUT to the clamp,
 * never the flight itself — treating it as the flight is what made a two-year-old
 * campaign read as "running since 2024" and paced against a 900-day window.
 * `clampToMonth` owns the date precedence (override → Google's own dates →
 * planner) so this card, eligibility, and reconciliation can't diverge.
 */
export function resolveFlight(ad: PacerAd, clock: AllocatorClock): FlightDays {
  const bounds = monthShape(clock.period);
  const { effectiveStart, effectiveEnd } = clampToMonth({
    ...ad,
    period: clock.period,
  } as unknown as Parameters<typeof clampToMonth>[0]);
  const startDay =
    effectiveStart && effectiveStart >= bounds.start && effectiveStart <= bounds.end
      ? Number(effectiveStart.slice(8, 10))
      : 1;
  const endDay =
    effectiveEnd && effectiveEnd >= bounds.start && effectiveEnd <= bounds.end
      ? Number(effectiveEnd.slice(8, 10))
      : clock.daysInMonth;
  return flightDayCounts(startDay, endDay, clock.dataEdgeDay, clock.daysInMonth);
}

// ── §3/§5 per-line allocation + pacing ──

export interface AllocatorLine {
  id: string;
  name: string;
  /** Stable index into the campaign color palette — the same color identifies
   *  this line in the meter, its row chip, and the health popup. */
  colorIndex: number;
  /** The line's value in the CARD'S unit: percent in 'pct' mode, dollars in 'amt'. */
  input: number;
  /** Dollar target for the month, derived from `input` and the payable. */
  target: number;
  /** Percent of payable, always computed — the companion readout in dollar mode. */
  percentOfPayable: number;
  spentMTD: number;
  expectedToDate: number;
  /** spent − expected, in dollars. The gap is legible as money on the badge; the
   *  ratio alone made a $4 miss and a $400 miss look identical. */
  paceDelta: number;
  paceRatio: number | null;
  paceStatus: PaceStatus;
  evenDaily: number;
  recommendedDaily: number;
  /** The campaign's current average daily budget on the platform. */
  currentDaily: number;
  flight: FlightDays;
  locked: boolean;
  tags: string[];
  pacingType: 'Daily' | 'Total';
  shared: boolean;
  sharedCount: number | null;
  hasAdSchedule: boolean;
  budgetLimited: boolean;
  disapproved: boolean;
  /** A Total-budget (CUSTOM_PERIOD) campaign has no daily lever — Google paces it
   *  to its own end date. It still holds an allocation and counts toward the
   *  meter, but it is never handed a recommended daily to push. */
  dailyControllable: boolean;
}

export interface AllocatorContext {
  mode: AllocationMode;
  payable: number;
  clock: AllocatorClock;
}

/** The dollar target for a line, given the card's unit (§3). Percent is always
 *  percent of payable — the one rule that keeps modes from drifting. */
export function targetOf(input: number, mode: AllocationMode, payable: number): number {
  return mode === 'pct' ? round2((input / 100) * payable) : round2(input);
}

/** A line's stored input in the card's current unit. In percent mode this reads
 *  `allocationPercent` (the stored percent) so the dollar target can be
 *  RE-DERIVED when the payable changes; a stored dollar alone can't do that.
 *  Falls back to inferring the percent from the dollars for rows that predate
 *  percent mode. */
export function inputOf(ad: PacerAd, mode: AllocationMode, payable: number): number {
  const dollars = num(ad.allocation) ?? 0;
  if (mode === 'amt') return dollars;
  const stored = num(ad.allocationPercent);
  if (stored != null) return stored;
  return payable > 0 ? round2((dollars / payable) * 100) : 0;
}

export function buildAllocatorLine(
  ad: PacerAd,
  colorIndex: number,
  ctx: AllocatorContext,
): AllocatorLine {
  const input = inputOf(ad, ctx.mode, ctx.payable);
  const target = targetOf(input, ctx.mode, ctx.payable);
  // §11: month-to-date spend for the month in view. Never lifetime, and never the
  // cross-month counted figure — a target that spans a month boundary is the
  // reconciliation case, handled elsewhere, and mixing the two here would compare
  // a monthly target against a multi-month actual.
  const spentMTD = num(ad.pacerActual) ?? 0;
  const flight = resolveFlight(ad, ctx.clock);

  const expectedToDate =
    flight.total > 0 ? round2((target * flight.elapsed) / flight.total) : 0;
  const evenDaily = flight.total > 0 ? target / flight.total : 0;
  const recommendedDaily =
    flight.remaining > 0 ? Math.max(0, target - spentMTD) / flight.remaining : 0;
  const paceRatio = expectedToDate > 0 ? spentMTD / expectedToDate : null;
  const paceStatus: PaceStatus =
    paceRatio == null
      ? 'none'
      : paceRatio > PACE_OVER_RATIO
        ? 'over'
        : paceRatio < PACE_UNDER_RATIO
          ? 'under'
          : 'on';

  const pacingType = googlePacingTypeLabel(ad.googleBudgetPeriod, ad.budgetType);
  return {
    id: ad.id,
    name: ad.name || 'Untitled campaign',
    colorIndex,
    input,
    target,
    percentOfPayable: ctx.payable > 0 ? (target / ctx.payable) * 100 : 0,
    spentMTD,
    expectedToDate,
    paceDelta: round2(spentMTD - expectedToDate),
    paceRatio,
    paceStatus,
    evenDaily,
    recommendedDaily,
    currentDaily: num(ad.pacerDailyBudget) ?? 0,
    flight,
    locked: ad.pacerLocked === true,
    tags: parseTags(ad.pacerTags),
    pacingType,
    shared: isSharedBudget(ad.googleBudgetReferenceCount),
    sharedCount: isSharedBudget(ad.googleBudgetReferenceCount)
      ? (ad.googleBudgetReferenceCount ?? null)
      : null,
    hasAdSchedule: !!ad.googleHasAdSchedule,
    budgetLimited: !!ad.googleBudgetConstrained,
    disapproved: !!ad.googleAdsDisapproved,
    dailyControllable: pacingType === 'Daily',
  };
}

// ── §9 the view: filtered subset + rescoped totals ──

export interface AllocatorTotals {
  allocated: number;
  spent: number;
  expected: number;
  evenDaily: number;
  /** Σ recommended daily across the visible, daily-controllable lines. This is
   *  what should match the account daily budget total in Google Ads Manager. */
  accountDaily: number;
  lockedTarget: number;
  /** Payable unfiltered; the label's event budget (else the subset's own total)
   *  when a filter is active (§9). */
  denominator: number;
  /** denominator − allocated. Positive = unallocated, negative = over. */
  unallocated: number;
  fullyAllocated: boolean;
  paceRatio: number | null;
  paceStatus: PaceStatus;
}

export interface AllocatorView {
  /** Every line, in table order. */
  lines: AllocatorLine[];
  /** The lines the active label filter admits (all of them when unfiltered). */
  visible: AllocatorLine[];
  totals: AllocatorTotals;
  activeLabel: string | null;
  /** The label's intended budget, when one is set and a filter is active. */
  eventBudget: number | null;
  /** Denominator provenance, so the UI can name what it's checking against. */
  denominatorKind: 'payable' | 'eventBudget' | 'subsetTotal';
}

export interface BuildViewInput {
  ads: PacerAd[];
  mode: AllocationMode;
  payable: number;
  clock: AllocatorClock;
  activeLabel?: string | null;
  eventBudgets?: Record<string, number> | null;
}

/**
 * Build the whole card's view — lines plus rescoped totals.
 *
 * SUBSET RESCOPING (§9, required): when a label filter is active EVERY summary
 * number reflects only the filtered set — allocated, spent, the meter, the totals
 * row, the header pace. A filtered view that keeps account-wide totals is worse
 * than no filter at all, because the numbers look authoritative and describe a
 * different set of campaigns than the rows underneath them.
 */
export function buildAllocatorView(input: BuildViewInput): AllocatorView {
  const ctx: AllocatorContext = {
    mode: input.mode,
    payable: input.payable,
    clock: input.clock,
  };
  const lines = input.ads.map((ad, i) => buildAllocatorLine(ad, i, ctx));
  const activeLabel = input.activeLabel ?? null;
  const visible =
    activeLabel == null
      ? lines
      : lines.filter((line) => line.tags.some((t) => t.toLowerCase() === activeLabel.toLowerCase()));

  const allocated = round2(visible.reduce((s, l) => s + l.target, 0));
  const spent = round2(visible.reduce((s, l) => s + l.spentMTD, 0));
  const expected = round2(visible.reduce((s, l) => s + l.expectedToDate, 0));
  const evenDaily = visible.reduce((s, l) => s + l.evenDaily, 0);
  // Only daily-controllable lines contribute: a Total-budget campaign's daily is
  // not a lever, so including it would produce an account daily total that can
  // never match what Google Ads Manager shows.
  const accountDaily = visible.reduce(
    (s, l) => s + (l.dailyControllable ? l.recommendedDaily : 0),
    0,
  );
  const lockedTarget = round2(visible.filter((l) => l.locked).reduce((s, l) => s + l.target, 0));

  const eventBudget = activeLabel ? eventBudgetFor(input.eventBudgets, activeLabel) : null;
  const denominatorKind: AllocatorView['denominatorKind'] =
    activeLabel == null ? 'payable' : eventBudget != null && eventBudget > 0 ? 'eventBudget' : 'subsetTotal';
  const denominator =
    denominatorKind === 'payable'
      ? input.payable
      : denominatorKind === 'eventBudget'
        ? (eventBudget as number)
        : allocated;

  const paceRatio = expected > 0 ? spent / expected : null;
  return {
    lines,
    visible,
    totals: {
      allocated,
      spent,
      expected,
      evenDaily,
      accountDaily,
      lockedTarget,
      denominator,
      unallocated: round2(denominator - allocated),
      fullyAllocated: moneyEq(denominator, allocated),
      paceRatio,
      paceStatus:
        paceRatio == null
          ? 'none'
          : paceRatio > PACE_OVER_RATIO
            ? 'over'
            : paceRatio < PACE_UNDER_RATIO
              ? 'under'
              : 'on',
    },
    activeLabel,
    eventBudget,
    denominatorKind,
  };
}

// ── §3 mode switching ──

export interface ModeSwitchRow {
  id: string;
  /** New input in the target unit. */
  input: number;
  /** Dollar target — unchanged by the switch, by definition. */
  target: number;
}

/**
 * Convert every line in place when the card's unit changes (§3, AC 2).
 *
 * Targets do not move. A switch is a change of NOTATION, not of plan: pct→amt
 * writes the dollars the percent already meant, amt→pct writes the percent those
 * dollars already were. Anything else and a rep who toggles the unit twice to see
 * both views has silently rewritten the month.
 */
export function convertMode(
  lines: readonly { id: string; input: number }[],
  from: AllocationMode,
  to: AllocationMode,
  payable: number,
): ModeSwitchRow[] {
  return lines.map((line) => {
    const target = targetOf(line.input, from, payable);
    if (from === to) return { id: line.id, input: line.input, target };
    if (to === 'amt') return { id: line.id, input: round2(target), target };
    // amt → pct. With no payable there is no percentage to express; hold at 0
    // rather than dividing by zero and writing Infinity into the plan.
    const pct = payable > 0 ? round2((line.input / payable) * 100) : 0;
    return { id: line.id, input: pct, target: targetOf(pct, 'pct', payable) };
  });
}

// ── §12 balance ──

export type BalanceMode = 'proportional' | 'even';

/**
 * Make the allocation total equal the denominator, adjusting ONLY unlocked lines
 * (§12, AC 3).
 *
 * `denominatorInUnit` is the target total EXPRESSED IN THE CARD'S UNIT — 100 in
 * percent mode unfiltered, the payable in dollar mode, and the label's own share
 * of either when a filter is active. Taking it as a parameter rather than deriving
 * it from the mode is what lets a filtered view balance an event budget: deriving
 * would hardcode "100%" and quietly rescale the event to the whole account.
 *
 * `room` is what's left of it after the locked carve-outs. Locked lines are never
 * touched by either mode — that is the entire meaning of a lock.
 *
 * Proportional keeps the unlocked lines' relative shape (the default: it preserves
 * the judgment already encoded in the split); even sets them equal. Proportional
 * falls back to even when the unlocked lines currently sum to zero, since there
 * is no shape to preserve.
 */
export function balance(
  lines: readonly { id: string; input: number; locked: boolean }[],
  denominatorInUnit: number,
  balanceMode: BalanceMode,
): Map<string, number> {
  const out = new Map<string, number>();
  const unlocked = lines.filter((l) => !l.locked);
  if (unlocked.length === 0) return out;
  const lockedSum = lines.filter((l) => l.locked).reduce((s, l) => s + l.input, 0);
  const room = Math.max(0, denominatorInUnit - lockedSum);

  if (balanceMode === 'even' || unlocked.reduce((s, l) => s + l.input, 0) <= 0) {
    // Distribute the rounding remainder over the first lines so the total lands
    // exactly on `room` instead of a cent or two short.
    const shares = splitEvenly(room, unlocked.length);
    unlocked.forEach((l, i) => out.set(l.id, shares[i]));
    return out;
  }
  const sum = unlocked.reduce((s, l) => s + l.input, 0);
  const scaled = unlocked.map((l) => (l.input / sum) * room);
  const rounded = reconcileRounding(scaled, room);
  unlocked.forEach((l, i) => out.set(l.id, rounded[i]));
  return out;
}

/** `total` split into `n` equal parts, exact to the cent (leftover cents land on
 *  the earliest parts rather than vanishing). */
function splitEvenly(total: number, n: number): number[] {
  if (n <= 0) return [];
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  const extra = cents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) / 100);
}

/** Round a set of shares to cents so they sum EXACTLY to `total` — the largest
 *  remainders absorb the leftover cents. */
function reconcileRounding(values: readonly number[], total: number): number[] {
  const targetCents = Math.round(total * 100);
  const floors = values.map((v) => Math.floor(v * 100));
  let diff = targetCents - floors.reduce((s, v) => s + v, 0);
  const order = values
    .map((v, i) => ({ i, frac: v * 100 - Math.floor(v * 100) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (let k = 0; k < order.length && diff > 0; k++, diff--) out[order[k].i] += 1;
  // Negative diff (values rounded above the total) — shave from the smallest
  // remainders so no line goes negative.
  for (let k = order.length - 1; k >= 0 && diff < 0; k--, diff++) {
    if (out[order[k].i] > 0) out[order[k].i] -= 1;
  }
  return out.map((c) => c / 100);
}

// ── §8 move / distribute ──

export type MoveSource = { kind: 'campaign'; id: string } | { kind: 'unallocated' };
export type MoveMethod = 'even' | 'custom';

export interface MovePlanInput {
  lines: readonly AllocatorLine[];
  mode: AllocationMode;
  payable: number;
  source: MoveSource;
  /** Destination campaign ids, in selection order. */
  destinationIds: readonly string[];
  method: MoveMethod;
  /** Total to spread (even method), in DOLLARS. */
  evenTotal?: number;
  /** Per-destination dollar amounts (custom method). */
  customAmounts?: Record<string, number>;
  /** The denominator in force — payable, or the subset's when filtered (§9). */
  denominator: number;
}

export interface MoveAllocation {
  id: string;
  name: string;
  amount: number;
  targetBefore: number;
  targetAfter: number;
  recommendedDailyAfter: number;
}

export interface MovePlan {
  ok: boolean;
  /** Why the move can't run — shown verbatim, so it names the actual limit. */
  error: string | null;
  total: number;
  available: number;
  source: { label: string; targetBefore: number; targetAfter: number; recommendedDailyAfter: number } | null;
  allocations: MoveAllocation[];
  /** New input values (card's unit) to write, keyed by line id. */
  inputs: Map<string, number>;
}

/** What the source has to give: a campaign's own target, or the leftover between
 *  the allocation and the denominator (§8). */
export function sourceAvailable(input: {
  lines: readonly AllocatorLine[];
  source: MoveSource;
  denominator: number;
}): number {
  const source = input.source;
  if (source.kind === 'unallocated') {
    const allocated = input.lines.reduce((s, l) => s + l.target, 0);
    return Math.max(0, round2(input.denominator - allocated));
  }
  return input.lines.find((l) => l.id === source.id)?.target ?? 0;
}

/**
 * Plan a redistribution (§8, AC 9). CONSERVES the total: every destination gains
 * its amount and a campaign source loses their sum, so the account (or the
 * filtered subset) ends where it started. An "Unallocated" source consumes the
 * leftover instead, which is the one case where the allocated total is meant to
 * rise.
 *
 * Locked lines are excluded as both source and destination (§4) — a carve-out
 * that automated redistribution can still empty isn't a carve-out.
 *
 * Returns a preview rather than mutating: source and each destination, target
 * before → after, and the new recommended daily. Committing is the caller's move.
 */
export function planMove(input: MovePlanInput): MovePlan {
  const byId = new Map(input.lines.map((l) => [l.id, l]));
  const empty: MovePlan = {
    ok: false,
    error: null,
    total: 0,
    available: 0,
    source: null,
    allocations: [],
    inputs: new Map(),
  };

  const sourceLine = input.source.kind === 'campaign' ? byId.get(input.source.id) : null;
  if (input.source.kind === 'campaign' && !sourceLine) {
    return { ...empty, error: 'Pick a source to move budget from.' };
  }
  if (sourceLine?.locked) {
    return { ...empty, error: `${sourceLine.name} is locked — unlock it to move its budget.` };
  }

  const destinations = input.destinationIds
    .map((id) => byId.get(id))
    .filter((l): l is AllocatorLine => !!l && !l.locked && l.id !== sourceLine?.id);
  if (destinations.length === 0) {
    return { ...empty, error: null, available: sourceAvailable(input) };
  }

  const amounts = new Map<string, number>();
  if (input.method === 'even') {
    const total = Number(input.evenTotal);
    if (!Number.isFinite(total) || total <= 0) {
      return { ...empty, available: sourceAvailable(input) };
    }
    const shares = splitEvenly(total, destinations.length);
    destinations.forEach((d, i) => amounts.set(d.id, shares[i]));
  } else {
    for (const d of destinations) {
      const amount = Number(input.customAmounts?.[d.id]);
      if (Number.isFinite(amount) && amount > 0) amounts.set(d.id, round2(amount));
    }
    if (amounts.size === 0) return { ...empty, available: sourceAvailable(input) };
  }

  const total = round2([...amounts.values()].reduce((s, v) => s + v, 0));
  const available = sourceAvailable(input);
  if (total > available + MONEY_EPSILON) {
    const label = sourceLine ? sourceLine.name : 'Unallocated';
    return {
      ...empty,
      total,
      available,
      error: `${label} only has $${available.toFixed(2)} to give.`,
    };
  }

  // Convert a dollar delta into the card's unit. In percent mode a dollar move is
  // expressed as percentage points of payable, which is what keeps the move
  // conserving in BOTH units (AC 9).
  const toInput = (dollars: number) =>
    input.mode === 'pct'
      ? input.payable > 0
        ? (dollars / input.payable) * 100
        : 0
      : dollars;

  const inputs = new Map<string, number>();
  const allocations: MoveAllocation[] = [];
  for (const d of destinations) {
    const amount = amounts.get(d.id);
    if (amount == null) continue;
    const nextInput = round2(d.input + toInput(amount));
    const targetAfter = targetOf(nextInput, input.mode, input.payable);
    inputs.set(d.id, nextInput);
    allocations.push({
      id: d.id,
      name: d.name,
      amount,
      targetBefore: d.target,
      targetAfter,
      recommendedDailyAfter: recommendedDailyFor(targetAfter, d.spentMTD, d.flight.remaining),
    });
  }

  let source: MovePlan['source'] = null;
  if (sourceLine) {
    const nextInput = round2(sourceLine.input - toInput(total));
    const targetAfter = targetOf(nextInput, input.mode, input.payable);
    inputs.set(sourceLine.id, nextInput);
    source = {
      label: sourceLine.name,
      targetBefore: sourceLine.target,
      targetAfter,
      recommendedDailyAfter: recommendedDailyFor(
        targetAfter,
        sourceLine.spentMTD,
        sourceLine.flight.remaining,
      ),
    };
  } else {
    source = {
      label: 'Unallocated',
      targetBefore: available,
      targetAfter: round2(available - total),
      recommendedDailyAfter: 0,
    };
  }

  return { ok: true, error: null, total, available, source, allocations, inputs };
}

/** The §5 catch-up rate, exposed for previews: remaining budget ÷ remaining
 *  whole flight days. */
export function recommendedDailyFor(
  target: number,
  spent: number,
  remainingDays: number,
): number {
  return remainingDays > 0 ? Math.max(0, target - spent) / remainingDays : 0;
}

// ── §7 delivery health verdict ──

export type DeliveryVerdictKind = 'at_cap_ahead' | 'at_cap' | 'room' | 'underdelivering';

export interface DeliveryVerdict {
  kind: DeliveryVerdictKind;
  /** avgDailyDelivered ÷ cap. null when there's no cap to measure against. */
  ratio: number | null;
  avgDaily: number;
  windowSpend: number;
  cap: number;
}

/**
 * §7 — "should I move spend, and which way?", which the pace badge alone cannot
 * answer. The two underspending cases look IDENTICAL on the badge and need
 * opposite actions: a campaign that is behind but delivering its full daily just
 * needs a higher cap, while one spending half its cap cannot absorb more budget at
 * all and the money should go elsewhere. Distinguishing those is the entire value
 * of the popup.
 *
 * Kept out of the recommended-daily math on purpose (do-not-change #6).
 */
export function deliveryVerdict(
  series: readonly { date: string; spend: number }[],
  cap: number,
  windowDays: number,
  paceStatus: PaceStatus,
): DeliveryVerdict {
  const window = series.slice(-Math.max(1, windowDays));
  const windowSpend = window.reduce((s, p) => s + (Number(p.spend) || 0), 0);
  // Divide by the window's LENGTH, not the requested days: a campaign with 4 days
  // of history shouldn't read as underdelivering because we asked for 7.
  const avgDaily = window.length > 0 ? windowSpend / window.length : 0;
  const ratio = cap > 0 ? avgDaily / cap : null;
  let kind: DeliveryVerdictKind;
  if (ratio == null) kind = 'room';
  else if (ratio >= 0.9) kind = paceStatus === 'over' ? 'at_cap_ahead' : 'at_cap';
  else if (ratio >= 0.5) kind = 'room';
  else kind = 'underdelivering';
  return { kind, ratio, avgDaily, windowSpend, cap };
}

// ── §8 push plan ──

export type PushSkipReason =
  | 'not_linked'
  | 'total_budget'
  | 'shared_budget'
  | 'no_target'
  | 'below_threshold';

export interface PushCandidate {
  id: string;
  name: string;
  /** The campaign budget resource to mutate. */
  budgetResourceName: string;
  currentDaily: number;
  newDaily: number;
  drift: number;
}

export interface PushSkip {
  id: string;
  name: string;
  reason: PushSkipReason;
  currentDaily: number;
  newDaily: number;
}

export interface PushPlan {
  candidates: PushCandidate[];
  skipped: PushSkip[];
  /** Σ recommended daily across pushable lines — what Google Ads Manager's
   *  account daily total should read after the push. */
  accountDailyAfter: number;
}

/**
 * Decide which lines to push (§8, AC 11).
 *
 * Four things get held back, each for its own reason:
 *  - unlinked rows: there is no budget resource to mutate;
 *  - Total-budget campaigns: Google paces those to their own end date, there is
 *    no daily to set;
 *  - SHARED budgets: several campaigns point at one budget, so per-campaign daily
 *    control doesn't exist. Flagged rather than silently pushed — writing one
 *    campaign's number onto a budget its siblings also spend from would quietly
 *    change campaigns nobody touched;
 *  - drift below the threshold: rewriting a daily that's already right costs
 *    smart bidding its learning for nothing.
 *
 * Locked lines ARE pushed. A lock protects a carve-out from redistribution; it
 * says nothing about whether the platform should be told the rate that carve-out
 * needs.
 */
export function buildPushPlan(
  lines: readonly AllocatorLine[],
  budgetResourceByLine: ReadonlyMap<string, string | null>,
  options: { driftFraction?: number; driftMinDollars?: number } = {},
): PushPlan {
  const driftFraction = options.driftFraction ?? PUSH_DRIFT_FRACTION;
  const driftMin = options.driftMinDollars ?? PUSH_DRIFT_MIN_DOLLARS;
  const candidates: PushCandidate[] = [];
  const skipped: PushSkip[] = [];

  for (const line of lines) {
    const newDaily = round2(line.recommendedDaily);
    const base = { id: line.id, name: line.name, currentDaily: line.currentDaily, newDaily };
    if (!line.dailyControllable) {
      skipped.push({ ...base, reason: 'total_budget' });
      continue;
    }
    if (line.shared) {
      skipped.push({ ...base, reason: 'shared_budget' });
      continue;
    }
    const resource = budgetResourceByLine.get(line.id);
    if (!resource) {
      skipped.push({ ...base, reason: 'not_linked' });
      continue;
    }
    if (line.target <= 0) {
      skipped.push({ ...base, reason: 'no_target' });
      continue;
    }
    const drift = Math.abs(newDaily - line.currentDaily);
    const threshold = Math.max(driftMin, line.currentDaily * driftFraction);
    if (drift < threshold) {
      skipped.push({ ...base, reason: 'below_threshold' });
      continue;
    }
    candidates.push({ ...base, budgetResourceName: resource, drift: round2(drift) });
  }

  return {
    candidates,
    skipped,
    accountDailyAfter: round2(
      lines.reduce((s, l) => s + (l.dailyControllable ? l.recommendedDaily : 0), 0),
    ),
  };
}

/** Does this ad carry the given label? Re-exported so callers don't reach past
 *  the allocator into the label module for one predicate. */
export const lineHasLabel = (ad: PacerAd, label: string): boolean => hasTag(ad.pacerTags, label);
