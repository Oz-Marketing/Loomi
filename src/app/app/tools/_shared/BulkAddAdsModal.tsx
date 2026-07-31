'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowsRightLeftIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { DatePicker } from '@/components/ui/date-picker';
import type { PacerAd, PacerPlan } from '@/lib/ad-pacer/types';
import { COLORS } from '@/lib/ad-pacer/constants';
import {
  adContribution,
  effMarkupOf,
  fmt,
  makeAd,
  num,
  sourceColor,
  splitToCents,
} from '@/lib/ad-pacer/helpers';
import { flightDatePresets, fmtPeriodLong } from '@/lib/ad-pacer/period';
import { DollarInput, inputClass, labelClass } from './inputs';
import { BudgetSourceToggle } from './toggles';
import { Tooltip } from './Tooltip';

type BudgetSource = 'base' | 'added' | 'split';
type Pool = 'base' | 'added';

interface DraftRow {
  key: string;
  name: string;
  budgetSource: BudgetSource;
  allocation: string;
  flightStart: string | null;
  flightEnd: string | null;
}

// One row to start — "Add row" is right there, and empty rows just add noise
// for the common case of adding a single ad.
const STARTING_ROWS = 1;
const POOLS: Pool[] = ['base', 'added'];

let rowSeq = 0;
function blankRow(): DraftRow {
  rowSeq += 1;
  return {
    key: `r${rowSeq}`,
    name: '',
    budgetSource: 'base',
    allocation: '',
    flightStart: null,
    flightEnd: null,
  };
}

/** A row the user has started filling in (so blanks can be ignored silently). */
function isTouched(r: DraftRow): boolean {
  return (
    r.name.trim() !== '' ||
    r.allocation.trim() !== '' ||
    r.flightStart != null ||
    r.flightEnd != null
  );
}

/**
 * One budget pool's state, matching what the planner's Base/Added cards show:
 * spend target = client goal × markup + carryover, minus what the plan's
 * existing ads already hold. `available` is what these new ads can draw on.
 */
function poolState(plan: PacerPlan, pool: Pool) {
  const goal = num(pool === 'base' ? plan.baseBudgetGoal : plan.addedBudgetGoal);
  const carryover =
    num(pool === 'base' ? plan.baseCarryover : plan.addedCarryover) ?? 0;
  const eff = effMarkupOf(plan.markup);
  const target = goal != null ? goal * eff + carryover : null;
  const existing = plan.ads.reduce((s, a) => {
    const c = adContribution(a);
    return s + (pool === 'base' ? c.baseAllocation : c.addedAllocation);
  }, 0);
  return {
    pool,
    target,
    existing,
    available: target != null ? target - existing : null,
  };
}

/**
 * Bulk ad creation. A spreadsheet-ish grid for the fields worth typing up front
 * — name (required), budget source, allocation, flight dates — with the
 * unallocated budget from the planner's Base/Added cards shown live per pool and
 * a spread that splits each pool's remainder across its own rows. Everything
 * else (creative, approvals, owner, pacing) is filled in afterwards by opening
 * the ad.
 */
export function BulkAddAdsModal({
  plan,
  onClose,
  onCreate,
}: {
  /** Live plan — supplies the period, the budget pools and the existing ads. */
  plan: PacerPlan;
  onClose: () => void;
  onCreate: (ads: PacerAd[]) => void;
}) {
  const period = plan.period;
  const [rows, setRows] = useState<DraftRow[]>(() =>
    Array.from({ length: STARTING_ROWS }, blankRow),
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patch = (key: string, next: Partial<DraftRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...next } : r)));
  const addRow = () => setRows((prev) => [...prev, blankRow()]);
  const removeRow = (key: string) =>
    setRows((prev) =>
      prev.length === 1 ? [blankRow()] : prev.filter((r) => r.key !== key),
    );

  // A name is all that's required — budget and dates can be filled in later,
  // inline on the plan table.
  const touched = rows.filter(isTouched);
  const unnamed = touched.filter((r) => r.name.trim() === '');
  const ready = touched.filter((r) => r.name.trim() !== '');

  const pools = useMemo(
    () => POOLS.map((p) => poolState(plan, p)),
    [plan],
  );
  // What these draft rows put into each pool. Split rows draw from both and
  // their portions aren't set here, so they're counted separately.
  const drafted = useMemo(() => {
    const out: Record<Pool, number> = { base: 0, added: 0 };
    let split = 0;
    for (const r of rows) {
      const amount = num(r.allocation) ?? 0;
      if (amount <= 0) continue;
      if (r.budgetSource === 'split') split += amount;
      else out[r.budgetSource] += amount;
    }
    return { ...out, split };
  }, [rows]);

  const spreadTargetsFor = (pool: Pool) =>
    rows.filter(
      (r) =>
        r.budgetSource === pool &&
        r.name.trim() !== '' &&
        (num(r.allocation) ?? 0) <= 0,
    );
  const spreadPlan = pools
    .map((p) => ({
      pool: p.pool,
      left: p.available != null ? p.available - drafted[p.pool] : null,
      targets: spreadTargetsFor(p.pool),
    }))
    .filter((p) => p.left != null && p.left > 0.005 && p.targets.length > 0);
  const canSpread = spreadPlan.length > 0;

  const spread = () => {
    if (!canSpread) return;
    const byKey = new Map<string, number>();
    for (const { left, targets } of spreadPlan) {
      const shares = splitToCents(left as number, targets.length);
      targets.forEach((r, i) => byKey.set(r.key, shares[i]));
    }
    setRows((prev) =>
      prev.map((r) =>
        byKey.has(r.key)
          ? { ...r, allocation: (byKey.get(r.key) ?? 0).toFixed(2) }
          : r,
      ),
    );
  };

  const clearAmounts = () =>
    setRows((prev) => prev.map((r) => ({ ...r, allocation: '' })));

  const handleCreate = () => {
    if (ready.length === 0) return;
    onCreate(
      ready.map((r, i) => {
        const amount = num(r.allocation);
        return {
          ...makeAd(plan.ads.length + i, period),
          name: r.name.trim(),
          budgetSource: r.budgetSource,
          allocation: amount != null && amount > 0 ? amount.toFixed(2) : null,
          flightStart: r.flightStart,
          flightEnd: r.flightEnd,
        };
      }),
    );
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto py-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="glass-modal relative mx-4 flex max-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="m-0 truncate text-lg font-bold text-[var(--foreground)]">
              Add ads · {fmtPeriodLong(period)}
            </h2>
            <p className="m-0 text-[11px] text-[var(--muted-foreground)]">
              Only the name is required — budget and flight dates can be filled
              in later, and creative and approvals live inside the ad.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Budget pools — read straight off the planner's Base/Added cards. */}
        <div className="flex flex-wrap items-center gap-4 border-b border-[var(--border)] bg-[var(--muted)]/30 px-5 py-3">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {pools.map((p) => {
              const allocating = drafted[p.pool];
              const left = p.available != null ? p.available - allocating : null;
              const over = left != null && left < -0.005;
              return (
                <div key={p.pool} className="min-w-[300px]">
                  <div
                    className="text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: sourceColor(p.pool) }}
                  >
                    {p.pool} budget
                  </div>
                  {p.available == null ? (
                    <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                      No goal set on the planner card
                    </div>
                  ) : (
                    <>
                      {/* Target spend leads — it's the figure being divided up;
                          allocating and what's left follow at pill size. */}
                      <div className="mt-0.5 flex items-baseline gap-1.5">
                        <span className="text-lg font-bold leading-tight tabular-nums text-[var(--foreground)]">
                          {fmt(p.target ?? 0)}
                        </span>
                        <span className="text-[10px] text-[var(--muted-foreground)]">
                          target&nbsp;·
                        </span>
                        <span className="text-sm font-bold tabular-nums text-[var(--foreground)]">
                          {fmt(allocating)}
                        </span>
                        <span className="text-[10px] text-[var(--muted-foreground)]">
                          allocating&nbsp;·
                        </span>
                        <span
                          className="text-sm font-bold tabular-nums"
                          style={{
                            color: over
                              ? COLORS.error
                              : Math.abs(left ?? 0) < 0.005
                                ? COLORS.success
                                : COLORS.warn,
                          }}
                        >
                          {fmt(Math.abs(left ?? 0))}
                        </span>
                        <span className="text-[10px] text-[var(--muted-foreground)]">
                          {over ? 'over' : 'unallocated'}
                        </span>
                      </div>
                      <div className="text-[10px] text-[var(--muted-foreground)]">
                        {fmt(p.existing)} on existing ads
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {drafted.split > 0 && (
              <span className="max-w-[190px] text-[10px] leading-snug text-[var(--muted-foreground)]">
                {fmt(drafted.split)} on split rows — set each one&apos;s base
                portion on the ad.
              </span>
            )}
            <Tooltip
              label={
                canSpread
                  ? spreadPlan
                      .map(
                        (p) =>
                          `${fmt(p.left as number)} across ${p.targets.length} ${p.pool} row${
                            p.targets.length === 1 ? '' : 's'
                          }`,
                      )
                      .join(' · ')
                  : 'Needs a named row with no amount in a pool that still has budget left'
              }
            >
              <button
                type="button"
                onClick={spread}
                disabled={!canSpread}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)]/10 px-3 py-2 text-xs font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowsRightLeftIcon className="h-3.5 w-3.5" />
                Spread unallocated
              </button>
            </Tooltip>
            {drafted.base + drafted.added + drafted.split > 0 && (
              <button
                type="button"
                onClick={clearAmounts}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              >
                Clear amounts
              </button>
            )}
          </div>
        </div>

        {/* Rows */}
        <div className="themed-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-2 hidden grid-cols-[1fr_240px_150px_240px_32px] gap-2.5 md:grid">
            <span className={labelClass}>Ad name</span>
            <span className={labelClass}>Budget source</span>
            <span className={labelClass}>Allocation</span>
            <span className={labelClass}>Flight dates</span>
            <span />
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => {
              const needsName = isTouched(r) && r.name.trim() === '';
              return (
                <div
                  key={r.key}
                  className="grid grid-cols-1 items-start gap-2.5 md:grid-cols-[1fr_240px_150px_240px_32px]"
                >
                  <div>
                    <input
                      value={r.name}
                      autoFocus={i === 0}
                      onChange={(e) => patch(r.key, { name: e.target.value })}
                      placeholder={`Ad ${i + 1} name…`}
                      aria-label={`Ad ${i + 1} name`}
                      className={inputClass}
                      style={
                        needsName ? { borderColor: COLORS.warn } : undefined
                      }
                    />
                    {needsName && (
                      <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-[var(--muted-foreground)]">
                        <ExclamationTriangleIcon
                          className="h-3 w-3"
                          style={{ color: COLORS.warn }}
                        />
                        Needs a name
                      </span>
                    )}
                  </div>
                  <BudgetSourceToggle
                    stretch
                    value={r.budgetSource}
                    onChange={(v) => patch(r.key, { budgetSource: v })}
                  />
                  <div style={{ color: sourceColor(r.budgetSource) }}>
                    <DollarInput
                      value={r.allocation}
                      onChange={(v) => patch(r.key, { allocation: v })}
                      placeholder="0.00"
                    />
                  </div>
                  <DatePicker
                    mode="range"
                    value={{ start: r.flightStart, end: r.flightEnd }}
                    onChange={(range) =>
                      patch(r.key, {
                        flightStart: range.start,
                        flightEnd: range.end,
                      })
                    }
                    placeholder="Pick a flight window"
                    presets={flightDatePresets(period)}
                  />
                  <Tooltip label="Remove row">
                    <button
                      type="button"
                      onClick={() => removeRow(r.key)}
                      aria-label="Remove row"
                      className="rounded-lg p-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-red-400"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </Tooltip>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={addRow}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/50 hover:text-[var(--foreground)]"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Add row
          </button>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3">
          <span className="text-[11px] text-[var(--muted-foreground)]">
            {unnamed.length > 0
              ? `${unnamed.length} row${unnamed.length === 1 ? '' : 's'} still ${
                  unnamed.length === 1 ? 'needs' : 'need'
                } a name.`
              : ready.length > 0
                ? `${ready.length} ad${ready.length === 1 ? '' : 's'} ready · ${fmt(
                    ready.reduce((s, r) => s + (num(r.allocation) ?? 0), 0),
                  )} allocated`
                : 'Blank rows are ignored.'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={ready.length === 0 || unnamed.length > 0}
              className="rounded-lg border border-[var(--primary)] bg-[var(--primary)]/90 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {ready.length > 1 ? `Create ${ready.length} ads` : 'Create ad'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
