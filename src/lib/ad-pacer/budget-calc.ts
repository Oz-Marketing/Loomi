/**
 * Budget Calculator — pure allocation + meter math (no React, no DB).
 *
 * The calculator has two independent axes: a MODE (Initial Setup vs Mid-flight
 * Reallocation) and a POOL VIEW (Base / Added / Split). The meters, however,
 * are ACCOUNT-GLOBAL per pool: the base meter reflects base committed by
 * pure-base ads AND the base portions of split ads, no matter which tab is on
 * screen. Split is a dual-pool view (both meters), never a third single pool.
 *
 * Currency: everything here is ACTUAL-spend dollars. The only gross figure is
 * the Client Budget input, converted (gross × markup) at the input boundary in
 * computeAllocations — a gross number never reaches a meter.
 */
import type { PacerPlan } from './types';
import { num, adContribution } from './helpers';

export type Pool = 'base' | 'added';
export type AllocationMode = 'even' | 'amount' | 'percent' | 'off' | 'client';

export interface AdAllocSpec {
  mode: AllocationMode;
  amount: string; // when mode === 'amount'
  percent: string; // when mode === 'percent'
  clientAmount: string; // when mode === 'client' — gross; × markup = actual
  included: boolean; // false = locked / leave-as-is (still counts as committed)
}

export const DEFAULT_SPEC: AdAllocSpec = {
  mode: 'even',
  amount: '',
  percent: '',
  clientAmount: '',
  included: true,
};

/**
 * A pool's contributing row: either a pure-pool ad (id === ad.id) or ONE
 * portion of a split ad (id === `${ad.id}::base|added`). Both carry only that
 * pool's slice of the allocation/spend, so meter math never nets pools.
 */
export interface PoolAdView {
  id: string; // spec key — source-qualified for split portions
  realId: string; // the underlying PacerAd id
  budgetSource: 'base' | 'added' | 'split';
  adStatus: string | null;
  allocation: number; // this pool's existing allocation ($)
  spent: number; // this pool's spent ($)
}

/** Status-driven donor: finalized ad, locked at its spent on Apply. */
export function isDonorStatus(status: string | null | undefined): boolean {
  return status === 'Off' || status === 'Completed Run';
}

/** Total-budget ceiling for a pool: the gross goal × markup (actual-spend). */
export function poolCeiling(plan: PacerPlan, pool: Pool, markup: number): number {
  const goal = pool === 'base' ? num(plan.baseBudgetGoal) : num(plan.addedBudgetGoal);
  return goal != null ? Math.round(goal * markup * 100) / 100 : 0;
}

/**
 * The contributing rows for one pool across the WHOLE plan (account-global):
 * pure-pool ads plus each split ad's portion for this pool. This is the list
 * the pool meter sums — independent of which tab is being viewed.
 */
export function poolAds(plan: PacerPlan, pool: Pool): PoolAdView[] {
  const out: PoolAdView[] = [];
  for (const a of plan.ads) {
    if (a.budgetSource === pool) {
      out.push({
        id: a.id,
        realId: a.id,
        budgetSource: pool,
        adStatus: a.adStatus ?? null,
        allocation: num(a.allocation) ?? 0,
        spent: num(a.pacerActual) ?? 0,
      });
    } else if (a.budgetSource === 'split') {
      const c = adContribution(a);
      out.push({
        id: `${a.id}::${pool}`,
        realId: a.id,
        budgetSource: 'split',
        adStatus: a.adStatus ?? null,
        allocation: pool === 'base' ? c.baseAllocation : c.addedAllocation,
        spent: pool === 'base' ? c.baseSpent : c.addedSpent,
      });
    }
  }
  return out;
}

/**
 * Cent-accurate split of `total` into `n` parts that sum back EXACTLY, leftover
 * cents onto the first rows — so "distribute evenly" leaves no phantom residual.
 */
export function splitToCents(total: number, n: number): number[] {
  if (n <= 0) return [];
  const cents = Math.round(total * 100);
  const base = Math.trunc(cents / n);
  let remainder = cents - base * n;
  return Array.from({ length: n }, () => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return (base + extra) / 100;
  });
}

/**
 * Reconcile a group of percent rows to their exact target to the cent via
 * largest-remainder: each row is `poolBase × pct/100`, but rounding each
 * independently drifts (three × 33.33% leaves a stray cent). Round down, then
 * hand the leftover cents to the largest fractional remainders so the group
 * sums to `poolBase × Σpct/100` exactly.
 */
function reconcilePercents(
  rows: { id: string; pct: number }[],
  poolBase: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (rows.length === 0) return out;
  const sumPct = rows.reduce((s, r) => s + r.pct, 0);
  const targetCents = Math.round((poolBase * sumPct) / 100 * 100);
  const rawCents = rows.map((r) => (poolBase * r.pct) / 100 * 100);
  const floors = rawCents.map((c) => Math.floor(c));
  let leftover = targetCents - floors.reduce((s, c) => s + c, 0);
  const cents = floors.slice();
  const byRemainder = rawCents
    .map((c, i) => ({ i, frac: c - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  // leftover is normally 0..rows.length-1; distribute (or claw back if the
  // float sum rounded high) so the group total is exact.
  for (let k = 0; leftover > 0 && k < byRemainder.length; k++, leftover--) {
    cents[byRemainder[k].i] += 1;
  }
  for (let k = byRemainder.length - 1; leftover < 0 && k >= 0; k--, leftover++) {
    cents[byRemainder[k].i] -= 1;
  }
  rows.forEach((r, i) => {
    out[r.id] = cents[i] / 100;
  });
  return out;
}

/**
 * Per-row computed allocation for one pool. `poolBase` is the base for percent
 * rows (and the spread pool): the ceiling in Setup, the redistribution pool in
 * Mid-flight. Donors and off-mode rows lock at spent; amount is literal; client
 * is gross × markup; percent is reconciled as a group; even is skipped (a value
 * only lands once the user spreads). Excluded rows are omitted.
 */
export function computeAllocations(
  ads: PoolAdView[],
  poolBase: number,
  markup: number,
  specs: Record<string, AdAllocSpec>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const pctRows: { id: string; pct: number }[] = [];
  for (const ad of ads) {
    const spec = specs[ad.id] ?? DEFAULT_SPEC;
    if (!spec.included) continue;
    if (isDonorStatus(ad.adStatus)) {
      out[ad.id] = ad.spent;
      continue;
    }
    if (spec.mode === 'off') out[ad.id] = ad.spent;
    else if (spec.mode === 'amount') out[ad.id] = num(spec.amount) ?? 0;
    else if (spec.mode === 'client') out[ad.id] = (num(spec.clientAmount) ?? 0) * markup;
    else if (spec.mode === 'percent') pctRows.push({ id: ad.id, pct: num(spec.percent) ?? 0 });
    // even: skipped until Spread.
  }
  Object.assign(out, reconcilePercents(pctRows, poolBase));
  return out;
}

export interface PoolMeter {
  pool: Pool;
  /** Total-budget ceiling (goal × markup). */
  ceiling: number;
  /** Σ existing allocations of contributing ads (the Mid-flight "Initial"). */
  initial: number;
  /** Σ spent of donor ads (status Off / Completed Run) — freed in Mid-flight. */
  lockedSpend: number;
  /** Σ existing allocation of unchecked (leave-as-is) non-donor ads. */
  preserved: number;
  /** The base for percent rows + the spread pool. */
  poolBase: number;
  /** The dominant number: ceiling (Setup) or the redistribution pool (Mid-flight). */
  anchor: number;
  /** Σ computed allocations of checked, non-donor ads. */
  entered: number;
  /** What counts against the anchor (locked + preserved + entered as applicable). */
  committed: number;
  /** anchor − committed. Negative ⇒ over-allocation (surfaces red). */
  unallocated: number;
  overAllocated: boolean;
  /** Per-row computed allocations (id → $) for the contributing ads. */
  allocations: Record<string, number>;
}

/**
 * Account-global meter for one pool. Setup counts locked/unchecked as committed
 * against the full ceiling (the fix); Mid-flight re-plans the unlocked pool
 * (Initial − Locked Spend − Preserved) exactly as before. Same underlying rule
 * both modes: anchor = pool ceiling − locked spend; Setup's locked spend is $0.
 */
export function computePoolMeter(
  pool: Pool,
  ads: PoolAdView[],
  specs: Record<string, AdAllocSpec>,
  calcMode: 'setup' | 'midflight',
  markup: number,
  ceiling: number,
): PoolMeter {
  let initial = 0;
  let lockedSpend = 0;
  let preserved = 0;
  for (const ad of ads) {
    initial += ad.allocation;
    const donor = isDonorStatus(ad.adStatus);
    const spec = specs[ad.id] ?? DEFAULT_SPEC;
    if (donor) lockedSpend += ad.spent;
    else if (!spec.included) preserved += ad.allocation;
  }
  const midflight = calcMode === 'midflight';
  // Percent base + spread pool: the redistribution pool in Mid-flight, the
  // full ceiling in Setup.
  const poolBase = midflight
    ? Math.max(0, initial - lockedSpend - preserved)
    : ceiling;
  const allocations = computeAllocations(ads, poolBase, markup, specs);

  let entered = 0;
  for (const ad of ads) {
    const spec = specs[ad.id] ?? DEFAULT_SPEC;
    if (!spec.included || isDonorStatus(ad.adStatus)) continue;
    entered += allocations[ad.id] ?? 0;
  }

  // Setup anchors on the full ceiling, so locked + preserved must be subtracted
  // alongside entered (the Unallocated-counts-locked fix). Mid-flight's anchor
  // already excludes them.
  const anchor = midflight ? poolBase : ceiling;
  const committed = midflight ? entered : entered + preserved + lockedSpend;
  const unallocated = anchor - committed;

  return {
    pool,
    ceiling,
    initial,
    lockedSpend,
    preserved,
    poolBase,
    anchor,
    entered,
    committed,
    unallocated,
    overAllocated: unallocated < -0.005,
    allocations,
  };
}
