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
  /**
   * Setup + Split only: the split ad's TOTAL budget the user typed (§4a). Held
   * on the `::base` portion spec; the base `amount` is the base slice and the
   * derived Added (Total − Base) is written to the `::added` spec. Ignored for
   * every other row.
   */
  total?: string;
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

/** Status-driven donor: finalized ad (Off / Completed Run), locked at spent. */
export function isDonorStatus(status: string | null | undefined): boolean {
  return status === 'Off' || status === 'Completed Run';
}

/**
 * A donor for pool purposes: locked at spent, its remainder freed into the
 * redistribution pool. Either a status donor OR a calculator-local "Off — lock
 * at spent" choice (mode === 'off'). The calc-local case is §5a: modeling
 * "what if this were off" frees the remainder without needing the planner
 * status to already be Off.
 */
export function isDonorRow(
  adStatus: string | null | undefined,
  mode: AllocationMode,
): boolean {
  return isDonorStatus(adStatus) || mode === 'off';
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

/** Round values to cents so they sum EXACTLY to `total` (largest-remainder). */
function centReconcile(values: number[], total: number): number[] {
  if (values.length === 0) return [];
  const targetCents = Math.round(total * 100);
  const raw = values.map((v) => v * 100);
  const floorsC = raw.map((c) => Math.floor(c));
  let leftover = targetCents - floorsC.reduce((s, c) => s + c, 0);
  const cents = floorsC.slice();
  const order = raw
    .map((c, i) => ({ i, frac: c - floorsC[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; leftover > 0 && k < order.length; k++, leftover--) cents[order[k].i] += 1;
  for (let k = order.length - 1; leftover < 0 && k >= 0; k--, leftover++) cents[order[k].i] -= 1;
  return cents.map((c) => c / 100);
}

/**
 * §5c — distribute `pool` so each row gets AT LEAST its spent floor, and the
 * surplus above the floors is split evenly (water-filling). Rows whose even
 * share would fall below their floor are pinned at the floor and the remainder
 * re-split among the rest. Returns cent-exact shares summing to `pool` when
 * feasible; when the floors alone exceed `pool` it returns each row pinned at
 * its floor and feasible=false (the caller keeps Apply blocked). In the common
 * case (all even shares already clear their floors) this equals a naive even
 * split — the label stays "Distribute evenly."
 */
export function floorAwareShares(
  pool: number,
  floors: number[],
): { shares: number[]; feasible: boolean } {
  const n = floors.length;
  if (n === 0) return { shares: [], feasible: true };
  const fl = floors.map((f) => Math.max(0, f));
  const totalFloor = fl.reduce((s, f) => s + f, 0);
  if (totalFloor > pool + 0.005) return { shares: fl.slice(), feasible: false };

  const pinned = new Array<boolean>(n).fill(false);
  const shares = new Array<number>(n).fill(0);
  for (;;) {
    const active: number[] = [];
    let pinnedSum = 0;
    for (let i = 0; i < n; i++) {
      if (pinned[i]) pinnedSum += shares[i];
      else active.push(i);
    }
    if (active.length === 0) break;
    const even = (pool - pinnedSum) / active.length;
    let changed = false;
    for (const i of active) {
      if (fl[i] > even + 1e-9) {
        pinned[i] = true;
        shares[i] = fl[i];
        changed = true;
      }
    }
    if (!changed) {
      for (const i of active) shares[i] = even;
      break;
    }
  }
  // Cent-reconcile only the unpinned (even) rows so pinned floors stay exact.
  const unpinned = shares.map((_, i) => i).filter((i) => !pinned[i]);
  const pinnedSum = shares.reduce((s, v, i) => (pinned[i] ? s + v : s), 0);
  const reconciled = centReconcile(
    unpinned.map((i) => shares[i]),
    pool - pinnedSum,
  );
  unpinned.forEach((i, k) => (shares[i] = reconciled[k]));
  for (let i = 0; i < n; i++) if (pinned[i]) shares[i] = Math.round(shares[i] * 100) / 100;
  return { shares, feasible: true };
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
  floorSpent = false,
): Record<string, number> {
  const out: Record<string, number> = {};
  const pctRows: { id: string; pct: number }[] = [];
  const spentById: Record<string, number> = {};
  for (const ad of ads) {
    const spec = specs[ad.id] ?? DEFAULT_SPEC;
    if (!spec.included) continue;
    spentById[ad.id] = ad.spent;
    // Donors (status Off / Completed Run OR calc-local off-mode) lock at spent.
    if (isDonorRow(ad.adStatus, spec.mode)) {
      out[ad.id] = ad.spent;
      continue;
    }
    if (spec.mode === 'amount') out[ad.id] = num(spec.amount) ?? 0;
    else if (spec.mode === 'client') out[ad.id] = (num(spec.clientAmount) ?? 0) * markup;
    else if (spec.mode === 'percent') pctRows.push({ id: ad.id, pct: num(spec.percent) ?? 0 });
    // even: skipped until Spread.
  }
  Object.assign(out, reconcilePercents(pctRows, poolBase));
  // §5b: a live ad can never be allocated below what it has already spent —
  // clamp the computed value up to the spent floor (Mid-flight only; Setup has
  // no spend to floor against). The row still flags the below-spent entry so
  // Apply stays blocked until the user raises it.
  if (floorSpent) {
    for (const id of Object.keys(out)) {
      const floor = spentById[id] ?? 0;
      if (out[id] < floor) out[id] = floor;
    }
  }
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
    const spec = specs[ad.id] ?? DEFAULT_SPEC;
    // §5a: calc-local off-mode ads count as donors too — their spent locks and
    // their remainder (allocation − spent) frees into the redistribution pool,
    // and the Spread gate (lockedSpend > 0) now recognizes them.
    if (isDonorRow(ad.adStatus, spec.mode)) lockedSpend += ad.spent;
    else if (!spec.included) preserved += ad.allocation;
  }
  const midflight = calcMode === 'midflight';
  // Percent base + spread pool: the redistribution pool in Mid-flight, the
  // full ceiling in Setup.
  const poolBase = midflight
    ? Math.max(0, initial - lockedSpend - preserved)
    : ceiling;
  const allocations = computeAllocations(ads, poolBase, markup, specs, midflight);

  let entered = 0;
  for (const ad of ads) {
    const spec = specs[ad.id] ?? DEFAULT_SPEC;
    if (!spec.included || isDonorRow(ad.adStatus, spec.mode)) continue;
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
