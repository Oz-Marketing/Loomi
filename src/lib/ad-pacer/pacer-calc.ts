/**
 * Pacing math for the Ad Pacer page. `buildPacerCalc` is the canonical
 * source of truth; `buildAdCalc` (used by the Summary table) delegates to
 * it so both views always show the same numbers for the same ad.
 */

import { calcDays, calcElapsed, num } from './helpers';
import { ACTIVE_STATUSES, CROSS_MONTH_IN_MONTH_THRESHOLD } from './constants';
import {
  fractionalDaysRemaining,
  monthBoundsIso,
  zonedTodayIso,
} from '@/lib/timezone';
import type { PacerAd, PacingStatus } from './types';

export interface PacerCalc {
  /**
   * FRACTIONAL days left until the flight's budget-reset boundary, measured
   * to the current moment in the account's timezone (e.g. 2.23, not 3). Drives
   * `recDaily`/`projected`; round only for display, never re-sum the rounded
   * value. 0 once the flight is over.
   */
  daysLeft: number;
  remaining: number;
  recDaily: number;
  projected: number;
  budget: number;
  spent: number;
  dailyBudget: number;
  hasDates: boolean;
  endsBeforeToday: boolean;
  /**
   * The flight window actually being paced: the intersection of the Meta /
   * planned schedule and the pacing month (ad.period). `effectiveEnd` is what
   * days-remaining counts down to — clamped to month-end so a multi-month
   * campaign is never paced over its whole span against one month's budget.
   */
  effectiveStart: string | null;
  effectiveEnd: string | null;
  /**
   * Lifetime-only: spend pacing relative to elapsed flight time. 100 = on
   * track, >100 = overpacing, <100 = underpacing. null when we can't
   * compute (no budget, no flight start, or period hasn't started).
   */
  lifetimePacingPct: number | null;
}

/**
 * Pacing math for one ad. `nowMs` is the absolute current instant (epoch ms,
 * timezone-independent) and `timeZone` is the ad account's IANA zone — Meta
 * resets the daily budget at midnight there, so that's the boundary that
 * decides how much of today is still controllable. The flight end always
 * comes from `ad.flightEnd` (the per-ad today/end cursors are retired).
 */
export function buildPacerCalc(
  ad: PacerAd,
  nowMs: number,
  timeZone: string,
): PacerCalc {
  const isLifetime = ad.budgetType === 'Lifetime';
  // §2: honor a resolved cross-month straddler — the assigned month uses the
  // full run + full target; the default is the month-bounded slice (unchanged).
  const budget = effectiveTarget(ad);
  const spent = effectiveActual(ad);
  // Lifetime ads don't have a daily-rate column — projection collapses to
  // whatever's been spent rather than extrapolating with a phantom rate.
  const dailyBudget = isLifetime ? 0 : num(ad.pacerDailyBudget) ?? 0;

  // Effective flight window = (Meta / planned schedule) ∩ (pacing month).
  // Meta's actual dates win over the planner's when present; clamping to the
  // month is the multi-month guard. YYYY-MM-DD strings compare chronologically
  // so min/max are plain `<`/`>`. A no-end campaign (metaEndDate null,
  // flightEnd null) paces to month-end.
  const { effectiveStart, effectiveEnd } = clampToMonth(ad);
  const endIso = effectiveEnd;
  const hasDates = !!endIso;
  // Fraction of the flight still ahead of us, in the account TZ. A flight
  // ending today still has the rest of today left (a fraction < 1), so the
  // tool no longer treats a nearly-over day as a full controllable day.
  const rawDaysLeft = fractionalDaysRemaining(endIso, nowMs, timeZone);
  const endsBeforeToday = rawDaysLeft != null && rawDaysLeft <= 0;
  const daysLeft = rawDaysLeft != null && rawDaysLeft > 0 ? rawDaysLeft : 0;

  const remaining = Math.max(0, budget - spent);
  // Recommended daily is a per-calendar-day budget, so never divide by less
  // than one whole day. Otherwise the last hours/minutes of a flight
  // (daysLeft → 0) blow the recommendation up to absurd values — e.g. $316
  // remaining ÷ 0.0056 days ≈ $56,752/day. Flooring the divisor at 1 caps it
  // at "spend the rest in the final day", the largest sensible daily; days ≥ 1
  // keep their fractional precision.
  const recDaily = daysLeft > 0 ? remaining / Math.max(daysLeft, 1) : 0;
  // Projection of *actual* spend keeps the true fractional days — it's a
  // forecast, not a budget you type into Meta, so the partial day is correct.
  const projected = spent + dailyBudget * daysLeft;

  // Lifetime pacing %: spent / (budget × daysElapsed / totalDays). Uses the
  // month-clamped window so a campaign extending past the month is paced only
  // over the part that falls in the budget's month, and anchors "today" to the
  // account-zone calendar so elapsed days match the budget-reset clock.
  let lifetimePacingPct: number | null = null;
  if (isLifetime && budget > 0 && hasDates) {
    const todayIso = zonedTodayIso(nowMs, timeZone);
    const start = effectiveStart
      ? new Date(effectiveStart + 'T00:00:00')
      : null;
    const end = endIso ? new Date(endIso + 'T00:00:00') : null;
    const today = new Date(todayIso + 'T00:00:00');
    if (start && end) {
      const totalDays =
        Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
      const daysElapsed = Math.min(
        totalDays,
        Math.max(
          0,
          Math.round((today.getTime() - start.getTime()) / 86400000) + 1,
        ),
      );
      if (totalDays > 0 && daysElapsed > 0) {
        const expected = budget * (daysElapsed / totalDays);
        if (expected > 0) lifetimePacingPct = (spent / expected) * 100;
      }
    }
  }

  return {
    daysLeft,
    remaining,
    recDaily,
    projected,
    budget,
    spent,
    dailyBudget,
    hasDates,
    endsBeforeToday,
    effectiveStart,
    effectiveEnd,
    lifetimePacingPct,
  };
}

/**
 * Intersect an ad's run schedule with its pacing month (`ad.period`):
 *   effective_start = max(metaStartDate ?? liveDate ?? flightStart, month_start)
 *   effective_end   = min(metaEndDate   ?? flightEnd,               month_end)
 * Meta's actual dates take precedence over the planner's. Clamping to the
 * month keeps a multi-month campaign scoped to a single month's budget, and a
 * late launch (metaStartDate after month_start) naturally shrinks the window
 * without any budget pro-rating. Returns the raw schedule unclamped if the
 * period is malformed (shouldn't happen for a real pacer row).
 */
/**
 * The minimal ad shape the schedule/eligibility helpers read — satisfied by
 * BOTH the client `PacerAd` and the server's Prisma ad row, so these helpers
 * run on either side. (`budgetType`/dates are loose strings to match the DB row.)
 */
export type AdScheduleLike = {
  adStatus: string;
  budgetType: string;
  period: string;
  metaStartDate: string | null;
  liveDate: string | null;
  flightStart: string | null;
  metaEndDate: string | null;
  flightEnd: string | null;
};

export function clampToMonth(ad: AdScheduleLike): {
  effectiveStart: string | null;
  effectiveEnd: string | null;
} {
  const rawStart = ad.metaStartDate ?? ad.liveDate ?? ad.flightStart;
  const bounds = ad.period ? monthBoundsIso(ad.period) : null;
  // Meta's end normally wins over the planner's, BUT a Meta end that falls
  // before this pacing month is stale — e.g. a recurring ad whose linked ad set
  // still carries a PRIOR run's end date. Honoring it would mark the month
  // "completed" even after the planner flight was extended into the month, so in
  // that case defer to the planner's flightEnd (the user's forward intent).
  const metaEndStale =
    bounds != null && ad.metaEndDate != null && ad.metaEndDate < bounds.start;
  const rawEnd = metaEndStale ? ad.flightEnd : (ad.metaEndDate ?? ad.flightEnd);
  if (!bounds) return { effectiveStart: rawStart, effectiveEnd: rawEnd };
  return {
    // max(rawStart, month_start) — never start before the month opens.
    effectiveStart:
      rawStart && rawStart > bounds.start ? rawStart : bounds.start,
    // min(rawEnd, month_end) — never pace past the month's budget window.
    effectiveEnd: rawEnd && rawEnd < bounds.end ? rawEnd : bounds.end,
  };
}

/**
 * §0.2 — does this ad participate in LIVE account pacing? Only live, started,
 * daily ads count toward the account pace ratio. Ineligible ads still render
 * their own row state; they just don't move the account number. Excluded:
 *   - non-active statuses (Scheduled / Waiting on Rep / In Draft / Off /
 *     Completed Run …) — only the delivering statuses pace;
 *   - lifetime ads — their single variance is booked once on completion into
 *     the over/under (§3), never paced day-to-day;
 *   - not-yet-started flights (effectiveStart > asOf).
 * Cross-month ads are NOT auto-excluded: §7 per-flight proration already paces a
 * mid-flight ad on its own window, and cross-month accounting is a manual choice
 * now. This is the shared predicate §7 / §8 build on.
 */
export function isEligibleForLivePacing(
  ad: AdScheduleLike & {
    allocation?: string | null;
    pacerActual?: string | null;
    fullRunAppliedToMonth?: string | null;
  },
  nowMs: number,
  timeZone: string,
): boolean {
  if (!ACTIVE_STATUSES.includes(ad.adStatus)) return false; // status == Live
  if (ad.budgetType === 'Lifetime') return false; // NOT (lifetime in-progress)
  const { effectiveStart } = clampToMonth(ad);
  if (!effectiveStart) return false;
  return effectiveStart <= zonedTodayIso(nowMs, timeZone); // flightStart <= asOf
}

/**
 * §3 — is this a LIFETIME ad still running (in progress)? Such an ad is
 * EXCLUDED from a month's over/under base entirely (both its actual slice and
 * its allocation are removed → $0 variance contribution) while it runs; it
 * still counts toward the honest "total month spend". When it completes
 * (status leaves ACTIVE_STATUSES, e.g. "Completed Run") it re-enters the base
 * and its single variance (pacerActual − allocation) books once — which for a
 * single-period ad equals fullRunActual − fullLifetimeTarget per the spec.
 * Multi-month lifetime ads are handled later by §1/§2 (cross-month split).
 * This is the ONE predicate every over/under-base sum + the badge consult.
 */
export function isLifetimeInProgress(
  ad: AdScheduleLike,
  nowMs: number,
  timeZone: string,
): boolean {
  if (ad.budgetType !== 'Lifetime') return false;
  if (!ACTIVE_STATUSES.includes(ad.adStatus)) return false; // completed/off books normally
  const { effectiveStart } = clampToMonth(ad);
  if (!effectiveStart) return false;
  return effectiveStart <= zonedTodayIso(nowMs, timeZone); // has started
}

/**
 * §1 — is this a cross-month STRADDLER: a (daily) ad whose flight crosses a
 * calendar-month boundary AND whose in-month slice is materially below the
 * full-run target, so the raw in-month variance looks alarming but is just a
 * scope artifact. Such an ad is excluded from the account pacing badge (via
 * isEligibleForLivePacing) and its row is contextualized with the full-run
 * verdict. Lifetime ads are owned by §3 (over/under exclusion) + §2b (split),
 * so they are NOT flagged here. (§2 will additionally skip ads already resolved
 * via fullRunAppliedToMonth/split — those fields don't exist yet.)
 */
export function isCrossMonthStraddler(
  ad: AdScheduleLike & {
    allocation?: string | null;
    pacerActual?: string | null;
    fullRunAppliedToMonth?: string | null;
  },
): boolean {
  if (ad.fullRunAppliedToMonth != null) return false; // §2: resolved — no longer a straddler
  if (ad.budgetType === 'Lifetime') return false;
  // Detection is on the PLANNED flight window (flightStart/flightEnd first) —
  // the user's basis — so a cross-month ad is recognized from the plan, even
  // before Meta syncs and even if Meta later delivers off-plan. The per-month
  // SPEND still comes from Meta's reported numbers (pacerActual); only the
  // boundary test uses the plan. Raw dates (NOT clampToMonth, which collapses
  // both ends into the period and could never expose a boundary).
  const start = ad.flightStart ?? ad.metaStartDate ?? ad.liveDate;
  const end = ad.flightEnd ?? ad.metaEndDate;
  if (!start || !end) return false;
  if (start.slice(0, 7) === end.slice(0, 7)) return false; // single calendar month
  const inMonth = num(ad.pacerActual) ?? 0;
  const target = num(ad.allocation) ?? 0;
  if (target <= 0) return false;
  // Materially below: in-month slice is short of the full-run target by more
  // than the threshold gap (a near-complete in-month flight won't trip it).
  return inMonth < target * CROSS_MONTH_IN_MONTH_THRESHOLD;
}

/** Loose money/period shape for the §2 effective-actual/target helpers. */
type EffectiveMoneyLike = {
  period: string;
  allocation?: string | null;
  pacerActual?: string | null;
  pacerRunSpend?: string | null;
  fullRunAppliedToMonth?: string | null;
};

/**
 * §2 — the ONE actual a surface should use for a month, honoring a resolved
 * cross-month straddler (§2a, "count full run in [month]"). Default = the
 * month-bounded slice (pacerActual), unchanged. When fullRunAppliedToMonth is
 * set: the ASSIGNED month uses the full run (pacerRunSpend, falling back to
 * pacerActual); any OTHER month the flight touched contributes 0. §2b split is
 * display-only and never changes this. Pure + string-tolerant so server Prisma
 * rows and the client PacerAd both pass. Routing every variance/total/pacing
 * sum through this pair keeps §0.3 (count once) and §0.4 (surfaces agree).
 */
export function effectiveActual(ad: EffectiveMoneyLike, asMonth?: string): number {
  const month = asMonth ?? ad.period;
  if (ad.fullRunAppliedToMonth != null) {
    return ad.fullRunAppliedToMonth === month
      ? (num(ad.pacerRunSpend) ?? num(ad.pacerActual) ?? 0)
      : 0;
  }
  return num(ad.pacerActual) ?? 0;
}

/**
 * §2 — the ONE target for a month, mirroring effectiveActual: the full
 * allocation in the assigned month, 0 in any other month it touched, else the
 * month-bounded allocation.
 */
export function effectiveTarget(ad: EffectiveMoneyLike, asMonth?: string): number {
  const month = asMonth ?? ad.period;
  if (ad.fullRunAppliedToMonth != null) {
    return ad.fullRunAppliedToMonth === month ? (num(ad.allocation) ?? 0) : 0;
  }
  return num(ad.allocation) ?? 0;
}

/** Why an ad's over/under may differ from what actually spent THIS month. No
 *  auto-detection — the cross-month treatment is the user's manual choice
 *  (fullRunAppliedToMonth), or the §3 lifetime mechanic. */
export type VarianceClass = 'real' | 'billed-cross-month' | 'lifetime-in-progress';

export type VarianceAdLike = AdScheduleLike & {
  allocation?: string | null;
  pacerActual?: string | null;
  pacerRunSpend?: string | null;
  fullRunAppliedToMonth?: string | null;
};

export interface AdVariance {
  /** What actually spent THIS calendar month (the slice, pacerActual) — feeds
   *  the honest month total-spend. */
  inMonthSpend: number;
  /** What the over/under is billed on: the full run when the user billed this ad
   *  in this month (fullRunAppliedToMonth), else the in-month slice; 0 for an
   *  in-progress lifetime ad (§3, books on completion). */
  billedActual: number;
  /** billedActual − effectiveTarget — this ad's over/under contribution. */
  contribution: number;
  klass: VarianceClass;
  /** Where this ad's variance settles. true = at THIS month's close (a normal
   *  ad, a billed-this-month ad, or a single-month lifetime ad whose flight ends
   *  in the month). false = DEFERRED to a future month (a cross-month lifetime
   *  run whose flight extends past the month — Prompt 2: only these are "settles
   *  later"; a single-month lifetime ad is never deferred). */
  settlesThisMonth: boolean;
}

/**
 * For a lifetime ad: does its run settle at THIS month's close (its flight ends
 * within the pacing month) vs deferred to a future month (its flight extends
 * past it — a cross-month run)? Prompt 2: a single-month lifetime ad settles at
 * month-end like everything else and is never deferred; only a cross-month run
 * leaves the month. An open-ended run (no end date) is treated as settling this
 * month rather than deferring indefinitely. Non-lifetime ads aren't asked this.
 */
export function lifetimeSettlesThisMonth(
  ad: AdScheduleLike,
  asMonth: string,
): boolean {
  // Resolve the run's real end the same way clampToMonth does — including its
  // stale-metaEndDate guard: a Meta end BEFORE this month is stale (a recurring
  // ad set still carrying a prior run's stop date), so defer to the planner's
  // flightEnd (the forward intent). Without this, a genuine cross-month run with
  // a stale Meta end would be misread as "ends this month". Compare the UNCLAMPED
  // end month (clampToMonth's effectiveEnd is capped at month-end, which would
  // hide the "extends past the month" signal we need here).
  const bounds = monthBoundsIso(asMonth);
  const metaEndStale =
    bounds != null && ad.metaEndDate != null && ad.metaEndDate < bounds.start;
  const rawEnd = metaEndStale ? ad.flightEnd : ad.metaEndDate ?? ad.flightEnd;
  const endMonth = rawEnd?.slice(0, 7) ?? null;
  return endMonth == null ? true : endMonth <= asMonth;
}

/**
 * Classify ONE ad for a month, producing the split the UI needs: inMonthSpend
 * (what spent this calendar month → the month total) vs billedActual (what the
 * over/under counts). They differ only when the ad is deliberately billed
 * cross-month or is a running lifetime ad:
 *   - lifetime-in-progress: still running — $0 in the over/under now (§3); its
 *     in-month spend is held out until the run completes.
 *   - billed-cross-month: the user chose "Bill in one month" and the full run
 *     differs from this month's slice — the over/under counts the full run; the
 *     difference spent in another month.
 *   - real: everything else — billed equals the slice, all spent this month.
 * No date-based auto-detection; cross-month is the user's explicit choice.
 */
export function classifyAdVariance(
  ad: VarianceAdLike,
  asMonth: string,
  nowMs: number,
  timeZone: string,
): AdVariance {
  const inMonthSpend = num(ad.pacerActual) ?? 0;
  if (isLifetimeInProgress(ad, nowMs, timeZone)) {
    return {
      inMonthSpend,
      billedActual: 0,
      contribution: 0,
      klass: 'lifetime-in-progress',
      // Only a cross-month run (flight past this month) is deferred; a
      // single-month lifetime ad settles at this month's close (Prompt 2).
      settlesThisMonth: lifetimeSettlesThisMonth(ad, asMonth),
    };
  }
  const billedActual = effectiveActual(ad, asMonth);
  const contribution = billedActual - effectiveTarget(ad, asMonth);
  const klass: VarianceClass =
    ad.fullRunAppliedToMonth != null && Math.abs(billedActual - inMonthSpend) >= 0.005
      ? 'billed-cross-month'
      : 'real';
  return { inMonthSpend, billedActual, contribution, klass, settlesThisMonth: true };
}

export interface MonthVarianceBreakdown {
  /** Σ inMonthSpend (all ads) — what actually spent this calendar month. */
  totalInMonth: number;
  /** Σ billedActual — the actual basis the over/under is measured on. */
  overUnderActual: number;
  /** Σ (billedActual − inMonthSpend) over billed-cross-month ads — billed in
   *  this month though it spent in another (explains total ≠ over/under basis). */
  billedElsewhere: number;
  /** Σ inMonthSpend over in-progress lifetime ads — spent this month but not yet
   *  in the over/under (books on completion). */
  heldOutLifetime: number;
  crossMonthCount: number;
  heldOutCount: number;
  /** Of the held-out lifetime ads, how many are DEFERRED to a future month (a
   *  cross-month run). heldOutCount − this = lifetime ads settling at THIS
   *  month's close. Lets the UI label the two in-progress states distinctly. */
  heldOutDeferredCount: number;
  /** Per-ad results in input order — the caller maps back to its ad list. */
  perAd: AdVariance[];
}

/**
 * Aggregate a month's ads into the two reconciling totals — totalInMonth (what
 * spent this calendar month) and overUnderActual (what the over/under is billed
 * on) — plus the pieces that explain any gap between them: billedElsewhere
 * (cross-month-billed runs) and heldOutLifetime (running lifetime ads).
 */
export function decomposeMonthVariance(
  ads: VarianceAdLike[],
  asMonth: string,
  nowMs: number,
  timeZone: string,
): MonthVarianceBreakdown {
  let totalInMonth = 0;
  let overUnderActual = 0;
  let billedElsewhere = 0;
  let heldOutLifetime = 0;
  let crossMonthCount = 0;
  let heldOutCount = 0;
  let heldOutDeferredCount = 0;
  const perAd: AdVariance[] = [];
  for (const ad of ads) {
    const v = classifyAdVariance(ad, asMonth, nowMs, timeZone);
    perAd.push(v);
    totalInMonth += v.inMonthSpend;
    overUnderActual += v.billedActual;
    if (v.klass === 'lifetime-in-progress') {
      heldOutLifetime += v.inMonthSpend;
      heldOutCount += 1;
      if (!v.settlesThisMonth) heldOutDeferredCount += 1;
    } else if (v.klass === 'billed-cross-month') {
      billedElsewhere += v.billedActual - v.inMonthSpend;
      crossMonthCount += 1;
    }
  }
  return {
    totalInMonth,
    overUnderActual,
    billedElsewhere,
    heldOutLifetime,
    crossMonthCount,
    heldOutCount,
    heldOutDeferredCount,
    perAd,
  };
}

export interface AdCalc {
  ad: PacerAd;
  isLifetime: boolean;
  effectiveStart: string | null;
  days: number;
  daysElapsed: number;
  isLate: boolean;
  daysLate: number;
  allocation: number;
  dailyBudget: number | null;
  totalBudget: number;
  projected: number;
  impliedDaily: number | null;
  actual: number | null;
  target: number | null;
  recDaily: number | null;
  delta: number | null;
  expectedToDate: number;
  pacingPct: number | null;
  status: PacingStatus;
}

/**
 * Computes the AdCalc snapshot used by the Summary tab. Numbers come from
 * `buildPacerCalc()` (same `nowMs` + account `timeZone`), so the Summary and
 * Pacer views always show the same projection, remaining, and recommended
 * daily figures for a given ad.
 */
export function buildAdCalc(
  ad: PacerAd,
  nowMs: number,
  timeZone: string,
): AdCalc {
  const isLifetime = ad.budgetType === 'Lifetime';
  // Month-clamped window (same as buildPacerCalc) so the Summary's day counts,
  // implied daily, and expected-to-date stay scoped to the pacing month.
  const { effectiveStart, effectiveEnd } = clampToMonth(ad);
  const days = calcDays(effectiveStart, effectiveEnd);
  const daysElapsed = calcElapsed(effectiveStart, effectiveEnd);
  const isLate = !!(
    ad.liveDate &&
    ad.flightStart &&
    ad.liveDate > ad.flightStart
  );
  const daysLate = isLate ? calcDays(ad.flightStart, ad.liveDate) - 1 : 0;

  const pacer = buildPacerCalc(ad, nowMs, timeZone);

  const allocation = pacer.budget;
  const dailyBudget = isLifetime ? null : num(ad.pacerDailyBudget);
  const totalBudget = isLifetime ? allocation : dailyBudget ?? 0;
  const projected = pacer.projected;
  const impliedDaily = isLifetime && days > 0 ? allocation / days : null;
  // §2: a resolved straddler counts its full run; otherwise the month-bounded
  // actual (null preserved so a no-spend ad still reads "no data").
  const actual =
    ad.fullRunAppliedToMonth != null ? effectiveActual(ad) : num(ad.pacerActual);
  const target = allocation > 0 ? allocation : null;
  const recDaily =
    pacer.daysLeft > 0 && pacer.budget > 0 ? pacer.recDaily : null;
  const delta =
    !isLifetime && recDaily != null && dailyBudget != null
      ? recDaily - dailyBudget
      : isLifetime && target != null
        ? target - allocation
        : null;

  const expectedToDate =
    isLifetime && days > 0
      ? allocation * (daysElapsed / days)
      : (dailyBudget ?? 0) * daysElapsed;

  const pacingPct = isLifetime
    ? pacer.lifetimePacingPct
    : actual != null && expectedToDate > 0
      ? (actual / expectedToDate) * 100
      : null;

  let status: PacingStatus = 'no-data';
  if (pacingPct != null) {
    status =
      pacingPct >= 90 && pacingPct <= 110
        ? 'on-track'
        : pacingPct > 110
          ? 'overpacing'
          : 'underpacing';
  }

  return {
    ad,
    isLifetime,
    effectiveStart,
    days,
    daysElapsed,
    isLate,
    daysLate,
    allocation,
    dailyBudget,
    totalBudget,
    projected,
    impliedDaily,
    actual,
    target,
    recDaily,
    delta,
    expectedToDate,
    pacingPct,
    status,
  };
}

export interface AccountPaceResult {
  pct: number; // Σ actual-to-date ÷ Σ expected-to-date × 100
  actual: number; // Σ eligible actual-to-date
  expected: number; // Σ eligible expected-to-date
  eligibleCount: number;
  status: 'on-track' | 'over' | 'under';
}

/**
 * §7 live-month account pacing rollup over §0.2-eligible ads (live, started,
 * daily — completed/lifetime/not-started/unresolved-straddler excluded). Each
 * eligible ad is prorated against its OWN flight window (never the calendar
 * month) and TOTAL SPEND is never the denominator.
 *
 * This is the SINGLE source of truth shared by the Pacer badge AND the §9 pace
 * alert, so the two can never disagree (the §0.4 standing test). Returns null
 * when nothing is eligible or there's no expected-to-date to pace against — an
 * empty/not-yet-started account is not "under", it's simply not pacing.
 */
export function computeAccountPace(
  ads: PacerAd[],
  nowMs: number,
  timeZone: string,
): AccountPaceResult | null {
  let expected = 0;
  let actual = 0;
  let eligibleCount = 0;
  for (const ad of ads) {
    if (!isEligibleForLivePacing(ad, nowMs, timeZone)) continue;
    const c = buildAdCalc(ad, nowMs, timeZone);
    if (c.target == null) continue; // un-budgeted — nothing to pace against
    expected += c.days > 0 ? c.allocation * (c.daysElapsed / c.days) : 0;
    actual += c.actual ?? 0;
    eligibleCount += 1;
  }
  if (expected <= 0) return null;
  const pct = (actual / expected) * 100;
  const status =
    pct >= 90 && pct <= 110 ? 'on-track' : pct > 110 ? 'over' : 'under';
  return { pct, actual, expected, eligibleCount, status };
}

export interface BudgetBurnSample {
  adId: string;
  adName: string;
  burnPct: number; // actual ÷ allocation × 100
  allocation: number;
  daysLeft: number; // whole flight-days remaining this month
}

/**
 * §9 per-campaign budget-burn samples over §0.2-eligible, budgeted ads: how much
 * of the month's allocation is already spent and how many flight-days remain.
 * The engine fires "budget burned early" when burnPct ≥ a threshold AND daysLeft
 * exceeds the rule's minDaysLeft — i.e. the budget is running out well before the
 * flight does. Lifetime / cross-month / not-started ads are excluded by the same
 * eligibility predicate as the pacing badge.
 */
export function computeBudgetBurnSamples(
  ads: PacerAd[],
  nowMs: number,
  timeZone: string,
): BudgetBurnSample[] {
  const out: BudgetBurnSample[] = [];
  for (const ad of ads) {
    if (!isEligibleForLivePacing(ad, nowMs, timeZone)) continue;
    const c = buildAdCalc(ad, nowMs, timeZone);
    if (c.allocation <= 0 || c.actual == null) continue;
    out.push({
      adId: ad.id,
      adName: ad.name,
      burnPct: (c.actual / c.allocation) * 100,
      allocation: c.allocation,
      daysLeft: Math.max(0, c.days - c.daysElapsed),
    });
  }
  return out;
}

/**
 * Allocation distribution for the Budget Calculator modal: spreads a total
 * across a set of ads using per-ad mode specs. "even" rows split the
 * leftover; "amount" and "percent" rows are locked.
 */
export type AllocationMode = 'even' | 'amount' | 'percent';

export interface AdAllocSpec {
  mode: AllocationMode;
  amount: string;
  percent: string;
}

export function computeAllocations(
  ads: PacerAd[],
  totalBudget: number,
  specs: Record<string, AdAllocSpec>,
): Record<string, number> {
  const out: Record<string, number> = {};
  let locked = 0;
  let evenCount = 0;
  for (const ad of ads) {
    const spec = specs[ad.id] ?? { mode: 'even', amount: '', percent: '' };
    if (spec.mode === 'amount') {
      const v = num(spec.amount) ?? 0;
      out[ad.id] = v;
      locked += v;
    } else if (spec.mode === 'percent') {
      const pct = num(spec.percent) ?? 0;
      const v = (totalBudget * pct) / 100;
      out[ad.id] = v;
      locked += v;
    } else {
      evenCount++;
    }
  }
  const remainder = Math.max(0, totalBudget - locked);
  const perEven = evenCount > 0 ? remainder / evenCount : 0;
  for (const ad of ads) {
    const spec = specs[ad.id] ?? { mode: 'even', amount: '', percent: '' };
    if (spec.mode === 'even') out[ad.id] = perEven;
  }
  return out;
}
