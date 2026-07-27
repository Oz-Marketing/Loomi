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
import { CompactStat } from './metrics';
import { DollarInput, inputClass } from './inputs';
import { Tooltip } from './Tooltip';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';

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
type AllocationMode = 'even' | 'amount' | 'percent' | 'off' | 'client';

interface AdAllocSpec {
  mode: AllocationMode;
  amount: string; // when mode === 'amount'
  percent: string; // when mode === 'percent'
  // when mode === 'client': the gross/billable amount the user types.
  // computeAllocations multiplies it by the effective markup to produce
  // the actual-spend value written on Apply.
  clientAmount: string;
  included: boolean; // when false the row is ignored — its current allocation stays put
}

const DEFAULT_SPEC: AdAllocSpec = {
  mode: 'even',
  amount: '',
  percent: '',
  clientAmount: '',
  included: true,
};

/**
 * Builds the per-ad allocation map for the Budget Calculator.
 *
 * Priority order per row:
 *   1. Status "Off" / "Completed Run" → locked; allocation snaps to
 *      `pacerActual` (the Pacer page's tracked spend). Its unspent
 *      portion (alloc − pacerActual) feeds the redistribution pool.
 *   2. Mode "off" → same lock behavior (explicit user choice).
 *   3. Mode "amount" → explicit actual-spend dollar value.
 *   4. Mode "client" → gross/billable dollars × `markup` = actual spend.
 *      Used when the rep is given a client-facing number instead of the
 *      internal actual-spend number.
 *   5. Mode "percent" → percentage of `pool`. In mid-flight the pool is
 *      Remaining-to-Split (Initial − Locked Spend − Excluded Preserved);
 *      in setup mode the pool is just the Total Budget.
 *   6. Mode "even" → skipped here; user must click Spread to convert it
 *      to amount mode at that moment.
 * Excluded rows (`included === false`) are left out entirely — the parent
 * preserves their existing allocation on Apply.
 */
/**
 * Split `total` dollars into `n` parts that sum back to `total` EXACTLY to the
 * cent (12a). Equal shares, with leftover cents handed to the first rows — so
 * "distribute evenly" never leaves a phantom remainder from rounding each row
 * independently. Operates in integer cents; rounds only at the very end.
 */
function splitToCents(total: number, n: number): number[] {
  if (n <= 0) return [];
  const cents = Math.round(total * 100);
  const base = Math.trunc(cents / n);
  let remainder = cents - base * n; // 0..n-1 leftover cents
  return Array.from({ length: n }, () => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return (base + extra) / 100;
  });
}

function computeAllocations(
  ads: PacerAd[],
  pool: number,
  markup: number,
  specs: Record<string, AdAllocSpec>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ad of ads) {
    const spec = specs[ad.id] ?? DEFAULT_SPEC;
    if (!spec.included) continue;

    const statusDonor =
      ad.adStatus === 'Off' || ad.adStatus === 'Completed Run';
    if (statusDonor) {
      out[ad.id] = num(ad.pacerActual) ?? 0;
      continue;
    }

    if (spec.mode === 'off') {
      out[ad.id] = num(ad.pacerActual) ?? 0;
    } else if (spec.mode === 'amount') {
      out[ad.id] = num(spec.amount) ?? 0;
    } else if (spec.mode === 'client') {
      const gross = num(spec.clientAmount) ?? 0;
      out[ad.id] = gross * markup;
    } else if (spec.mode === 'percent') {
      const pct = num(spec.percent) ?? 0;
      out[ad.id] = (pool * pct) / 100;
    }
    // even mode: skipped — user must click Spread to assign values.
  }
  return out;
}

export function BudgetCalculatorModal({
  plan,
  onClose,
  onApply,
}: {
  plan: PacerPlan;
  onClose: () => void;
  onApply: (
    updates: Record<
      string,
      { allocation: number; splitBaseAmount?: number; adStatus?: string }
    >,
  ) => void;
}) {
  const [source, setSource] = useState<'base' | 'added'>('base');
  // Setup = fresh planning (clean slate, no spent column).
  // Mid-flight = adjusting allocations after some spend has happened (shows
  // spent per row, exposes "Off — lock at spent" to wind ads down and free
  // their remaining budget for the rest).
  const [calcMode, setCalcMode] = useState<'setup' | 'midflight'>('setup');

  // Split ads draw from BOTH pools (12b), so they appear in each source view
  // editing only that source's portion. We project a split ad to a pseudo-ad
  // with a SOURCE-QUALIFIED id ("<id>::base" / "<id>::added") whose allocation
  // and pacerActual are that source's portion — so every keyed-by-id helper,
  // spec, and row below works unchanged, and the two portions stay independent
  // across the source toggle. handleApply maps the qualified ids back.
  const sourceAds = useMemo(() => {
    const single = plan.ads.filter((a) => a.budgetSource === source);
    const split = plan.ads
      .filter((a) => a.budgetSource === 'split')
      .map((a) => {
        const c = adContribution(a);
        return {
          ...a,
          id: `${a.id}::${source}`,
          allocation: String(
            source === 'base' ? c.baseAllocation : c.addedAllocation,
          ),
          pacerActual: String(
            source === 'base' ? c.baseSpent : c.addedSpent,
          ),
        };
      });
    return [...single, ...split];
  }, [plan.ads, source]);
  // Effective markup — per-account override (Account.markup) when set,
  // otherwise the global default. Used here to convert the gross client
  // goal into the actual-spend default, and below for Client Budget mode.
  const effectiveMarkup = effMarkupOf(plan.markup);
  const goal =
    source === 'base' ? num(plan.baseBudgetGoal) : num(plan.addedBudgetGoal);
  const defaultBudget =
    goal != null ? Math.round(goal * effectiveMarkup * 100) / 100 : 0;

  // Total budget is fixed to the source's actual-spend goal (client budget ×
  // markup) — not editable; shown read-only next to the tabs.
  const totalBudget = defaultBudget;

  // (Per-row "Already Spent" inputs live on each AdAllocSpec; the pool
  // total is summed below in `totalSpent`.)

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
  // locked at pacerActual on Apply). Receiver = anything else.
  const isDonor = (a: PacerAd) =>
    a.adStatus === 'Off' || a.adStatus === 'Completed Run';

  // Source pool summary. sourceAds already carries each split ad's per-source
  // portion (projected, qualified id), so these sums cover split ads with no
  // separate handling.
  // * Initially Allocated = source-portion allocations at modal open (the ad
  //   isn't mutated until Apply, so the live value equals the opening value).
  // * Locked Spend        = Σ pacerActual for status-locked ads (Off/Completed).
  // * Excluded Preserved  = Σ existing allocation for unchecked rows.
  // * Remaining to Split  = Mid-flight: Initial − Locked − Excluded; Setup mode:
  //   just the Total Budget.
  const initiallyAllocated = sourceAds.reduce(
    (s, a) => s + (num(a.allocation) ?? 0),
    0,
  );
  const lockedSpend =
    calcMode === 'midflight'
      ? sourceAds.reduce(
          (s, a) => (isDonor(a) ? s + (num(a.pacerActual) ?? 0) : s),
          0,
        )
      : 0;
  const excludedPreserved =
    calcMode === 'midflight'
      ? sourceAds.reduce((s, a) => {
          const spec = specs[a.id] ?? DEFAULT_SPEC;
          return spec.included ? s : s + (num(a.allocation) ?? 0);
        }, 0)
      : 0;
  const remainingToSplit =
    calcMode === 'midflight'
      ? Math.max(0, initiallyAllocated - lockedSpend - excludedPreserved)
      : totalBudget;

  // Allocations — uses remainingToSplit (not totalBudget) as the base for
  // percent-mode rows, so "Set 75%" means 75% of the redistribution pool
  // the user is actually distributing, not 75% of the gross ceiling.
  // effectiveMarkup (declared above) powers the Client Budget mode.
  const allocations = useMemo(
    () => computeAllocations(sourceAds, remainingToSplit, effectiveMarkup, specs),
    [sourceAds, remainingToSplit, effectiveMarkup, specs],
  );

  // Active-row commitments — what the user has explicitly typed for
  // receivers (amount/percent/off). Donor rows are auto-locked via
  // status and already reflected in lockedSpend. Excluded rows preserve
  // their existing allocation. Even-mode receiver rows skip here — they
  // only get a value once the user clicks Spread.
  const enteredSoFar = sourceAds.reduce((s, a) => {
    const spec = specs[a.id] ?? DEFAULT_SPEC;
    if (!spec.included) return s;
    if (isDonor(a)) return s;
    const v = allocations[a.id];
    return v == null ? s : s + v;
  }, 0);
  const stillToAllocate = remainingToSplit - enteredSoFar;
  const overAllocated = stillToAllocate < -0.005;
  // overBudget reuses the same semantic as before so the existing Apply
  // guard ("can't apply when over") still kicks in.
  const overBudget = overAllocated;

  // Spread state — only included, non-donor, even-mode rows are
  // candidates for the remainder. Donors are locked at pacerActual and
  // must not be overwritten by the spread.
  const evenRowsForSpread = sourceAds.filter((a) => {
    const spec = specs[a.id] ?? DEFAULT_SPEC;
    if (isDonor(a)) return false;
    return spec.included && spec.mode === 'even';
  });
  const spreadPool = Math.max(0, stillToAllocate);
  // Mid-flight mode gates Spread on there being at least one donor (an
  // ad with status Off or Completed Run that contributed to the pool).
  // Without a donor, there's nothing being freed and the pool is just
  // the existing allocations. Setup mode has no donor concept, so
  // Spread is always available there.
  const spentGateOk = calcMode !== 'midflight' || lockedSpend > 0;
  const canSpread =
    evenRowsForSpread.length > 0 && spreadPool > 0.005 && spentGateOk;
  const perEvenPreview = canSpread ? spreadPool / evenRowsForSpread.length : 0;

  const handleSpread = () => {
    if (!canSpread) return;
    pushSnapshot(null); // one undo level reverts every row the spread wrote
    // Cent-accurate shares that sum to the pool exactly — no phantom residual
    // from rounding each row independently (12a).
    const shares = splitToCents(spreadPool, evenRowsForSpread.length);
    setSpecs((prev) => {
      const next = { ...prev };
      evenRowsForSpread.forEach((ad, i) => {
        const existing = next[ad.id] ?? DEFAULT_SPEC;
        next[ad.id] = {
          ...existing,
          mode: 'amount',
          amount: shares[i].toFixed(2),
          percent: '',
          clientAmount: existing.clientAmount,
          included: true,
        };
      });
      return next;
    });
  };

  // Any included "Set amount" row whose value sits below its already-spent
  // amount blocks Apply — you can't allocate less than you've already paid.
  const hasUnderSpent = sourceAds.some((a) => {
    const spec = specs[a.id] ?? DEFAULT_SPEC;
    if (!spec.included || spec.mode !== 'amount') return false;
    if (spec.amount.trim() === '') return false;
    const v = num(spec.amount) ?? 0;
    const spent = num(a.pacerActual) ?? 0;
    return v < spent - 0.005;
  });

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
    // New mode = a fresh opening state; the undo history from the old mode no
    // longer applies.
    const seeded = seedSpecsForMode(calcMode);
    setSpecs(seeded);
    openingSpecsRef.current = seeded;
    setUndoStack([]);
    lastEditKeyRef.current = null;
  }, [calcMode, seedSpecsForMode]);

  // ── Undo / Clear ──────────────────────────────────────────────────────────
  // A snapshot stack scoped to this modal session (cleared on close/Apply). A
  // snapshot of the CURRENT specs is pushed just before a mutation; consecutive
  // edits to the same field coalesce into one step (so typing is one undo, not
  // one per keystroke), while discrete actions (checkbox, mode change, Spread)
  // each get their own. Clear jumps back to the opening state.
  const openingSpecsRef = useRef(specs);
  const [undoStack, setUndoStack] = useState<Record<string, AdAllocSpec>[]>([]);
  const lastEditKeyRef = useRef<string | null>(null);
  const pushSnapshot = (editKey: string | null) => {
    if (editKey != null && editKey === lastEditKeyRef.current) return;
    lastEditKeyRef.current = editKey;
    setUndoStack((st) => [...st, specs]);
  };
  const undo = () => {
    setUndoStack((st) => {
      if (st.length === 0) return st;
      setSpecs(st[st.length - 1]);
      lastEditKeyRef.current = null;
      return st.slice(0, -1);
    });
  };
  const clearEdits = () => {
    setSpecs(openingSpecsRef.current);
    setUndoStack([]);
    lastEditKeyRef.current = null;
  };

  const updateSpec = (adId: string, patch: Partial<AdAllocSpec>) => {
    // Text edits (amount/percent/client) coalesce into one undo step per field;
    // discrete changes (mode, checkbox) each snapshot on their own.
    const textField = Object.keys(patch).find(
      (k) => k === 'amount' || k === 'percent' || k === 'clientAmount',
    );
    pushSnapshot(textField ? `${adId}:${textField}` : null);
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
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Count of rows the Apply button will actually write to — only rows
  // with a computed allocation (amount/percent/off). Even-mode rows are
  // skipped until the user spreads them, so they don't count here.
  const includedCount = sourceAds.filter(
    (a) => allocations[a.id] != null,
  ).length;

  const handleApply = () => {
    // Only ask about overwrite for rows that will actually be written AND
    // already have an allocation. Even-mode rows are skipped on Apply.
    const adsWithExisting = sourceAds.filter((a) => {
      if (allocations[a.id] == null) return false;
      const existing = num(a.allocation);
      return existing != null && existing > 0;
    });
    if (adsWithExisting.length > 0) {
      if (
        !window.confirm(
          `${adsWithExisting.length} ad${adsWithExisting.length === 1 ? '' : 's'} in ${source === 'base' ? 'Base' : 'Added'} already ${adsWithExisting.length === 1 ? 'has' : 'have'} an allocation set. Overwrite?`,
        )
      ) {
        return;
      }
    }
    // Map computed (source-portion) values back to real ads. For a Split ad,
    // set splitBaseAmount + combined allocation, preserving the OTHER source's
    // portion that this view didn't touch.
    const updates: Record<
      string,
      { allocation: number; splitBaseAmount?: number; adStatus?: string }
    > = {};
    for (const a of sourceAds) {
      const v = allocations[a.id];
      if (v == null) continue;
      if (a.budgetSource === 'split') {
        const realId = a.id.split('::')[0];
        const orig = plan.ads.find((o) => o.id === realId);
        if (!orig) continue;
        const c = adContribution(orig);
        const base = source === 'base' ? v : c.baseAllocation;
        const added = source === 'added' ? v : c.addedAllocation;
        updates[realId] = { allocation: base + added, splitBaseAmount: base };
      } else {
        // Calc-local "Off — lock at spent": commit the ad Off in the planner AND
        // lock its allocation at the freed value (its Pacer spend), so winding
        // it down and going Off are one action.
        const spec = specs[a.id] ?? DEFAULT_SPEC;
        updates[a.id] =
          spec.mode === 'off'
            ? { allocation: v, adStatus: 'Off' }
            : { allocation: v };
      }
    }
    onApply(updates);
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
                ? `Plan a fresh allocation across the ${source === 'base' ? 'Base' : 'Added'} ads.`
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

        {/* Source tabs (Base / Added) — sit on the same row as Mode
            tabs to save vertical space. Active fill uses each source's
            accent color (Base = blue, Added = green). */}
        <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 self-start">
          {(['base', 'added'] as const).map((s) => {
            const active = source === s;
            const count = plan.ads.filter((a) => a.budgetSource === s).length;
            const accent = s === 'base' ? COLORS.base : COLORS.added;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                className={`px-3 py-1 text-[11px] font-medium rounded transition-colors ${
                  active
                    ? 'text-white'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
                style={active ? { background: accent } : undefined}
              >
                {s === 'base' ? 'Base' : 'Added'} ({count})
              </button>
            );
          })}
        </div>

        {/* Total budget — fixed to the source's goal (client × markup), shown
            read-only on the right of the tabs. */}
        <Tooltip
          label="Client budget goal × margin for this source"
          className="ml-auto self-center"
        >
        <div className="text-right">
          <span className="block text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] leading-none">
            Total Budget
          </span>
          <span className="block text-base font-bold tabular-nums text-[var(--foreground)] leading-tight">
            {fmt(totalBudget)}
          </span>
        </div>
        </Tooltip>
        </div>

        {/* Compact stat strip — Mid-flight: 5 cells (Initial, Locked Spend,
            Remaining, Entered, Still). Setup: 2 cells (Entered, Still). */}
        <div
          className={`grid shrink-0 gap-px mb-3 rounded-lg bg-[var(--border)] ${
            calcMode === 'midflight'
              ? 'grid-cols-2 md:grid-cols-5'
              : 'grid-cols-2'
          }`}
        >
          {calcMode === 'midflight' && (
            <>
              <CompactStat
                label="Initial"
                value={fmt(initiallyAllocated)}
                title={`${sourceAds.length} ${source === 'base' ? 'Base' : 'Added'} ad${sourceAds.length === 1 ? '' : 's'}`}
              />
              <CompactStat
                label="Locked Spend"
                value={fmt(lockedSpend)}
                title={
                  lockedSpend > 0
                    ? 'Pacer spend on Off / Completed Run ads (locked at this value on Apply)'
                    : 'No locked ads yet — mark an ad Off or Completed Run'
                }
              />
              <CompactStat
                label="Remaining"
                value={fmt(remainingToSplit)}
                title={
                  excludedPreserved > 0
                    ? `${fmt(initiallyAllocated)} − ${fmt(lockedSpend)} locked − ${fmt(excludedPreserved)} preserved`
                    : lockedSpend > 0
                      ? `${fmt(initiallyAllocated)} − ${fmt(lockedSpend)} locked`
                      : 'Nothing freed yet'
                }
              />
            </>
          )}
          <CompactStat
            label="Entered"
            value={fmt(enteredSoFar)}
            title={`Out of ${fmt(remainingToSplit)} to split`}
            color={
              overAllocated
                ? COLORS.error
                : stillToAllocate < 0.005
                  ? COLORS.success
                  : COLORS.warn
            }
          />
          <CompactStat
            label={overAllocated ? 'Over' : 'Unallocated'}
            value={fmt(Math.abs(stillToAllocate))}
            title={
              overAllocated
                ? 'Reduce locked rows or raise total'
                : stillToAllocate < 0.005
                  ? 'Fully allocated'
                  : evenRowsForSpread.length > 0
                    ? `${evenRowsForSpread.length} row${evenRowsForSpread.length === 1 ? '' : 's'} waiting for Spread`
                    : 'Not assigned to any ad'
            }
            color={overAllocated ? COLORS.error : undefined}
          />
        </div>

        {/* Spread button — only shows when there's a positive remainder
            AND at least one included even-mode row to absorb it. Click
            converts those rows to amount mode at the computed per-row
            share. No auto-recalc afterward. */}
        {canSpread && (
          <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-1.5 mb-2">
            <div className="text-[11px] text-[var(--muted-foreground)] min-w-0 truncate">
              <span className="font-semibold text-[var(--foreground)]">
                {fmt(spreadPool)}
              </span>{' '}
              across{' '}
              <span className="font-semibold text-[var(--foreground)]">
                {evenRowsForSpread.length}
              </span>{' '}
              row{evenRowsForSpread.length === 1 ? '' : 's'} ={' '}
              <span className="font-semibold text-[var(--foreground)]">
                {fmt(perEvenPreview)}
              </span>{' '}
              each
            </div>
            <button
              type="button"
              onClick={handleSpread}
              className="px-3 py-1 text-[11px] font-semibold rounded-md bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 transition-colors whitespace-nowrap"
            >
              Spread remainder
            </button>
          </div>
        )}

        {/* Ad list */}
        <div className="themed-scrollbar overflow-y-auto -mx-2 px-2 flex-1 min-h-0">
          {sourceAds.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border)] py-8 text-center text-xs text-[var(--muted-foreground)]">
              No {source === 'base' ? 'Base' : 'Added'} ads in this period yet.
            </div>
          ) : (
            <div className="space-y-2">
              {sourceAds.map((ad) => {
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
                            {' '}· Split ({source === 'base' ? 'Base' : 'Added'}{' '}
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
                      <SearchableSelect
                        value={spec.mode}
                        disabled={!spec.included}
                        onChange={(v) =>
                          updateSpec(ad.id, { mode: v as AllocationMode })
                        }
                        options={[
                          { value: 'even', label: 'Distribute evenly' },
                          { value: 'amount', label: 'Set amount' },
                          { value: 'client', label: 'Client Budget (gross)' },
                          { value: 'percent', label: 'Set %' },
                          ...(calcMode === 'midflight'
                            ? [{ value: 'off', label: 'Off — lock at spent' }]
                            : []),
                        ]}
                        className="text-[11px]"
                        popoverClassName="[&_button]:text-[11px] [&_button]:py-1.5"
                      />
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

        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-[var(--border)]">
          {/* Undo steps back one snapshot; Clear jumps to the opening state.
              Both disabled until there's an edit to undo. */}
          <button
            type="button"
            onClick={undo}
            disabled={undoStack.length === 0}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={clearEdits}
            disabled={undoStack.length === 0}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Clear
          </button>
          <div className="ml-auto flex gap-2">
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
      </div>
    </div>,
    document.body,
  );
}
