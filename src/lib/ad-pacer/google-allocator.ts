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

import {
  GOOGLE_AT_CAP_RATIO,
  GOOGLE_RECENT_PACE_MIN_DAYS,
  GOOGLE_RECENT_PACE_WINDOW_DAYS,
  MONTH_DAYS_MULTIPLIER,
  MOVE_DEST_JUMP_WARN_RATIO,
  MOVE_SOURCE_PACE_WARN_RATIO,
} from './constants';
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
/** §6 — the precision a DERIVED percent is carried at. Not two decimals: the
 *  dollar target is rebuilt from this number, and two decimals is exactly the
 *  round trip that shaved cents off fixed allocations. Ten is far below any
 *  cent's worth of payable and keeps the stored string free of float noise. */
const round10 = (n: number): number => Math.round(n * 1e10) / 1e10;
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
  /** Target still unspent: max(0, target − spent). Floored at zero — an
   *  overspent campaign has nothing left to spend, not a negative amount. */
  remainingBudget: number;
  /**
   * Where this campaign lands if the daily budget is left exactly as it is:
   * spent + currentDaily × remaining flight days. A forecast of the CURRENT
   * setting, deliberately not of the recommendation — its whole job is to show
   * what happens if nobody acts. Null when no daily has synced, since a
   * projection off a zero rate would read as "will spend nothing" when the
   * truth is "we do not know the rate".
   */
  projectedSpend: number | null;
  /** The campaign's current average daily budget on the platform. */
  currentDaily: number;
  flight: FlightDays;
  locked: boolean;
  /**
   * §12 Reserved: committed budget that cannot spend yet. IN allocation, OUT of
   * pacing. `target` still counts toward the account total; `expectedToDate`,
   * `paceStatus` and `recommendedDaily` are all zeroed, because a campaign that
   * is not supposed to spend yet cannot be behind, and a daily for it would be a
   * rate to push at a campaign that does not exist.
   */
  reserved: boolean;
  tags: string[];
  pacingType: 'Daily' | 'Total';
  /** Google's channel rollup (Search / Display / PMax / …) — the planner shows it
   *  under the name, so the pacing surfaces show it too rather than making you
   *  switch tabs to tell a Search line from a PMax one. */
  channelType: string | null;
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
 *  percent mode.
 *
 *  THE INFERRED PERCENT IS NOT ROUNDED (§6). It used to come back at two
 *  decimals, and the dollar target is then rebuilt FROM it — so a line stored at
 *  $1,694.00 inferred 14.49%, and 14.49% of payable rebuilt a few cents off the
 *  amount someone had typed. That round trip is the cent drift: the allocation
 *  wandered on refresh, and a clean dollar amount written by the Planner (which
 *  stores a null percent, so the Pacer always has to infer one) arrived here
 *  light. Carrying full precision makes `percent / 100 × payable` land back on
 *  the exact cents. The rounding belongs to the DISPLAY, not to the stored
 *  value — see `formatInput` on the card. */
export function inputOf(ad: PacerAd, mode: AllocationMode, payable: number): number {
  const dollars = num(ad.allocation) ?? 0;
  if (mode === 'amt') return dollars;
  const stored = num(ad.allocationPercent);
  if (stored != null) return stored;
  return payable > 0 ? round10((dollars / payable) * 100) : 0;
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

  // §12 — a reserved line is out of pacing entirely. Everything below is zeroed
  // rather than computed-then-ignored, so no downstream sum can accidentally
  // pick one of these figures back up. A reserve at 0% of expected is not
  // "underspending", it is a campaign doing exactly what was intended.
  const reserved = ad.pacerReserved === true;
  const expectedToDate =
    reserved || flight.total <= 0 ? 0 : round2((target * flight.elapsed) / flight.total);
  const evenDaily = reserved || flight.total <= 0 ? 0 : target / flight.total;
  const recommendedDaily =
    reserved || flight.remaining <= 0
      ? 0
      : Math.max(0, target - spentMTD) / flight.remaining;
  const paceRatio = expectedToDate > 0 ? spentMTD / expectedToDate : null;
  const paceStatus: PaceStatus =
    reserved || paceRatio == null
      ? 'none'
      : paceRatio > PACE_OVER_RATIO
        ? 'over'
        : paceRatio < PACE_UNDER_RATIO
          ? 'under'
          : 'on';

  const pacingType = googlePacingTypeLabel(ad.googleBudgetPeriod, ad.budgetType);
  const currentDaily = num(ad.pacerDailyBudget) ?? 0;
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
    remainingBudget: round2(Math.max(0, target - spentMTD)),
    // No projection for a reserved line: it is not running, so "where it lands"
    // has no answer until it launches.
    projectedSpend:
      !reserved && currentDaily > 0
        ? round2(spentMTD + currentDaily * flight.remaining)
        : null,
    currentDaily,
    flight,
    locked: ad.pacerLocked === true,
    reserved,
    tags: parseTags(ad.pacerTags),
    pacingType,
    channelType: ad.googleChannelType ?? null,
    shared: isSharedBudget(ad.googleBudgetReferenceCount),
    sharedCount: isSharedBudget(ad.googleBudgetReferenceCount)
      ? (ad.googleBudgetReferenceCount ?? null)
      : null,
    hasAdSchedule: !!ad.googleHasAdSchedule,
    budgetLimited: !!ad.googleBudgetConstrained,
    disapproved: !!ad.googleAdsDisapproved,
    // Reserved lines are excluded here too, which is what keeps them out of the
    // account daily total AND out of the push plan in one place.
    dailyControllable: pacingType === 'Daily' && !reserved,
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
  /** Σ target of reserved lines — in the allocation, out of every pacing figure. */
  reservedTarget: number;
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
  /**
   * The label's BUDGET TARGET, when one is set and a filter is active. Two
   * numbers because the desk and the platform deal in different dollars:
   *
   *  - `gross` is what someone typed — the CLIENT budget for that push, the
   *    figure the event was actually sold at.
   *  - `spend` is that times the account's markup: the part of it that reaches
   *    Google, and therefore the only figure the campaign allocations (which are
   *    spend dollars) can honestly be measured against.
   *
   * It used to be one raw number used directly as the denominator, which forced
   * whoever typed it to do the margin conversion in their head — and typing the
   * gross figure, which is the natural thing to reach for, produced a shortfall
   * exactly the size of the margin against money that was never going to reach
   * Google in the first place.
   */
  budgetTarget: { gross: number; spend: number } | null;
  /** Denominator provenance, so the UI can name what it's checking against. */
  denominatorKind: 'payable' | 'budgetTarget' | 'subsetTotal';
}

export interface BuildViewInput {
  ads: PacerAd[];
  mode: AllocationMode;
  payable: number;
  clock: AllocatorClock;
  activeLabel?: string | null;
  /** Per-label budget targets in CLIENT-GROSS dollars, keyed by label. Persisted
   *  as `googleEventBudgets` — the column predates the rename. */
  eventBudgets?: Record<string, number> | null;
  /** The account's gross→spend factor, for converting a target to spend. Omit
   *  and a target is taken at face value, which is the pre-conversion behavior. */
  markup?: number | null;
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
  // §12 — how much of the allocation is set aside for campaigns that cannot
  // spend yet. Counted IN `allocated` (the reserve is committed money and the
  // payable check must see it) but surfaced separately so the account read can
  // say why expected-MTD is lower than the allocation implies.
  const reservedTarget = round2(
    visible.filter((l) => l.reserved).reduce((s, l) => s + l.target, 0),
  );

  // The stored figure is CLIENT-GROSS; the denominator has to be spend, because
  // that is what every campaign target on the other side of the comparison is.
  const targetGross = activeLabel ? eventBudgetFor(input.eventBudgets, activeLabel) : null;
  const markup = input.markup != null && input.markup > 0 ? input.markup : 1;
  const budgetTarget =
    targetGross != null && targetGross > 0
      ? { gross: round2(targetGross), spend: round2(targetGross * markup) }
      : null;
  const denominatorKind: AllocatorView['denominatorKind'] =
    activeLabel == null ? 'payable' : budgetTarget != null ? 'budgetTarget' : 'subsetTotal';
  const denominator =
    denominatorKind === 'payable'
      ? input.payable
      : denominatorKind === 'budgetTarget'
        ? (budgetTarget as { spend: number }).spend
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
      reservedTarget,
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
    budgetTarget,
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
    //
    // Full precision, not two decimals (§6). The dollar target is rebuilt from
    // this percent, so rounding it here is what made a switch to percent and
    // back shave cents off a fixed allocation — the switch is a change of
    // notation and must move no money at all.
    const pct = payable > 0 ? round10((line.input / payable) * 100) : 0;
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
 * `room` is what's left of it after the carve-outs. Locked lines are never
 * touched by either mode — that is the entire meaning of a lock — and RESERVED
 * lines are carved out for the same reason (§12): Balance would otherwise scale
 * or flatten a reserve like any other line, silently redistributing money that
 * was deliberately committed to a campaign which cannot spend it yet.
 *
 * Proportional keeps the unlocked lines' relative shape (the default: it preserves
 * the judgment already encoded in the split); even sets them equal. Proportional
 * falls back to even when the unlocked lines currently sum to zero, since there
 * is no shape to preserve.
 */
export function balance(
  lines: readonly { id: string; input: number; locked: boolean; reserved?: boolean }[],
  denominatorInUnit: number,
  balanceMode: BalanceMode,
): Map<string, number> {
  const out = new Map<string, number>();
  const untouchable = (l: { locked: boolean; reserved?: boolean }) => l.locked || l.reserved;
  const adjustable = lines.filter((l) => !untouchable(l));
  if (adjustable.length === 0) return out;
  const carvedOut = lines.filter(untouchable).reduce((s, l) => s + l.input, 0);
  const room = Math.max(0, denominatorInUnit - carvedOut);

  if (balanceMode === 'even' || adjustable.reduce((s, l) => s + l.input, 0) <= 0) {
    // Distribute the rounding remainder over the first lines so the total lands
    // exactly on `room` instead of a cent or two short.
    const shares = splitEvenly(room, adjustable.length);
    adjustable.forEach((l, i) => out.set(l.id, shares[i]));
    return out;
  }
  const sum = adjustable.reduce((s, l) => s + l.input, 0);
  const scaled = adjustable.map((l) => (l.input / sum) * room);
  const rounded = reconcileRounding(scaled, room);
  adjustable.forEach((l, i) => out.set(l.id, rounded[i]));
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

/** A §9 soft warning: shown next to the preview, never a block. */
export interface MoveWarning {
  kind: 'source_below_pace' | 'destination_daily_jump';
  /** Which line it concerns, so the UI can put it beside the right row. */
  lineId: string;
  message: string;
}

export interface MovePlan {
  ok: boolean;
  /** Why the move can't run — shown verbatim, so it names the actual limit. */
  error: string | null;
  total: number;
  /** The HARD cap: target − spent MTD for a campaign source (§9). */
  available: number;
  /** What the source has already spent. Displayed beside `available` so the cap
   *  reads as a fact about this campaign rather than an arbitrary limit. */
  sourceSpent: number;
  source: { label: string; targetBefore: number; targetAfter: number; recommendedDailyAfter: number } | null;
  allocations: MoveAllocation[];
  /** Judgment-call flags. A move with warnings is still `ok: true`. */
  warnings: MoveWarning[];
  /** New input values (card's unit) to write, keyed by line id. */
  inputs: Map<string, number>;
}

/**
 * What the source has to give.
 *
 * For a campaign this is **target − spent MTD**, never the full target. Money
 * already spent cannot be given away: it has left the account and is sitting in
 * Google's ledger against that campaign. Offering the whole target produces a
 * move that looks conserving on the card and is arithmetically impossible in
 * reality — the source ends the month with a target below what it has already
 * spent, so its remaining budget is negative and its recommended daily pins to
 * zero while the campaign keeps delivering. This is the §9 correctness fix.
 *
 * It is deliberately the SAME quantity the panel shows as "remaining budget"
 * (§6). One number, two names; computing an "available" figure from the target
 * alone anywhere is what let the two drift apart.
 *
 * For "Unallocated" it stays the leftover between the allocation and the
 * denominator — nothing has been spent from a pool that was never assigned.
 */
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
  const line = input.lines.find((l) => l.id === source.id);
  return line ? Math.max(0, round2(line.target - line.spentMTD)) : 0;
}

/**
 * Plan a redistribution (§8, AC 9). CONSERVES the total: every destination gains
 * its amount and a campaign source loses their sum, so the account (or the
 * filtered subset) ends where it started. An "Unallocated" source consumes the
 * leftover instead, which is the one case where the allocated total is meant to
 * rise.
 *
 * Locked lines are excluded as both source and destination (§4) — a carve-out
 * that automated redistribution can still empty isn't a carve-out. Reserved
 * lines are excluded for a different reason (§12): the money is committed to a
 * campaign that cannot spend it yet, so taking it away breaks a promise and
 * adding to it piles budget onto something that still cannot spend a cent.
 *
 * Returns a preview rather than mutating: source and each destination, target
 * before → after, and the new recommended daily. Committing is the caller's move.
 */
export function planMove(input: MovePlanInput): MovePlan {
  const byId = new Map(input.lines.map((l) => [l.id, l]));
  const sourceSpent =
    input.source.kind === 'campaign'
      ? (byId.get(input.source.id)?.spentMTD ?? 0)
      : 0;
  const empty: MovePlan = {
    ok: false,
    error: null,
    total: 0,
    available: 0,
    sourceSpent,
    source: null,
    allocations: [],
    warnings: [],
    inputs: new Map(),
  };

  const sourceLine = input.source.kind === 'campaign' ? byId.get(input.source.id) : null;
  if (input.source.kind === 'campaign' && !sourceLine) {
    return { ...empty, error: 'Pick a source to move budget from.' };
  }
  if (sourceLine?.locked) {
    return { ...empty, error: `${sourceLine.name} is locked — unlock it to move its budget.` };
  }
  // §12 — a reserve is money already promised to a campaign that cannot spend it
  // yet. Moving it out silently breaks that commitment; moving budget IN piles
  // more onto a campaign that still cannot spend any of it.
  if (sourceLine?.reserved) {
    return {
      ...empty,
      error: `${sourceLine.name} is reserved — un-reserve it before moving its budget.`,
    };
  }

  const destinations = input.destinationIds
    .map((id) => byId.get(id))
    .filter(
      (l): l is AllocatorLine => !!l && !l.locked && !l.reserved && l.id !== sourceLine?.id,
    );
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
    // Name BOTH figures. "Brand only has $1,155.31" invites the reply "no, Brand
    // has $1,694.35" — the cap only makes sense once the spent half is visible.
    const detail = sourceLine
      ? `${sourceLine.name} has $${available.toFixed(2)} movable — the other $${sourceLine.spentMTD.toFixed(2)} of its $${sourceLine.target.toFixed(2)} target is already spent and cannot be moved.`
      : `Unallocated only has $${available.toFixed(2)} to give.`;
    return { ...empty, total, available, error: detail };
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

  // §9 soft warnings. Both are judgment calls the person may be making on
  // purpose, so they FLAG and never block — the movable cap is the only hard
  // limit. Computed here rather than in the dialog so the two entry points
  // (main table, Compare) cannot warn differently about the same move.
  const warnings: MoveWarning[] = [];
  if (sourceLine && sourceLine.currentDaily > 0 && sourceLine.flight.remaining > 0) {
    const rateAfter = source ? source.recommendedDailyAfter : 0;
    if (rateAfter < sourceLine.currentDaily * MOVE_SOURCE_PACE_WARN_RATIO) {
      const remainingAfter = Math.max(0, (source?.targetAfter ?? 0) - sourceLine.spentMTD);
      // A rate that rounds to $0.00 reads as a formatting bug rather than as
      // "you have given away effectively all of it", so say that instead.
      const rateText = rateAfter > 0 && rateAfter < 0.01 ? 'under $0.01' : `$${rateAfter.toFixed(2)}`;
      warnings.push({
        kind: 'source_below_pace',
        lineId: sourceLine.id,
        message: `Leaves ${sourceLine.name} $${remainingAfter.toFixed(2)} for ${sourceLine.flight.remaining} day${sourceLine.flight.remaining === 1 ? '' : 's'} — about ${rateText}/day, below the $${sourceLine.currentDaily.toFixed(2)}/day it is running at now. It will exhaust its budget before the flight ends unless you lower its daily too.`,
      });
    }
  }
  for (const a of allocations) {
    const line = byId.get(a.id);
    // Nothing to compare against on a campaign with no daily set (unlinked, or
    // a total-budget campaign) — silence beats a jump warning off a zero base.
    if (!line || line.currentDaily <= 0) continue;
    if (a.recommendedDailyAfter > line.currentDaily * MOVE_DEST_JUMP_WARN_RATIO) {
      warnings.push({
        kind: 'destination_daily_jump',
        lineId: a.id,
        message: `${a.name} jumps from $${line.currentDaily.toFixed(2)}/day to $${a.recommendedDailyAfter.toFixed(2)}/day. Google can spend up to 2× the daily on a strong day, so this lands harder and faster than the even-pace figure suggests.`,
      });
    }
  }

  return {
    ok: true,
    error: null,
    total,
    available,
    sourceSpent,
    source,
    allocations,
    warnings,
    inputs,
  };
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

// ── §5 recent-pace projection ──

export interface RecentPace {
  /** Average daily spend over the window, or null when there isn't enough
   *  history to state one. Null is the point of this type — see below. */
  avgDaily: number | null;
  /** Days that went into the average (the divisor actually used). */
  days: number;
  /** Leading zero-spend days dropped before averaging. */
  rampDaysSkipped: number;
}

/**
 * What the campaign has actually been spending per day lately (§5).
 *
 * Three rules, each there because of a specific way this number lies:
 *
 *  1. **Leading zero-spend days are dropped.** A campaign live on paper from the
 *     1st but not delivering until the 4th would otherwise average three zeros
 *     into its run-rate and project a permanent underspend that never existed.
 *     Only LEADING zeros go: a zero day mid-flight is real delivery information
 *     and stays in the divisor.
 *  2. **The window is the last few finalized days**, not the whole flight. The
 *     question is where this lands if it keeps behaving as it has, and a
 *     month-long average buries a change of behaviour a week ago.
 *  3. **Below the floor there is no answer.** With one or two spending days, a
 *     single busy day sets the projection for the rest of the month. Returning
 *     null makes the caller render "—"; returning a number would dress that
 *     noise up as a forecast. This is what keeps a brand-new or reserved
 *     campaign from showing a run-rate at all.
 *
 * Takes an already flight-clamped, finalized series (no today, no prior month) —
 * the panel's chart series exactly.
 */
export function recentPace(
  series: readonly { date: string; spend: number }[],
  windowDays: number = GOOGLE_RECENT_PACE_WINDOW_DAYS,
  minDays: number = GOOGLE_RECENT_PACE_MIN_DAYS,
): RecentPace {
  let start = 0;
  while (start < series.length && (Number(series[start]?.spend) || 0) <= 0) start++;
  const live = series.slice(start);
  const window = live.slice(-Math.max(1, windowDays));
  const spending = window.filter((p) => (Number(p.spend) || 0) > 0).length;
  if (window.length === 0 || spending < minDays) {
    return { avgDaily: null, days: window.length, rampDaysSkipped: start };
  }
  const total = window.reduce((s, p) => s + (Number(p.spend) || 0), 0);
  // Divide by the window's real LENGTH, not the days requested — a campaign with
  // four days of history must not read as half-pace because we asked for seven.
  return {
    avgDaily: round2(total / window.length),
    days: window.length,
    rampDaysSkipped: start,
  };
}

/**
 * Where the month lands if the campaign keeps spending at `avgDaily` (§5).
 * Null in, null out: no run-rate means no projection, never a bare spent-MTD
 * figure masquerading as a forecast.
 *
 * A straight line, deliberately. Google's daily is an average it paces against
 * its own monthly limit and can spend up to 2× of on any one day, so this is a
 * what-if, not a prediction of Google's behaviour — the label has to say so.
 */
export function projectAtDaily(
  spentMTD: number,
  avgDaily: number | null,
  remainingDays: number,
): number | null {
  if (avgDaily == null) return null;
  return round2(spentMTD + avgDaily * Math.max(0, remainingDays));
}

// ── §7 delivery health verdict ──

/**
 * Where the month lands at a daily budget someone is TYPING (addendum §2.5), and
 * the most Google could bill at it.
 *
 * Google is not Meta here. A straight daily × days-left projection is right on
 * Meta, where the budget is what the campaign spends; on Google a campaign that
 * is only filling half its daily will not suddenly fill a bigger one, so the
 * straight line would climb with every keystroke and re-introduce exactly the
 * overpacing fantasy this card removed. So the projection is held under what the
 * campaign is actually delivering:
 *
 *     min( spent + recentAvgDaily × daysLeft , spent + typedDaily × daysLeft )
 *
 * Raising the daily past current delivery therefore holds the projection still
 * (delivery is the binding constraint) while the billing ceiling above it rises
 * to show the new headroom; lowering it below current delivery drops the
 * projection, because the budget is now what caps it. `boundBy` says which of
 * the two is binding, so the readout can name the reason rather than leaving a
 * number that refuses to move looking broken.
 *
 * `recentAvgDaily` is the finalized delivery average the delivery verdict
 * already computes from the synced series — no extra read, and the two surfaces
 * cannot disagree.
 */
export interface TypedDailyProjection {
  projected: number;
  boundBy: 'delivery' | 'budget' | 'ceiling';
  /** Google's monthly spending limit for the month if this rate is set now. */
  billingCeiling: number;
  /** The limit as things stand, so the readout can show what a push moves it
   *  from and to. */
  billingCeilingBefore: number;
}

/**
 * Google's MONTHLY SPENDING LIMIT for a rate that has been in effect all month:
 * the average daily budget × 30.4. This is the figure Google quotes when a
 * budget is set and left alone, and it is only correct in that case — the moment
 * the rate changes mid-month, use `monthlyLimitAfterChange`.
 */
export function monthlyLimitFlat(daily: number): number {
  return round2(Math.max(0, daily) * MONTH_DAYS_MULTIPLIER);
}

/**
 * Google's monthly spending limit AFTER a mid-month budget change, stated
 * exactly as Google states it:
 *
 *     spend so far + (new average daily budget × remaining calendar days)
 *
 * Google's own worked example, which this function reproduces: November (30
 * days), $5/day set on the 1st for a $152.00 limit ($5 × 30.4). On the 24th the
 * campaign has spent $103 and the daily is raised to $10. Seven calendar days
 * remain (the 24th through the 30th), so the most November can be charged is
 * $103 + ($10 × 7) = $173.00 — NOT $10 × 30.4, and not a blend of the two rates
 * across the month either. It applies to ad-schedule campaigns as well.
 *
 * Two earlier versions of this were wrong in ways worth naming, because both
 * look plausible:
 *
 *  - `newDaily × 30.4` treats a rate set on the 24th as though it had bought
 *    30.4 days of itself. On a CUT it under-states the limit badly (the money
 *    already spent does not disappear), which is how the edit box came to print
 *    a monthly projection ABOVE the ceiling printed directly beneath it.
 *  - A calendar-day-weighted average of the old and new rates × 30.4 is closer
 *    but still not Google's rule: it re-prices the days already gone at the old
 *    rate rather than using what those days ACTUALLY cost. In Google's example
 *    it yields $187.47 against the documented $173.00.
 *
 * `remainingCalendarDays` counts from the change forward INCLUSIVE of the day
 * the change is made, matching the example's seven days for a change made on
 * the 24th of a 30-day month; `spentToDate` is therefore spend through the day
 * before it.
 */
export function monthlyLimitAfterChange(input: {
  spentToDate: number;
  newDaily: number;
  remainingCalendarDays: number;
}): number {
  return round2(
    Math.max(0, input.spentToDate) +
      Math.max(0, input.newDaily) * Math.max(0, input.remainingCalendarDays),
  );
}

export function projectAtTypedDaily(input: {
  spentMTD: number;
  recentAvgDaily: number | null;
  typedDaily: number;
  /** Flight days left — what the campaign can actually spend over. */
  remainingDays: number;
  /** The rate already set, for the "as it stands" limit. */
  currentDaily?: number;
  /**
   * Calendar days left in the MONTH, which is what Google's limit counts.
   * Never the flight: a campaign that ends on the 20th stops spending then, but
   * Google's limit for the month is still computed over the whole month.
   * Defaults to the flight's remaining days, which is the full-month case.
   */
  remainingCalendarDays?: number;
}): TypedDailyProjection {
  const days = Math.max(0, input.remainingDays);
  const daily = Math.max(0, input.typedDaily);
  const currentDaily = input.currentDaily ?? daily;
  const calendarDays = Math.max(0, input.remainingCalendarDays ?? days);

  // As it stands: the standing rate, untouched, limits the month to rate × 30.4
  // — floored at what has already been charged, because a monthly limit cannot
  // sit below the money the month has already billed. (When it would, our daily
  // figure is stale, not Google's limit.)
  const billingCeilingBefore = Math.max(
    round2(input.spentMTD),
    monthlyLimitFlat(currentDaily),
  );
  // Only an actual CHANGE re-bases the limit. Typing the rate that is already
  // set is not a change, and must leave the month's limit exactly where it is.
  const billingCeiling = moneyEq(daily, currentDaily)
    ? billingCeilingBefore
    : monthlyLimitAfterChange({
        spentToDate: input.spentMTD,
        newDaily: daily,
        remainingCalendarDays: calendarDays,
      });

  const atBudget = input.spentMTD + daily * days;
  // The limit is a real cap — Google will not bill past it whatever the
  // campaign would otherwise spend. It only binds when the flight is shorter
  // than the month, since over a full month it IS the budget line.
  const candidates: [number, TypedDailyProjection['boundBy']][] = [
    [atBudget, 'budget'],
    [billingCeiling, 'ceiling'],
  ];
  // No usable run rate — a brand-new campaign, or one with a day or two of
  // history. There is no delivery figure to hold the projection under, so only
  // the budget and the limit bound it, and `boundBy` says which.
  if (input.recentAvgDaily != null) {
    candidates.push([input.spentMTD + input.recentAvgDaily * days, 'delivery']);
  }
  const [projected, boundBy] = candidates.reduce((lowest, c) =>
    c[0] < lowest[0] ? c : lowest,
  );
  return {
    projected: round2(Math.max(input.spentMTD, projected)),
    boundBy,
    billingCeiling,
    billingCeilingBefore,
  };
}

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
  else if (ratio >= GOOGLE_AT_CAP_RATIO)
    kind = paceStatus === 'over' ? 'at_cap_ahead' : 'at_cap';
  else if (ratio >= 0.5) kind = 'room';
  else kind = 'underdelivering';
  return { kind, ratio, avgDaily, windowSpend, cap };
}

// ── §8 push plan ──

export type PushSkipReason =
  | 'reserved'
  | 'not_linked'
  | 'total_budget'
  | 'shared_budget'
  | 'no_target'
  | 'below_threshold';

/**
 * Can this ONE campaign be applied on its own (§14)?
 *
 * Same structural rules as the batch — reserved, unlinked, total-budget, shared,
 * no target — with the drift threshold deliberately absent. The threshold exists
 * to keep trivial edits out of a batch nobody inspected line by line; a person
 * who clicked apply on one named campaign has already made that judgment, and
 * silently doing nothing in response to a deliberate click is worse than the
 * pointless edit the gate was protecting against.
 *
 * `null` reason = it can be applied.
 */
export function applyEligibility(
  line: AllocatorLine,
  budgetResourceName: string | null | undefined,
): { ok: boolean; reason: Exclude<PushSkipReason, 'below_threshold'> | null } {
  if (line.reserved) return { ok: false, reason: 'reserved' };
  if (!line.dailyControllable) return { ok: false, reason: 'total_budget' };
  if (line.shared) return { ok: false, reason: 'shared_budget' };
  if (!budgetResourceName) return { ok: false, reason: 'not_linked' };
  if (line.target <= 0) return { ok: false, reason: 'no_target' };
  return { ok: true, reason: null };
}

/** Plain-language reason an apply control is unavailable. Shown ON the disabled
 *  control (§14): a control that is dead with no stated reason reads as broken,
 *  and the reason is usually the actual next action ("set it in Google"). */
export function applyBlockedReason(
  reason: Exclude<PushSkipReason, 'below_threshold'>,
): string {
  switch (reason) {
    case 'reserved':
      return 'Reserved — out of pacing, so there is no daily to push.';
    case 'total_budget':
      return 'Total-budget campaign — Google paces it to its own end date, so there is no daily rate to set.';
    case 'shared_budget':
      return 'Shared budget, set in Google — several campaigns point at this budget, so a per-campaign daily does not exist.';
    case 'not_linked':
      return 'Not linked to a Google campaign budget yet — import or sync it first.';
    case 'no_target':
      return 'No monthly target allocated, so there is nothing to pace to.';
  }
}

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
 *    smart bidding its learning for nothing;
 *  - RESERVED lines (§12): there is no daily to push at a campaign that has not
 *    been built or linked yet, and it is out of pacing anyway.
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
    // §12 — reserved before total_budget, because `dailyControllable` is false
    // for both and "total budget" would be the wrong reason to show.
    if (line.reserved) {
      skipped.push({ ...base, reason: 'reserved' });
      continue;
    }
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
