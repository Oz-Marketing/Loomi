// §8 — pure Google-specific pacer logic. No API, no DB, no React: channel-group
// mapping, budget-type mapping, the channel rollup, the account daily-set-vs-
// needed roll-up, and import reconciliation. Everything channel-agnostic (the
// per-line pacing math, eligibility, cross-month, over/under) is REUSED from
// pacer-calc — this file only adds what's Google-specific, and is unit-tested
// against mock data so it's correct before the live API is ever connected.

import { num } from './helpers';
import type { PacerAd } from './types';
import {
  buildAdCalc,
  buildPacerCalc,
  isEligibleForLivePacing,
  isLifetimeInProgress,
} from './pacer-calc';
import { MONTH_DAYS_MULTIPLIER } from './constants';
import {
  buildGoogleRecommendation,
  type GoogleRecommendation,
} from './pacing-engine';
import { monthBoundsIso, zonedMidnightMs } from '@/lib/timezone';

export type GoogleChannelGroup =
  | 'Search'
  | 'Display'
  | 'Video'
  | 'Shopping'
  | 'PMax'
  | 'Demand Gen'
  | 'Other';

/** One campaign as pulled from the Google Ads API, before mapping to a card. */
export interface ImportedGoogleCampaign {
  id: string;
  name: string;
  status: string; // ENABLED | PAUSED | ...
  channelType: string; // raw advertising_channel_type enum
  dailyBudget: number | null; // $ (amount_micros)
  totalBudget: number | null; // $ (total_amount_micros)
  budgetResourceName: string | null;
  startDate: string | null;
  endDate: string | null;
  // §2 sharing/period. referenceCount > 1 = genuinely shared (the pacing unit
  // becomes the budget). period = "DAILY" | "CUSTOM_PERIOD" (Daily/Total label).
  budgetReferenceCount: number | null;
  budgetExplicitlyShared: boolean | null;
  budgetPeriod: string | null;
  // §5 delivery signals (opposite remedies). budgetConstrained = the campaign
  // spends its full cap and has headroom (raise budget); adsDisapproved = an ad
  // can't serve (fix the ads, never raise the budget).
  primaryStatus: string | null;
  budgetConstrained: boolean;
  adsDisapproved: boolean;
}

/**
 * Map Google's advertising_channel_type enum to the display rollup group.
 * PERFORMANCE_MAX and DEMAND_GEN are each their OWN group and never decomposed
 * into Search/Video (§8 — they spend across surfaces the API won't cleanly
 * split). Unknown/rare types fall to "Other" rather than guessing.
 */
export function mapChannelGroup(channelType: string | null | undefined): GoogleChannelGroup {
  switch ((channelType ?? '').toUpperCase()) {
    case 'SEARCH':
      return 'Search';
    case 'DISPLAY':
      return 'Display';
    case 'VIDEO':
      return 'Video';
    case 'SHOPPING':
      return 'Shopping';
    case 'PERFORMANCE_MAX':
      return 'PMax';
    case 'DEMAND_GEN':
      return 'Demand Gen';
    default:
      return 'Other';
  }
}

/**
 * §2 pacing-type label. Google has two budget shapes: an average DAILY budget
 * (amount_micros) and a campaign TOTAL budget over a flight (CUSTOM_PERIOD,
 * total_amount_micros). On the Google page we say "Total" where Meta says
 * "Lifetime" — same underlying branch (budgetType 'Lifetime'), Google wording.
 * Prefer the platform `period` when present; fall back to the budget type.
 */
export function googlePacingTypeLabel(
  budgetPeriod: string | null | undefined,
  budgetType: 'Daily' | 'Lifetime' | null | undefined,
): 'Daily' | 'Total' {
  if ((budgetPeriod ?? '').toUpperCase() === 'CUSTOM_PERIOD') return 'Total';
  if ((budgetPeriod ?? '').toUpperCase() === 'DAILY') return 'Daily';
  return budgetType === 'Lifetime' ? 'Total' : 'Daily';
}

/** §2 — a budget is genuinely SHARED only when more than one campaign points at
 *  it (reference_count > 1), NOT merely when it's marked shareable. Keying the
 *  badge off this avoids labeling a shareable-but-single budget as shared. */
export function isSharedBudget(referenceCount: number | null | undefined): boolean {
  return (referenceCount ?? 0) > 1;
}

/**
 * Google budget type → the Meta budget-type branch the rest of the tool keys off.
 * A total/lifetime budget (total_amount_micros set) maps to 'Lifetime' (§0.2
 * exclusion / §2b split / §3 book-once all apply); an average daily budget maps
 * to 'Daily' (standard per-flight proration, framed as an average).
 */
export function mapGoogleBudgetType(
  _dailyBudget: number | null | undefined,
  totalBudget: number | null | undefined,
): 'Daily' | 'Lifetime' {
  // A set total/lifetime budget = the Meta 'Lifetime' branch; otherwise the
  // average-daily budget = 'Daily'. (dailyBudget is accepted for call-site
  // symmetry — the decision only needs the total.)
  return totalBudget != null && totalBudget > 0 ? 'Lifetime' : 'Daily';
}

export interface ChannelGroupRollup {
  group: GoogleChannelGroup;
  count: number;
  allocation: number; // Σ planned allocation
  actual: number; // Σ actual spend
}

/**
 * Roll Google lines up by channel group for DISPLAY only (§0.4: never the basis
 * for action — the per-campaign rows are). Returns one entry per non-empty group
 * in a stable order. Only Google-platform lines are grouped.
 */
export function groupByChannel(ads: PacerAd[]): ChannelGroupRollup[] {
  const order: GoogleChannelGroup[] = ['Search', 'Display', 'Video', 'Shopping', 'PMax', 'Other'];
  const byGroup = new Map<GoogleChannelGroup, ChannelGroupRollup>();
  for (const ad of ads) {
    if (ad.platform !== 'google') continue;
    const group = mapChannelGroup(ad.googleChannelType);
    const entry =
      byGroup.get(group) ?? { group, count: 0, allocation: 0, actual: 0 };
    entry.count += 1;
    entry.allocation += Number(ad.allocation ?? 0) || 0;
    entry.actual += Number(ad.pacerActual ?? 0) || 0;
    byGroup.set(group, entry);
  }
  return order.filter((g) => byGroup.has(g)).map((g) => byGroup.get(g)!);
}

export interface GoogleDailyRollup {
  dailySet: number; // Σ distinct-budget daily run-rate (lifetime → implied daily)
  dailyNeeded: number; // Σ per-campaign recommended daily to stay on pace
  monthlyCeiling: number; // dailySet × 30.4 — a CEILING/run-rate, NEVER a forecast
  eligibleCount: number;
}

const DAYS_PER_MONTH = MONTH_DAYS_MULTIPLIER; // 30.4 — see constants.ts

/**
 * §8 account daily roll-up: "daily set" vs "daily needed". The gap is the signal
 * (needed ≫ set → will underspend; needed ≪ set → will overspend).
 *
 * Eligibility = §0.2-eligible daily campaigns PLUS in-progress lifetime/total-
 * budget campaigns (those are §0.2-excluded for pacing, but the spec explicitly
 * wants them folded into the daily run-rate as an implied daily). Not-started /
 * completed / unallocated lines are skipped either way.
 *
 * - dailyNeeded: Σ recommended-daily (remaining ÷ days left) per eligible line —
 *   actionable; folds in spend-to-date and days remaining.
 * - dailySet: Σ DISTINCT budgets (dedupe shared campaign budgets via
 *   googleBudgetResourceName) with lifetime converted to total ÷ flight-days.
 * - monthlyCeiling = dailySet × 30.4, labeled a ceiling — Google daily is an
 *   average and demand-limited campaigns won't spend it all, so it's never a
 *   forecast.
 */
export function accountDailyRollup(
  ads: PacerAd[],
  nowMs: number,
  timeZone: string,
): GoogleDailyRollup {
  const seenBudgets = new Set<string>();
  let dailySet = 0;
  let dailyNeeded = 0;
  let eligibleCount = 0;

  for (const ad of ads) {
    if (ad.platform !== 'google') continue;
    const eligible =
      isEligibleForLivePacing(ad, nowMs, timeZone) ||
      isLifetimeInProgress(ad, nowMs, timeZone);
    if (!eligible) continue;
    const c = buildAdCalc(ad, nowMs, timeZone);
    if (c.allocation <= 0) continue; // imported · unallocated — sits out of the roll-up
    eligibleCount += 1;

    // Daily needed: the rec-daily lever for a daily line; for a lifetime line
    // (no daily lever) the implied remaining ÷ days-left.
    const daysLeft = Math.max(0, c.days - c.daysElapsed);
    if (!c.isLifetime && c.recDaily != null) {
      dailyNeeded += c.recDaily;
    } else if (daysLeft > 0) {
      dailyNeeded += Math.max(0, c.allocation - (c.actual ?? 0)) / daysLeft;
    }

    // Daily set: count each distinct budget once (shared budgets dedupe);
    // lifetime → implied daily (total ÷ flight days).
    const budgetKey = ad.googleBudgetResourceName || `__ad:${ad.id}`;
    if (!seenBudgets.has(budgetKey)) {
      seenBudgets.add(budgetKey);
      dailySet += c.isLifetime
        ? c.days > 0
          ? c.allocation / c.days
          : 0
        : c.dailyBudget ?? 0;
    }
  }

  return {
    dailySet,
    dailyNeeded,
    monthlyCeiling: dailySet * DAYS_PER_MONTH,
    eligibleCount,
  };
}

// ── §9 mid-month ceiling reproration ──

/** One daily-rate boundary within a month: `dailyRate` ($) takes effect on
 *  `date` (YYYY-MM-DD) and runs until the next boundary (or month end). */
export interface BudgetRateSegment {
  date: string;
  dailyRate: number;
}

/**
 * §9 — the monthly ceiling for a Google daily budget, honoring mid-month rate
 * changes. A constant daily rate r gives r × 30.4 (Google averages a daily
 * budget across the ~30.4-day month). When the rate changed mid-month, the
 * ceiling is the calendar-day-weighted average rate × 30.4 — i.e. each rate
 * contributes in proportion to the days it was actually in effect that month.
 * For a clean (no-change) month this reduces exactly to currentDaily × 30.4.
 *
 * `segments` must be sorted ascending by date and cover the month: the first
 * entry's rate is the rate in effect at monthStart (clamp its date to
 * monthStart). Dates outside [monthStart, monthEnd] are clamped. Falls back to
 * currentDaily × 30.4 when there are no usable segments.
 */
export function computeProratedCeiling(
  segments: BudgetRateSegment[],
  currentDaily: number,
  monthStartIso: string,
  monthEndIso: string,
): number {
  const startMs = Date.parse(`${monthStartIso}T00:00:00Z`);
  const endMs = Date.parse(`${monthEndIso}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return currentDaily * DAYS_PER_MONTH;
  }
  const daysInMonth = Math.round((endMs - startMs) / 86_400_000) + 1;
  const clean = segments
    .map((s) => ({ ms: Date.parse(`${s.date}T00:00:00Z`), rate: s.dailyRate }))
    .filter((s) => Number.isFinite(s.ms))
    .sort((a, b) => a.ms - b.ms);
  if (clean.length === 0) return currentDaily * DAYS_PER_MONTH;

  let weighted = 0;
  for (let i = 0; i < clean.length; i++) {
    const segStart = Math.max(clean[i].ms, startMs);
    const segEndExclusive = i + 1 < clean.length ? clean[i + 1].ms : endMs + 86_400_000;
    const segEnd = Math.min(segEndExclusive, endMs + 86_400_000);
    if (segEnd <= segStart) continue;
    const days = Math.round((segEnd - segStart) / 86_400_000);
    weighted += clean[i].rate * days;
  }
  const weightedAvg = daysInMonth > 0 ? weighted / daysInMonth : currentDaily;
  return weightedAvg * DAYS_PER_MONTH;
}

// ── §5 per-campaign Google pacing card ──

export type GooglePacingStatus = 'on-track' | 'under' | 'over' | 'no-data';

export interface GooglePacingCard {
  /** Daily (avg daily budget) vs Total (campaign total over a flight). */
  pacingType: 'Daily' | 'Total';
  channelGroup: GoogleChannelGroup;
  shared: boolean;
  sharedCount: number | null;
  /** Planned monthly allocation ($) — the source of truth, stays monthly. */
  target: number;
  /** Served spend this month ($) — labeled "served", never "billed" (§7). */
  actual: number;
  /** Current average daily rate ($). */
  dailyBudget: number;
  /** Fractional days left in the pacing window. */
  daysRemaining: number;
  /** §5 the real cap on a daily campaign: daily × 30.4, reprorated (§9). */
  monthlyCeiling: number;
  /** The catch-up rate ($/day): (target − actual) ÷ remaining calendar days.
   *  Google paces the remainder of the month to new_daily × remaining
   *  calendar days, so this — not target ÷ 30.4 — lands the month on target. */
  recommendedDaily: number;
  /** Month-end projection of served spend: min(actual + run_rate × days
   *  remaining, monthly ceiling) — Google will not bill past the ceiling, so
   *  the old linear daily × calendar-days extrapolation overshot the cap. */
  projected: number;
  status: GooglePacingStatus;
  /** The four-state recommendation engine result (Daily campaigns with a
   *  target only; null for Total budgets / unallocated lines). Carries the
   *  month-to-date pacing health, the catch-up rate, and shortfall math. */
  recommendation: GoogleRecommendation | null;
  /** §5 BUDGET_CONSTRAINED — at cap with headroom (raise budget). */
  budgetLimited: boolean;
  /** §5 an ad is disapproved — fix the ads, never raise the budget. */
  disapproved: boolean;
  /** True when the current rate's ceiling can't clear the allocation (raise it). */
  ceilingShortOfTarget: boolean;
  /** Campaign restricts days/dayparts via an ad schedule — post June 2026 it
   *  paces the full monthly cap into active days, so calendar-day math can
   *  misread it. Badged; active-day pacing is a follow-up. */
  hasAdSchedule: boolean;
}

const ONTRACK_FLOOR = 0.9; // §5 wide band — absorbs Google's 2× daily swings

/**
 * §5 — the four-metric Google pacing card for one campaign line: monthly
 * ceiling, days remaining, projected, and the recommended daily (catch-up)
 * rate, plus a pace-adjusted status. The monthly ceiling (daily × 30.4) is the
 * attainment anchor — Google itself paces to it — so over/under keys off
 * ceiling vs TARGET plus month-to-date delivery health, never a single high
 * day (Google may spend up to 2× the daily on one day) and never projection
 * vs ceiling (a ~2% calendar artifact no rate change can fix). Budget-limited
 * and disapproved are surfaced separately because they need opposite fixes
 * (raise budget vs fix ads). Total-budget campaigns pace to their own end
 * date, so variance is near zero by design — an under there signals an
 * interruption, not a pacing miss.
 */
export function buildGooglePacingCard(
  ad: PacerAd,
  nowMs: number,
  timeZone: string,
): GooglePacingCard {
  const calc = buildPacerCalc(ad, nowMs, timeZone);
  const pacingType = googlePacingTypeLabel(ad.googleBudgetPeriod, ad.budgetType);
  const target = calc.budget;
  const actual = calc.spent;
  const dailyBudget = calc.dailyBudget;
  // Ceiling: prefer the server-reprorated value (§9); else current daily × 30.4.
  const ceiling = num(ad.googleProratedCeiling) ?? dailyBudget * DAYS_PER_MONTH;
  const ceilingShortOfTarget = pacingType === 'Daily' && ceiling > 0 && ceiling < target;

  const budgetLimited = !!ad.googleBudgetConstrained;
  const disapproved = !!ad.googleAdsDisapproved;

  // Fractional calendar days the campaign has been eligible this month
  // (effective start → now, account TZ) — the health denominator.
  const bounds = ad.period ? monthBoundsIso(ad.period) : null;
  const daysInMonth =
    bounds != null
      ? Math.round(
          (Date.parse(`${bounds.end}T00:00:00Z`) -
            Date.parse(`${bounds.start}T00:00:00Z`)) /
            86_400_000,
        ) + 1
      : DAYS_PER_MONTH;
  let daysElapsed = 0;
  const startMatch = calc.effectiveStart
    ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(calc.effectiveStart)
    : null;
  if (startMatch) {
    const startMs = zonedMidnightMs(
      Number(startMatch[1]),
      Number(startMatch[2]),
      Number(startMatch[3]),
      timeZone,
    );
    daysElapsed = Math.max(0, (nowMs - startMs) / 86_400_000);
  }

  // The four-state engine — Daily campaigns only (a Total budget paces to its
  // own end date; Google won't exceed it, so the daily-rate machinery doesn't
  // apply).
  const recommendation =
    pacingType === 'Daily' && target > 0 && !calc.endsBeforeToday
      ? buildGoogleRecommendation({
          target,
          actualSpend: actual,
          dailyBudget,
          monthlyCeiling: ceiling,
          daysElapsed,
          daysRemaining: calc.daysLeft,
          daysInMonth,
        })
      : null;

  // Projection: for a daily campaign, run-rate based and capped at the
  // ceiling (Google never bills past it). Total budgets keep the linear
  // projection (they pace to their own flight, not a monthly cap).
  const projected = recommendation?.projectedSpend ?? calc.projected;
  // Catch-up rate, not target/30.4 — see the field doc.
  const recommendedDaily =
    recommendation?.requiredRate ??
    (target > 0 && calc.daysLeft > 0
      ? Math.max(0, target - actual) / Math.max(calc.daysLeft, 1)
      : 0);

  let status: GooglePacingStatus;
  if (target <= 0) {
    status = 'no-data';
  } else if (pacingType === 'Total') {
    // §5/§6: Google paces a total budget to its end date and won't exceed it,
    // so variance is near zero by design. Only a real shortfall (interruption)
    // shows as under; otherwise on-track. Never "over".
    status = calc.projected < target * ONTRACK_FLOOR ? 'under' : 'on-track';
  } else if (recommendation) {
    // Daily: over/under keys off CEILING vs TARGET (the attainment anchor) +
    // delivery health — never projection vs ceiling, which is a ~2% artifact
    // of 31 calendar days vs the 30.4 multiplier that no rate change can fix.
    status =
      recommendation.state === 'on_track'
        ? 'on-track'
        : recommendation.state === 'adjust' &&
            recommendation.direction === 'trim'
          ? 'over'
          : 'under';
  } else {
    status = projected < target * ONTRACK_FLOOR ? 'under' : 'on-track';
  }

  return {
    pacingType,
    channelGroup: mapChannelGroup(ad.googleChannelType),
    shared: isSharedBudget(ad.googleBudgetReferenceCount),
    sharedCount: isSharedBudget(ad.googleBudgetReferenceCount)
      ? ad.googleBudgetReferenceCount ?? null
      : null,
    target,
    actual,
    dailyBudget,
    daysRemaining: calc.daysLeft,
    monthlyCeiling: ceiling,
    recommendedDaily,
    projected,
    status,
    recommendation,
    budgetLimited,
    disapproved,
    ceilingShortOfTarget,
    hasAdSchedule: !!ad.googleHasAdSchedule,
  };
}

export interface ImportChange {
  adId: string;
  googleCampaignId: string;
  field: 'name' | 'status' | 'budgetType';
  from: string;
  to: string;
}

export interface ImportDiff {
  adds: ImportedGoogleCampaign[]; // campaigns with no linked card yet
  removes: { adId: string; name: string; googleCampaignId: string }[]; // linked card, campaign gone
  changes: ImportChange[]; // matched but name/status/budget changed
}

/**
 * §8 import reconciliation: diff freshly-imported campaigns against the existing
 * linked Google cards, returning adds / removes / changes for the user to
 * CONFIRM. Never auto-overwrites allocations — observed platform data is a
 * suggestion. (A renamed or paused campaign surfaces as a change, not a wipe.)
 */
export function reconcileImport(
  imported: ImportedGoogleCampaign[],
  existing: PacerAd[],
): ImportDiff {
  const linked = existing.filter((a) => a.platform === 'google' && a.googleCampaignId);
  const byCampaign = new Map(linked.map((a) => [a.googleCampaignId as string, a]));
  const importedIds = new Set(imported.map((c) => c.id));

  const adds: ImportedGoogleCampaign[] = [];
  const changes: ImportChange[] = [];
  for (const camp of imported) {
    const existingAd = byCampaign.get(camp.id);
    if (!existingAd) {
      adds.push(camp);
      continue;
    }
    if ((existingAd.name ?? '') !== camp.name) {
      changes.push({
        adId: existingAd.id,
        googleCampaignId: camp.id,
        field: 'name',
        from: existingAd.name ?? '',
        to: camp.name,
      });
    }
    const importedType = mapGoogleBudgetType(camp.dailyBudget, camp.totalBudget);
    if ((existingAd.budgetType ?? 'Daily') !== importedType) {
      changes.push({
        adId: existingAd.id,
        googleCampaignId: camp.id,
        field: 'budgetType',
        from: existingAd.budgetType ?? 'Daily',
        to: importedType,
      });
    }
  }

  const removes = linked
    .filter((a) => !importedIds.has(a.googleCampaignId as string))
    .map((a) => ({
      adId: a.id,
      name: a.name ?? '',
      googleCampaignId: a.googleCampaignId as string,
    }));

  return { adds, removes, changes };
}
