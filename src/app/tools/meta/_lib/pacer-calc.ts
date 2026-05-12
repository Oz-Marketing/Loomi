/**
 * Pacing math for the Ad Pacer page. `buildPacerCalc` is the canonical
 * source of truth; `buildAdCalc` (used by the Summary table) delegates to
 * it so both views always show the same numbers for the same ad.
 */

import { toIso } from '@/components/ui/date-picker';
import { calcDays, calcElapsed, num } from './helpers';
import type { PacerAd, PacingStatus } from './types';

export interface PacerCalc {
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
   * Lifetime-only: spend pacing relative to elapsed flight time. 100 = on
   * track, >100 = overpacing, <100 = underpacing. null when we can't
   * compute (no budget, no flight start, or period hasn't started).
   */
  lifetimePacingPct: number | null;
}

export function buildPacerCalc(
  ad: PacerAd,
  todayIso: string | null,
  endIso: string | null,
): PacerCalc {
  const isLifetime = ad.budgetType === 'Lifetime';
  const budget = num(ad.allocation) ?? 0;
  const spent = num(ad.pacerActual) ?? 0;
  // Lifetime ads don't have a daily-rate column — projection collapses to
  // whatever's been spent rather than extrapolating with a phantom rate.
  const dailyBudget = isLifetime ? 0 : num(ad.pacerDailyBudget) ?? 0;
  const today = todayIso ? new Date(todayIso + 'T00:00:00') : null;
  const end = endIso ? new Date(endIso + 'T00:00:00') : null;
  const hasDates = !!(today && end);
  const endsBeforeToday = !!(today && end && end.getTime() < today.getTime());
  const daysLeft =
    hasDates && !endsBeforeToday
      ? Math.round((end!.getTime() - today!.getTime()) / 86400000) + 1
      : 0;
  const remaining = Math.max(0, budget - spent);
  const recDaily = daysLeft > 0 ? remaining / daysLeft : 0;
  const projected = spent + dailyBudget * Math.max(daysLeft, 0);

  // Lifetime pacing %: spent / (budget × daysElapsed / totalDays).
  let lifetimePacingPct: number | null = null;
  if (isLifetime && budget > 0 && hasDates) {
    const startIso = ad.liveDate || ad.flightStart;
    const start = startIso ? new Date(startIso + 'T00:00:00') : null;
    if (start && end && today) {
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
    lifetimePacingPct,
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
 * `buildPacerCalc()` (with the same per-ad pacerTodayDate / pacerEndDate
 * cursors), so the two views always show the same projection, remaining,
 * and recommended daily figures for a given ad.
 */
export function buildAdCalc(ad: PacerAd): AdCalc {
  const isLifetime = ad.budgetType === 'Lifetime';
  const effectiveStart = ad.liveDate || ad.flightStart;
  const days = calcDays(effectiveStart, ad.flightEnd);
  const daysElapsed = calcElapsed(effectiveStart, ad.flightEnd);
  const isLate = !!(
    ad.liveDate &&
    ad.flightStart &&
    ad.liveDate > ad.flightStart
  );
  const daysLate = isLate ? calcDays(ad.flightStart, ad.liveDate) - 1 : 0;

  const todayIso = ad.pacerTodayDate ?? toIso(new Date());
  const endIso = ad.pacerEndDate ?? ad.flightEnd;
  const pacer = buildPacerCalc(ad, todayIso, endIso);

  const allocation = pacer.budget;
  const dailyBudget = isLifetime ? null : num(ad.pacerDailyBudget);
  const totalBudget = isLifetime ? allocation : dailyBudget ?? 0;
  const projected = pacer.projected;
  const impliedDaily = isLifetime && days > 0 ? allocation / days : null;
  const actual = num(ad.pacerActual);
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
