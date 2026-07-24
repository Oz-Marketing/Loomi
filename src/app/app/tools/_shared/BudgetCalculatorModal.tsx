'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ExclamationTriangleIcon,
  LockClosedIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { PacerPlan, PacerAd } from '@/lib/ad-pacer/types';
import { COLORS } from '@/lib/ad-pacer/constants';
import {
  fmt,
  num,
  calcDays,
  adContribution,
  effMarkupOf,
  sourceColor,
} from '@/lib/ad-pacer/helpers';
import {
  poolAds,
  poolCeiling,
  computePoolMeter,
  splitToCents,
  DEFAULT_SPEC,
  type Pool,
  type PoolMeter,
  type AdAllocSpec,
  type AllocationMode,
} from '@/lib/ad-pacer/budget-calc';
import { CompactStat } from './metrics';
import { DollarInput, inputClass } from './inputs';
import { Tooltip } from './Tooltip';

// ─── Budget Calculator modal (+ allocation helpers, appended below) ─────────
/**
 * Per-source budget calculator: spreads a total budget across the source's
 * ads using one of three modes per row — "Distribute evenly" (default,
 * unlocked), "Set amount" (locked $), or "Set %" (locked % of total). The
 * unlocked ads share whatever's left after locked rows. For Daily ads the
 * computed allocation is also shown as a daily rate over the flight days.
 *
 * On Apply: writes the computed allocation back to each ad's `allocation`
 * field. If any ad in the source already has an allocation, prompts before
 * overwriting.
 */
// Allocation types + math (splitToCents, computeAllocations, poolAds,
// computePoolMeter) live in @/lib/ad-pacer/budget-calc — a pure, unit-tested
// module so the meter accounting is verified independently of this UI.

export function BudgetCalculatorModal({
  plan,
  onClose,
  onApply,
}: {
  plan: PacerPlan;
  onClose: () => void;
  onApply: (
    updates: Record<string, { allocation: number; splitBaseAmount?: number }>,
  ) => void;
}) {
  // Pool VIEW (which ads show): Base / Added are single-pool; Split is a
  // dual-pool view (split ads only, both meters). Independent of the MODE axis.
  const [view, setView] = useState<Pool | 'split'>('base');
  // Setup = fresh planning (clean slate, no spent column).
  // Mid-flight = adjusting allocations after some spend has happened (shows
  // spent per row, exposes "Off — lock at spent" to wind ads down and free
  // their remaining budget for the rest).
  const [calcMode, setCalcMode] = useState<'setup' | 'midflight'>('setup');

  // Effective markup — per-account override (Account.markup) when set,
  // otherwise the global default. Converts the gross client goal into the
  // actual-spend ceiling, and powers Client Budget mode below.
  const effectiveMarkup = effMarkupOf(plan.markup);
  const baseCeiling = poolCeiling(plan, 'base', effectiveMarkup);
  const addedCeiling = poolCeiling(plan, 'added', effectiveMarkup);

  // Per-ad allocation specs, keyed by ad id.
  // * Setup mode: pre-fill existing allocations in "Set amount" mode so
  //   you can edit the existing plan.
  // * Mid-flight mode: blank slate — every row defaults to even mode (no
  //   pre-fill) because you're redistributing the leftover pool, not
  //   editing the previous plan. The existing allocation per ad still
  //   shows as the "Allocated $X" carryover text in the row body.
  const seedSpecsForMode = useCallback(
    (mode: 'setup' | 'midflight'): Record<string, AdAllocSpec> => {
      // Mid-flight: blank slate — donor detection happens at compute time
      // (via adStatus), so no per-row seeding is needed here. Every row
      // defaults to even mode for receivers; donors are auto-handled by
      // computeAllocations regardless of mode.
      if (mode === 'midflight') return {};
      // Setup: pre-fill existing allocations in amount mode so the user can
      // edit the plan in place. Split ads seed BOTH source-qualified keys with
      // their respective portions, so each source view shows the right value.
      const seed: Record<string, AdAllocSpec> = {};
      const amountSpec = (amount: number): AdAllocSpec => ({
        mode: 'amount',
        amount: amount.toFixed(2),
        percent: '',
        clientAmount: '',
        included: true,
      });
      for (const ad of plan.ads) {
        if (ad.budgetSource === 'split') {
          const c = adContribution(ad);
          if (c.baseAllocation > 0) seed[`${ad.id}::base`] = amountSpec(c.baseAllocation);
          if (c.addedAllocation > 0) seed[`${ad.id}::added`] = amountSpec(c.addedAllocation);
          continue;
        }
        const existing = num(ad.allocation);
        if (existing != null && existing > 0) seed[ad.id] = amountSpec(existing);
      }
      return seed;
    },
    [plan.ads],
  );
  const [specs, setSpecs] = useState<Record<string, AdAllocSpec>>(() =>
    seedSpecsForMode(calcMode),
  );

  // Helpers — donor = ad status is Off / Completed Run (it's finalized,
  // locked at pacerActual on Apply). Receiver = anything else. Accepts a
  // PacerAd or a PoolAdView (both carry adStatus).
  const isDonor = (a: { adStatus: string | null | undefined }) =>
    a.adStatus === 'Off' || a.adStatus === 'Completed Run';

  // Account-global pool meters — ALWAYS both, from the pure, unit-tested
  // module. A pool's meter counts its pure-pool ads AND every split ad's
  // portion for that pool, no matter which tab is on screen — so Base and
  // Split can never double-spend the base pool. Setup counts locked/unchecked
  // ads as committed against the ceiling; Mid-flight re-plans Initial − Locked
  // − Preserved.
  const baseAds = useMemo(() => poolAds(plan, 'base'), [plan]);
  const addedAds = useMemo(() => poolAds(plan, 'added'), [plan]);
  const baseMeter = useMemo(
    () => computePoolMeter('base', baseAds, specs, calcMode, effectiveMarkup, baseCeiling),
    [baseAds, specs, calcMode, effectiveMarkup, baseCeiling],
  );
  const addedMeter = useMemo(
    () => computePoolMeter('added', addedAds, specs, calcMode, effectiveMarkup, addedCeiling),
    [addedAds, specs, calcMode, effectiveMarkup, addedCeiling],
  );
  // Merged computed allocations (disjoint keys across pools) so any row's
  // lookup works regardless of the active view.
  const allocations = useMemo(
    () => ({ ...baseMeter.allocations, ...addedMeter.allocations }),
    [baseMeter, addedMeter],
  );
  const meterOf = (pool: Pool): PoolMeter => (pool === 'base' ? baseMeter : addedMeter);
  // The pool(s) the active view shows a meter for: Split shows both.
  const viewPools: Pool[] = view === 'split' ? ['base', 'added'] : [view];

  // Rows to render for the active view. Base/Added show their pure-pool ads
  // (split ads now live only on the Split tab). Split shows each split ad as
  // TWO portion rows (::base + ::added) so both pools are edited side by side —
  // the dual-pool view. Each row is keyed exactly as its spec is.
  const viewRows = useMemo<PacerAd[]>(() => {
    if (view !== 'split') return plan.ads.filter((a) => a.budgetSource === view);
    const out: PacerAd[] = [];
    for (const a of plan.ads) {
      if (a.budgetSource !== 'split') continue;
      const c = adContribution(a);
      out.push({ ...a, id: `${a.id}::base`, allocation: String(c.baseAllocation), pacerActual: String(c.baseSpent) });
      out.push({ ...a, id: `${a.id}::added`, allocation: String(c.addedAllocation), pacerActual: String(c.addedSpent) });
    }
    return out;
  }, [plan.ads, view]);

  // The pool a rendered row belongs to (from the split id suffix, else its
  // budgetSource) — drives its accent color and which meter it feeds.
  const rowPool = (a: PacerAd): Pool =>
    a.id.endsWith('::added')
      ? 'added'
      : a.id.endsWith('::base')
        ? 'base'
        : a.budgetSource === 'added'
          ? 'added'
          : 'base';

  // Spread state per pool: included, non-donor, even-mode rows share that
  // pool's Unallocated. Mid-flight gates on a donor freeing budget.
  const spreadFor = (pool: Pool) => {
    const m = meterOf(pool);
    const evenRows = (pool === 'base' ? baseAds : addedAds).filter((r) => {
      const spec = specs[r.id] ?? DEFAULT_SPEC;
      return !isDonor(r) && spec.included && spec.mode === 'even';
    });
    const spreadPool = Math.max(0, m.unallocated);
    const gateOk = calcMode !== 'midflight' || m.lockedSpend > 0;
    const canSpread = evenRows.length > 0 && spreadPool > 0.005 && gateOk;
    return {
      pool,
      evenRows,
      spreadPool,
      canSpread,
      perEven: canSpread ? spreadPool / evenRows.length : 0,
    };
  };

  const handleSpread = (pool: Pool) => {
    const s = spreadFor(pool);
    if (!s.canSpread) return;
    // Cent-accurate shares that sum to the pool exactly (no per-row residual).
    const shares = splitToCents(s.spreadPool, s.evenRows.length);
    setSpecs((prev) => {
      const next = { ...prev };
      s.evenRows.forEach((r, i) => {
        const existing = next[r.id] ?? DEFAULT_SPEC;
        next[r.id] = {
          ...existing,
          mode: 'amount',
          amount: shares[i].toFixed(2),
          percent: '',
          included: true,
        };
      });
      return next;
    });
  };

  // Any included "Set amount" row (either pool) below its already-spent amount
  // blocks Apply — you can't allocate an ad less than it has physically spent.
  const hasUnderSpent = [...baseAds, ...addedAds].some((r) => {
    const spec = specs[r.id] ?? DEFAULT_SPEC;
    if (!spec.included || spec.mode !== 'amount' || spec.amount.trim() === '') return false;
    return (num(spec.amount) ?? 0) < r.spent - 0.005;
  });
  // Apply commits BOTH pools, so it's blocked while either is over-allocated.
  const overBudget = baseMeter.overAllocated || addedMeter.overAllocated;

  // Switching modes re-seeds the row state from scratch:
  // * → Setup:      restore the existing-allocation pre-fills so the user
  //                 can edit the plan.
  // * → Mid-flight: clear all pre-fills so the rows default to even mode,
  //                 ready to absorb the post-spent remainder.
  // The first mount also runs this once with `calcMode === 'setup'`, which
  // matches the useState initializer — no-op effectively.
  const didInitSpecsRef = useRef(false);
  useEffect(() => {
    if (!didInitSpecsRef.current) {
      didInitSpecsRef.current = true;
      return;
    }
    setSpecs(seedSpecsForMode(calcMode));
  }, [calcMode, seedSpecsForMode]);

  const updateSpec = (adId: string, patch: Partial<AdAllocSpec>) =>
    setSpecs((prev) => ({
      ...prev,
      [adId]: {
        mode: prev[adId]?.mode ?? 'even',
        amount: prev[adId]?.amount ?? '',
        percent: prev[adId]?.percent ?? '',
        clientAmount: prev[adId]?.clientAmount ?? '',
        included: prev[adId]?.included ?? true,
        ...patch,
      },
    }));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The multi-row write set, built from BOTH pools' computed allocations
  // (Apply is atomic across pools now). Pure ads write directly; a split ad's
  // two portions combine into one real-ad update (allocation = base + added,
  // splitBaseAmount = base), each portion falling back to its existing value
  // when only the other was edited. Even/unchecked rows have no computed value
  // and are preserved.
  const buildUpdates = () => {
    const updates: Record<
      string,
      { allocation: number; splitBaseAmount?: number }
    > = {};
    const splitParts: Record<string, { base?: number; added?: number }> = {};
    for (const pool of ['base', 'added'] as const) {
      const rows = pool === 'base' ? baseAds : addedAds;
      const allocs = meterOf(pool).allocations;
      for (const r of rows) {
        const v = allocs[r.id];
        if (v == null) continue;
        if (r.budgetSource === 'split') (splitParts[r.realId] ??= {})[pool] = v;
        else updates[r.id] = { allocation: v };
      }
    }
    for (const [realId, parts] of Object.entries(splitParts)) {
      const orig = plan.ads.find((o) => o.id === realId);
      if (!orig) continue;
      const c = adContribution(orig);
      const base = parts.base ?? c.baseAllocation;
      const added = parts.added ?? c.addedAllocation;
      updates[realId] = { allocation: base + added, splitBaseAmount: base };
    }
    return updates;
  };

  const includedCount = Object.keys(buildUpdates()).length;

  const handleApply = () => {
    const updates = buildUpdates();
    const withExisting = Object.keys(updates).filter((id) => {
      const orig = plan.ads.find((o) => o.id === id);
      return orig != null && (num(orig.allocation) ?? 0) > 0;
    });
    if (withExisting.length > 0) {
      if (
        !window.confirm(
          `${withExisting.length} ad${withExisting.length === 1 ? '' : 's'} already ${withExisting.length === 1 ? 'has' : 'have'} an allocation set. Overwrite?`,
        )
      ) {
        return;
      }
    }
    onApply(updates);
  };

  // One pool's meter strip (+ its Spread bar). Rendered once per active pool —
  // twice, stacked, on the dual-pool Split tab (each pool validated on its own
  // meter; base and added never net against each other, no combined total).
  const renderPoolPanel = (pool: Pool) => {
    const m = meterOf(pool);
    const s = spreadFor(pool);
    const accent = pool === 'base' ? COLORS.base : COLORS.added;
    const over = m.overAllocated;
    return (
      <div key={pool} className="mb-2">
        {view === 'split' && (
          <div className="flex items-center justify-between mb-1 px-0.5">
            <span className="text-[11px] font-semibold" style={{ color: accent }}>
              {pool === 'base' ? 'Base' : 'Added'} pool
            </span>
            <span className="text-[10px] text-[var(--muted-foreground)]">
              Total Budget {fmt(m.ceiling)}
            </span>
          </div>
        )}
        <div
          className={`grid shrink-0 gap-px rounded-lg bg-[var(--border)] ${
            calcMode === 'midflight' ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-2'
          }`}
        >
          {calcMode === 'midflight' && (
            <>
              <CompactStat label="Initial" value={fmt(m.initial)} />
              <CompactStat
                label="Locked Spend"
                value={fmt(m.lockedSpend)}
                title={
                  m.lockedSpend > 0
                    ? 'Pacer spend on Off / Completed Run ads (locked at this value on Apply)'
                    : 'No locked ads yet — mark an ad Off or Completed Run'
                }
              />
              <CompactStat
                label="Remaining"
                value={fmt(m.anchor)}
                title={
                  m.preserved > 0
                    ? `${fmt(m.initial)} − ${fmt(m.lockedSpend)} locked − ${fmt(m.preserved)} preserved`
                    : m.lockedSpend > 0
                      ? `${fmt(m.initial)} − ${fmt(m.lockedSpend)} locked`
                      : 'Nothing freed yet'
                }
              />
            </>
          )}
          <CompactStat
            label="Entered"
            value={fmt(m.entered)}
            title={`Out of ${fmt(m.anchor)} to split`}
            color={
              over
                ? COLORS.error
                : m.unallocated < 0.005
                  ? COLORS.success
                  : COLORS.warn
            }
          />
          <CompactStat
            label={over ? 'Over' : 'Unallocated'}
            value={fmt(Math.abs(m.unallocated))}
            title={
              over
                ? 'Reduce locked rows or raise total'
                : m.unallocated < 0.005
                  ? 'Fully allocated'
                  : s.evenRows.length > 0
                    ? `${s.evenRows.length} row${s.evenRows.length === 1 ? '' : 's'} waiting for Spread`
                    : 'Not assigned to any ad'
            }
            color={over ? COLORS.error : undefined}
          />
        </div>
        {s.canSpread && (
          <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-1.5 mt-1">
            <div className="text-[11px] text-[var(--muted-foreground)] min-w-0 truncate">
              <span className="font-semibold text-[var(--foreground)]">{fmt(s.spreadPool)}</span>{' '}
              across{' '}
              <span className="font-semibold text-[var(--foreground)]">{s.evenRows.length}</span>{' '}
              row{s.evenRows.length === 1 ? '' : 's'} ={' '}
              <span className="font-semibold text-[var(--foreground)]">{fmt(s.perEven)}</span>{' '}
              each
            </div>
            <button
              type="button"
              onClick={() => handleSpread(pool)}
              className="px-3 py-1 text-[11px] font-semibold rounded-md bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 transition-colors whitespace-nowrap"
            >
              Spread{view === 'split' ? ` ${pool === 'base' ? 'Base' : 'Added'}` : ' remainder'}
            </button>
          </div>
        )}
      </div>
    );
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:pt-12 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-modal w-full max-w-3xl rounded-xl p-5 max-h-[95vh] flex flex-col"
      >
        <div className="flex shrink-0 items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-bold text-[var(--foreground)]">
              Budget Calculator
            </h3>
            <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
              {calcMode === 'setup'
                ? `Plan a fresh allocation across the ${view === 'base' ? 'Base' : view === 'added' ? 'Added' : 'Split'} ads.`
                : `Reallocate after spending. Donors (Off / Completed Run) auto-lock at Pacer spend; their freed budget redistributes to active ads.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Mode + Source tabs — paired on one row so they don't each
            consume a full strip's worth of vertical space. */}
        <div className="flex shrink-0 items-center flex-wrap gap-2 mb-3">
        <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 self-start">
          {(
            [
              { key: 'setup', label: 'Initial Setup' },
              { key: 'midflight', label: 'Mid-flight Reallocation' },
            ] as const
          ).map((m) => {
            const active = calcMode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setCalcMode(m.key)}
                className={`px-3 py-1 text-[11px] font-medium rounded transition-colors ${
                  active
                    ? 'bg-[var(--primary)] text-white'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Pool view tabs (Base / Added / Split) — same row as the Mode tabs.
            Base/Added are single-pool; Split is the dual-pool view (split ads
            only, both meters). Active fill uses the pool's accent color. */}
        <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 self-start">
          {(['base', 'added', 'split'] as const).map((v) => {
            const active = view === v;
            const count = plan.ads.filter((a) => a.budgetSource === v).length;
            const accent =
              v === 'base' ? COLORS.base : v === 'added' ? COLORS.added : sourceColor('split');
            return (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-3 py-1 text-[11px] font-medium rounded transition-colors ${
                  active
                    ? 'text-white'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
                style={active ? { background: accent } : undefined}
              >
                {v === 'base' ? 'Base' : v === 'added' ? 'Added' : 'Split'} ({count})
              </button>
            );
          })}
        </div>

        {/* Total budget — single-pool views show the pool ceiling here; the
            Split view shows each pool's Total in its own panel (no combined
            account total, which would imply base + added are fungible). */}
        {view !== 'split' && (
          <Tooltip
            label="Client budget goal × margin for this pool"
            className="ml-auto self-center"
          >
            <div className="text-right">
              <span className="block text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] leading-none">
                Total Budget
              </span>
              <span className="block text-base font-bold tabular-nums text-[var(--foreground)] leading-tight">
                {fmt(view === 'base' ? baseCeiling : addedCeiling)}
              </span>
            </div>
          </Tooltip>
        )}
        </div>

        {/* Per-pool meter strip(s) + Spread — one panel for a single-pool
            view, both (stacked) for the dual-pool Split view. */}
        <div className="shrink-0 mb-1">{viewPools.map(renderPoolPanel)}</div>

        {/* Ad list */}
        <div className="themed-scrollbar overflow-y-auto -mx-2 px-2 flex-1 min-h-0">
          {viewRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border)] py-8 text-center text-xs text-[var(--muted-foreground)]">
              No {view === 'base' ? 'Base' : view === 'added' ? 'Added' : 'Split'} ads
              in this period yet.
            </div>
          ) : (
            <div className="space-y-2">
              {viewRows.map((ad) => {
                const spec = specs[ad.id] ?? DEFAULT_SPEC;
                const allocated = allocations[ad.id] ?? 0;
                const currentAllocation = num(ad.allocation) ?? 0;
                const currentSpent = num(ad.pacerActual) ?? 0;
                const flightDays =
                  ad.flightStart && ad.flightEnd
                    ? calcDays(ad.flightStart, ad.flightEnd)
                    : 0;
                const dailyRate =
                  ad.budgetType === 'Daily' && flightDays > 0
                    ? allocated / flightDays
                    : null;
                // Donor rows are auto-handled (status Off / Completed Run) —
                // their allocation locks at pacerActual and is excluded from
                // "Entered" in BOTH modes (computeAllocations / enteredSoFar
                // aren't mode-gated). So lock + label the row in Setup too,
                // matching mid-flight, instead of showing an editable control
                // that's silently ignored.
                const adIsDonor =
                  ad.adStatus === 'Off' || ad.adStatus === 'Completed Run';
                // Block applying an allocation below what's already been spent;
                // the input flag turns red and the modal-level Apply disables.
                const underSpent =
                  spec.included &&
                  spec.mode === 'amount' &&
                  spec.amount.trim() !== '' &&
                  (num(spec.amount) ?? 0) < currentSpent - 0.005;
                return (
                  <div
                    key={ad.id}
                    className={`grid grid-cols-1 md:grid-cols-[28px_1fr_140px_140px_140px] gap-2 items-center rounded-lg border bg-[var(--card)] px-3 py-2 ${
                      spec.included
                        ? 'border-[var(--border)]'
                        : 'border-[var(--border)] opacity-60'
                    }`}
                  >
                    <Tooltip
                      label={
                        spec.included
                          ? 'Uncheck to leave this ad untouched on Apply'
                          : 'This ad keeps its current allocation on Apply'
                      }
                    >
                    <label
                      className="flex items-center justify-center cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={spec.included}
                        onChange={(e) =>
                          updateSpec(ad.id, { included: e.target.checked })
                        }
                        className="w-4 h-4 accent-[var(--primary)]"
                      />
                    </label>
                    </Tooltip>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[var(--foreground)] truncate">
                        {ad.name || 'Untitled Ad'}
                      </div>
                      <div className="text-[10px] text-[var(--muted-foreground)]">
                        {ad.budgetType}
                        {flightDays > 0 ? ` · ${flightDays} days` : ''}
                        {ad.budgetSource === 'split' && (
                          <span style={{ color: sourceColor('split') }}>
                            {' '}· Split ({rowPool(ad) === 'base' ? 'Base' : 'Added'}{' '}
                            portion)
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                        {currentAllocation > 0 ? (
                          <>
                            Allocated{' '}
                            <span className="font-semibold">
                              {fmt(currentAllocation)}
                            </span>
                          </>
                        ) : (
                          <span className="italic">no allocation yet</span>
                        )}
                      </div>
                      {calcMode === 'midflight' && (
                        <div className="mt-1.5 text-[10px] text-[var(--muted-foreground)]">
                          Spent{' '}
                          <span className="font-semibold text-[var(--foreground)] tabular-nums">
                            {fmt(currentSpent)}
                          </span>
                          <span className="ml-1 italic">(from Pacer)</span>
                        </div>
                      )}
                    </div>
                    {adIsDonor ? (
                      <Tooltip
                        label={`Locked — status is ${ad.adStatus}. Allocation locks at Pacer spend on Apply.`}
                      >
                      <div
                        className="flex items-center gap-1 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--muted)]/60 text-[11px] text-[var(--muted-foreground)]"
                      >
                        <LockClosedIcon className="w-3 h-3 flex-shrink-0" />
                        <span>Locked</span>
                      </div>
                      </Tooltip>
                    ) : (
                      <select
                        value={spec.mode}
                        disabled={!spec.included}
                        onChange={(e) =>
                          updateSpec(ad.id, {
                            mode: e.target.value as AllocationMode,
                          })
                        }
                        className={`${inputClass} text-[11px] py-1.5 disabled:opacity-50`}
                      >
                        <option value="even">Distribute evenly</option>
                        <option value="amount">Set amount</option>
                        <option value="client">Client Budget (gross)</option>
                        <option value="percent">Set %</option>
                        {calcMode === 'midflight' && (
                          <option value="off">Off — lock at spent</option>
                        )}
                      </select>
                    )}
                    <div>
                      {adIsDonor ? (
                        <div className="text-[10px] text-[var(--muted-foreground)] italic px-2 py-1.5">
                          {fmt(currentSpent)} locked
                        </div>
                      ) : (
                        <>
                          {spec.included && spec.mode === 'amount' && (
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 min-w-0">
                                <DollarInput
                                  value={spec.amount}
                                  onChange={(v) => updateSpec(ad.id, { amount: v })}
                                  placeholder="0.00"
                                />
                              </div>
                              {underSpent && (
                                <Tooltip
                                  label={`Below ${fmt(currentSpent)} already spent`}
                                >
                                  <ExclamationTriangleIcon
                                    className="w-4 h-4 flex-shrink-0"
                                    style={{ color: COLORS.error }}
                                  />
                                </Tooltip>
                              )}
                            </div>
                          )}
                          {spec.included && spec.mode === 'percent' && (
                            <div className="relative">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={spec.percent}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === '' || /^\d*\.?\d*$/.test(v)) {
                                    updateSpec(ad.id, { percent: v });
                                  }
                                }}
                                placeholder="0"
                                className={`${inputClass} pr-7`}
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)] pointer-events-none">
                                %
                              </span>
                            </div>
                          )}
                          {spec.included && spec.mode === 'client' && (
                            <div>
                              <DollarInput
                                value={spec.clientAmount}
                                onChange={(v) =>
                                  updateSpec(ad.id, { clientAmount: v ?? '' })
                                }
                                placeholder="0.00"
                              />
                              {spec.clientAmount.trim() !== '' && (
                                <p className="text-[10px] mt-0.5 text-[var(--muted-foreground)]">
                                  × {effectiveMarkup} ={' '}
                                  <span className="font-semibold text-[var(--foreground)]">
                                    {fmt(
                                      (num(spec.clientAmount) ?? 0) *
                                        effectiveMarkup,
                                    )}
                                  </span>{' '}
                                  actual
                                </p>
                              )}
                            </div>
                          )}
                          {spec.included && spec.mode === 'even' && (
                            <div className="text-[10px] text-[var(--muted-foreground)] italic px-2 py-1.5">
                              waiting for Spread
                            </div>
                          )}
                          {spec.included && spec.mode === 'off' && (
                            <div className="text-[10px] text-[var(--muted-foreground)] italic px-2 py-1.5">
                              locked at {fmt(currentSpent)}
                            </div>
                          )}
                          {!spec.included && (
                            <div className="text-[10px] text-[var(--muted-foreground)] italic px-2 py-1.5">
                              left as-is
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    {adIsDonor && spec.included ? (
                      <div className="text-right">
                        <div
                          className="text-sm font-bold"
                          style={{ color: COLORS.success }}
                        >
                          {fmt(currentAllocation - currentSpent)}
                        </div>
                        <div className="text-[10px] text-[var(--muted-foreground)]">
                          available
                        </div>
                      </div>
                    ) : (
                      <div className="text-right">
                        <div
                          className="text-sm font-bold"
                          style={{
                            color:
                              !spec.included || spec.mode === 'even'
                                ? 'var(--muted-foreground)'
                                : sourceColor(ad.budgetSource),
                          }}
                        >
                          {!spec.included
                            ? fmt(currentAllocation)
                            : spec.mode === 'even'
                              ? '—'
                              : fmt(allocated)}
                        </div>
                        {dailyRate != null && spec.included && (
                          <div className="text-[10px] text-[var(--muted-foreground)]">
                            {fmt(dailyRate)}/day · {flightDays}d
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] hover:bg-[var(--muted)]"
          >
            Cancel
          </button>
          {hasUnderSpent || overBudget ? (
            <Tooltip
              label={
                hasUnderSpent
                  ? 'One or more amounts are below the already-spent value'
                  : 'Allocations exceed the total budget'
              }
            >
              <button
                type="button"
                onClick={handleApply}
                disabled={includedCount === 0 || overBudget || hasUnderSpent}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--primary)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--primary)]/90 transition-colors"
              >
                Apply to {includedCount} ad{includedCount === 1 ? '' : 's'}
              </button>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={handleApply}
              disabled={includedCount === 0 || overBudget || hasUnderSpent}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--primary)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--primary)]/90 transition-colors"
            >
              Apply to {includedCount} ad{includedCount === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
