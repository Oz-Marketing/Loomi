'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDownIcon,
  PlusIcon,
  DocumentDuplicateIcon,
  ClipboardDocumentListIcon,
} from '@heroicons/react/24/outline';
import type { PacerPlan, PeriodSummary } from '@/lib/ad-pacer/types';
import { COLORS, AD_COLORS } from '@/lib/ad-pacer/constants';
import { fmt, num, adContribution, effMarkupOf } from '@/lib/ad-pacer/helpers';
import { fmtPeriodShort, fmtPeriodLong, shiftPeriod } from '@/lib/ad-pacer/period';
import { Tooltip } from './Tooltip';
import { Field, DollarInput, readonlyClass } from './inputs';
import { MetricBox } from './metrics';
import { usePacerReadOnly } from './pacer-read-only';

export function BudgetPanel({
  title,
  source,
  color,
  goalKey,
  plan,
  onChange,
}: {
  title: string;
  source: 'base' | 'added';
  color: string;
  goalKey: 'baseBudgetGoal' | 'addedBudgetGoal';
  plan: PacerPlan;
  onChange: (p: PacerPlan) => void;
}) {
  const goal = num(plan[goalKey]);
  // Include split ads here too — their per-source portion contributes
  // to this pool's totals via adContribution. Pure-source ads only
  // contribute to one side, but a split ad contributes to both.
  const srcAds = plan.ads.filter(
    (a) => a.budgetSource === source || a.budgetSource === 'split',
  );
  const totalAlloc = plan.ads.reduce((s, a) => {
    const c = adContribution(a);
    return s + (source === 'base' ? c.baseAllocation : c.addedAllocation);
  }, 0);
  // Per-account markup override when set, else the global default.
  const effMarkup = effMarkupOf(plan.markup);
  // Carryover (Change 7) adjusts the DERIVED spend target only — the client
  // budget goal stays untouched. target = goal × markup + carryover.
  const carryover =
    num(source === 'base' ? plan.baseCarryover : plan.addedCarryover) ?? 0;
  const baseTarget = goal != null ? goal * effMarkup : null;
  const spendTarget = baseTarget != null ? baseTarget + carryover : null;
  const grossAlloc = Math.round((totalAlloc / effMarkup) * 100) / 100;
  const remaining = spendTarget != null ? spendTarget - totalAlloc : null;
  const allocPct =
    spendTarget != null && spendTarget > 0
      ? (totalAlloc / spendTarget) * 100
      : null;
  const allocStatus =
    allocPct == null ? null : allocPct > 105 ? 'over' : allocPct >= 95 ? 'perfect' : 'under';
  const statusColor =
    allocStatus === 'over'
      ? COLORS.error
      : allocStatus === 'perfect'
        ? COLORS.success
        : COLORS.warn;

  // Collapsed by default — the card condenses to a one-line summary plus the
  // allocation bar (the live feedback you want while allocating), and expands
  // for the goal input, metric boxes, and per-ad legend.
  const [expanded, setExpanded] = useState(false);

  // Per-ad allocation slices for the bar (+ legend when expanded). Lifted out
  // of the render so the compact and expanded layouts share them.
  const budgetCap = goal != null ? goal * effMarkup : 0;
  const poolEntries =
    goal != null && goal > 0
      ? srcAds
          .map((a, i) => {
            const c = adContribution(a);
            const portion =
              source === 'base' ? c.baseAllocation : c.addedAllocation;
            return { ad: a, portion, colorIdx: i };
          })
          .filter((e) => e.portion > 0)
      : [];

  return (
    <div
      onClick={() => setExpanded((v) => !v)}
      className="glass-section-card flex-1 min-w-[280px] cursor-pointer rounded-xl px-5 py-4"
    >

      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-bold uppercase tracking-wider"
            style={{ color }}
          >
            {title}
          </span>
          {allocStatus && (
            <span
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
              style={{
                background:
                  allocStatus === 'over'
                    ? 'rgba(239,68,68,0.18)'
                    : allocStatus === 'perfect'
                      ? 'rgba(34,197,94,0.18)'
                      : 'rgba(245,158,11,0.18)',
                color: statusColor,
              }}
            >
              {allocStatus === 'over'
                ? 'Over'
                : allocStatus === 'perfect'
                  ? 'Full'
                  : 'Under'}
            </span>
          )}
        </div>
        <Tooltip label={expanded ? 'Collapse' : 'Expand for budget goal & breakdown'}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse' : 'Expand for budget goal & breakdown'}
          className="inline-flex items-center justify-center w-6 h-6 rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <ChevronDownIcon
            className={`w-4 h-4 transition-transform duration-300 ${expanded ? '' : '-rotate-90'}`}
          />
        </button>
        </Tooltip>
      </div>

      {/* Compact summary (collapsed) — height-animated open/close. */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          expanded ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
        }`}
      >
        <div className="overflow-hidden">
          {/* Stacked label-over-value so the dollar figures read large at a
              glance (the live feedback while allocating); labels stay small. */}
          <div className="flex flex-wrap items-end gap-x-7 gap-y-2 pb-2.5">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                Goal
              </div>
              <div className="text-2xl font-bold tabular-nums leading-none text-[var(--foreground)]">
                {goal != null ? fmt(goal) : '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                Allocated
              </div>
              <div
                className="text-2xl font-bold tabular-nums leading-none"
                style={{ color: statusColor }}
              >
                {fmt(totalAlloc)}
              </div>
            </div>
            {goal != null && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                  {remaining != null && remaining < 0 ? 'Over' : 'Remaining'}
                </div>
                <div
                  className="text-2xl font-bold tabular-nums leading-none"
                  style={{
                    color:
                      remaining != null && remaining < 0
                        ? COLORS.error
                        : COLORS.success,
                  }}
                >
                  {fmt(Math.abs(remaining ?? 0))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Goal input + metric boxes (expanded) — height-animated open/close. */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          {/* Goal input row — stop clicks here from toggling the card so the
              user can focus/edit the goal without collapsing it. */}
          <div
            className="grid grid-cols-2 gap-2.5 pb-3.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Field label="Client Budget Goal (Gross)">
              <DollarInput
                value={plan[goalKey]}
                onChange={(v) => onChange({ ...plan, [goalKey]: v })}
                placeholder="0.00"
              />
            </Field>
            <Field label="Actual Spend Budget">
              <div
                className={`${readonlyClass} font-bold`}
                style={{ color }}
              >
                {spendTarget != null
                  ? fmt(Math.round(spendTarget * 100) / 100)
                  : '—'}
              </div>
              {/* When a carryover is applied, show the traceable breakdown so
                  the target always reads as "base × markup + carryover",
                  never a silently moved number. */}
              {carryover !== 0 && baseTarget != null && (
                <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5 leading-snug">
                  {fmt(Math.round(baseTarget * 100) / 100)}{' '}
                  {carryover >= 0 ? '+' : '−'} {fmt(Math.abs(carryover))} carried
                  from {fmtPeriodShort(shiftPeriod(plan.period, -1))}
                </div>
              )}
            </Field>
          </div>

          {/* Metric boxes */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pb-3.5">
            <MetricBox
              label="Gross Allocation"
              value={fmt(grossAlloc)}
              sub={carryover !== 0 ? 'client budget + carryover' : 'client budget'}
            />
            <MetricBox
              label="Total Allocated"
              value={fmt(totalAlloc)}
              sub="actual spend"
              color={
                allocPct != null
                  ? allocPct > 105
                    ? COLORS.error
                    : allocPct >= 95
                      ? COLORS.success
                      : COLORS.warn
                  : color
              }
            />
            {goal != null && (
              <MetricBox
                label="Remaining Budget"
                value={fmt(Math.abs(remaining ?? 0))}
                sub={remaining != null && remaining < 0 ? 'over budget' : 'unallocated'}
                color={remaining != null && remaining < 0 ? COLORS.error : COLORS.success}
              />
            )}
          </div>
        </div>
      </div>

      {/* Allocation bar — always visible (the key live feedback). Each slice is
          this pool's portion of an ad's allocation; for split ads that's the
          base/added portion only. The per-ad legend shows only when expanded. */}
      {goal != null && goal > 0 && (
        <>
          <div className="flex justify-between mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Allocation
            </span>
            <span className="text-[10px] font-bold" style={{ color: statusColor }}>
              {allocPct != null ? `${allocPct.toFixed(1)}%` : ''}
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-[var(--muted)] flex">
            {poolEntries.map(({ ad, portion, colorIdx }) => {
              const w = budgetCap > 0 ? Math.min((portion / budgetCap) * 100, 100) : 0;
              const pct = budgetCap > 0 ? (portion / budgetCap) * 100 : 0;
              const isSplit = ad.budgetSource === 'split';
              return w > 0 ? (
                <Tooltip
                  key={ad.id}
                  label={`${ad.name || 'Untitled Ad'}${isSplit ? ` (split — ${source} portion)` : ''}: ${fmt(portion)} (${pct.toFixed(1)}% of budget)`}
                  className="h-full transition-[width] duration-500"
                  style={{
                    width: `${w}%`,
                    background: AD_COLORS[colorIdx % AD_COLORS.length],
                    borderRight: '1px solid var(--background)',
                  }}
                />
              ) : null;
            })}
          </div>
          {/* Per-ad legend (expanded) — height-animated open/close. */}
          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-out ${
              expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
            }`}
          >
            <div className="overflow-hidden">
              <div className="flex flex-wrap gap-2 pt-2">
                {poolEntries.map(({ ad, portion, colorIdx }) => {
                  const pct = budgetCap > 0 ? (portion / budgetCap) * 100 : 0;
                  const isSplit = ad.budgetSource === 'split';
                  return (
                    <Tooltip
                      key={ad.id}
                      label={`${pct.toFixed(1)}% of budget${isSplit ? ' (split portion)' : ''}`}
                    >
                    <div
                      className="flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]"
                    >
                      <div
                        className="w-1.5 h-1.5 rounded-sm flex-shrink-0"
                        style={{ background: AD_COLORS[colorIdx % AD_COLORS.length] }}
                      />
                      <span className="max-w-[110px] overflow-hidden text-ellipsis whitespace-nowrap text-[var(--foreground)]">
                        {ad.name || 'Untitled Ad'}
                        {isSplit && (
                          <span className="text-[var(--muted-foreground)] ml-0.5">·split</span>
                        )}
                      </span>
                      <span>{fmt(portion)}</span>
                      <span className="text-[var(--muted-foreground)]">
                        ({pct.toFixed(1)}%)
                      </span>
                    </div>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Total Account Allocation header ───────────────────────────────────────
export function TotalAllocationHeader({ plan }: { plan: PacerPlan }) {
  // Walk every ad once and sum via adContribution so split ads add to
  // both pool totals proportionally.
  const { totalBase, totalAdded } = plan.ads.reduce(
    (acc, a) => {
      const c = adContribution(a);
      acc.totalBase += c.baseAllocation;
      acc.totalAdded += c.addedAllocation;
      return acc;
    },
    { totalBase: 0, totalAdded: 0 },
  );
  const totalActual = totalBase + totalAdded;
  if (totalActual === 0) return null;
  // Match BudgetPanel exactly so the total bar agrees with the per-source
  // cards: per-account markup, and carryover folded into each source's spend
  // target (target = goal × markup + carryover). The total budget is the SUM of
  // the two cards' targets — applying an over/under carryover therefore grows
  // the total allocation cap the same way it grows the source card it lands in.
  const effMarkup = effMarkupOf(plan.markup);
  const totalGross = Math.round((totalActual / effMarkup) * 100) / 100;
  const baseGoal = num(plan.baseBudgetGoal);
  const addedGoal = num(plan.addedBudgetGoal);
  const baseCarry = num(plan.baseCarryover) ?? 0;
  const addedCarry = num(plan.addedCarryover) ?? 0;
  const baseTarget = baseGoal != null ? baseGoal * effMarkup + baseCarry : null;
  const addedTarget = addedGoal != null ? addedGoal * effMarkup + addedCarry : null;
  const combinedActualBudget =
    baseTarget != null || addedTarget != null
      ? Math.round(((baseTarget ?? 0) + (addedTarget ?? 0)) * 100) / 100
      : null;
  const allocPct =
    combinedActualBudget != null && combinedActualBudget > 0
      ? (totalActual / combinedActualBudget) * 100
      : null;
  const pctColor =
    allocPct == null
      ? 'var(--muted-foreground)'
      : allocPct > 105
        ? COLORS.error
        : allocPct >= 95
          ? COLORS.success
          : COLORS.warn;
  // Bar widths are computed against the COMBINED budget cap so partial
  // allocation visually leaves empty space (matching the per-source bars
  // inside BudgetPanel). Falls back to share-of-total when there's no
  // budget goal set yet so the bar still has something to render.
  const widthDenominator =
    combinedActualBudget != null && combinedActualBudget > 0
      ? combinedActualBudget
      : totalActual;
  const baseW = widthDenominator > 0
    ? Math.min(100, (totalBase / widthDenominator) * 100)
    : 0;
  const addedW = widthDenominator > 0
    ? Math.min(100 - baseW, (totalAdded / widthDenominator) * 100)
    : 0;
  // Percent of total budget — used for the legend %.
  const basePctOfBudget = widthDenominator > 0
    ? (totalBase / widthDenominator) * 100
    : 0;
  const addedPctOfBudget = widthDenominator > 0
    ? (totalAdded / widthDenominator) * 100
    : 0;

  return (
    <div className="px-5 py-4 mb-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2.5">
        <span className="text-sm font-bold uppercase tracking-wider text-[var(--foreground)]">
          Total Account Allocation
        </span>
        <div className="flex gap-3 flex-wrap">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              Total Gross
            </div>
            <div className="text-base font-bold text-[var(--foreground)]">
              {fmt(totalGross)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              Total Actual Spend
            </div>
            <div className="text-base font-bold text-[var(--foreground)]">
              {fmt(totalActual)}
            </div>
          </div>
          {allocPct != null && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                Allocated
              </div>
              <div className="text-base font-bold" style={{ color: pctColor }}>
                {allocPct.toFixed(1)}%
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden bg-[var(--muted)] flex mb-2">
        {baseW > 0 && (
          <Tooltip
            className="h-full transition-[width] duration-500"
            label={`Base: ${fmt(totalBase)} (${basePctOfBudget.toFixed(1)}% of budget)`}
            style={{
              width: `${baseW}%`,
              background: COLORS.base,
              borderRight: addedW > 0 ? '1px solid var(--background)' : 'none',
            }}
          />
        )}
        {addedW > 0 && (
          <Tooltip
            className="h-full transition-[width] duration-500"
            label={`Added: ${fmt(totalAdded)} (${addedPctOfBudget.toFixed(1)}% of budget)`}
            style={{
              width: `${addedW}%`,
              background: COLORS.added,
            }}
          />
        )}
      </div>
      <div className="flex gap-4 flex-wrap">
        {totalBase > 0 && (
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]">
            <div
              className="w-2 h-2 rounded-sm flex-shrink-0"
              style={{ background: COLORS.base }}
            />
            <span>Base</span>
            <span className="font-bold" style={{ color: COLORS.base }}>
              {fmt(totalBase)}
            </span>
            <span>({basePctOfBudget.toFixed(1)}%)</span>
          </div>
        )}
        {totalAdded > 0 && (
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]">
            <div
              className="w-2 h-2 rounded-sm flex-shrink-0"
              style={{ background: COLORS.added }}
            />
            <span>Added</span>
            <span className="font-bold" style={{ color: COLORS.added }}>
              {fmt(totalAdded)}
            </span>
            <span>({addedPctOfBudget.toFixed(1)}%)</span>
          </div>
        )}
        {combinedActualBudget != null && (
          <div className="text-[10px] text-[var(--muted-foreground)] ml-auto">
            of {fmt(combinedActualBudget)} actual spend budget
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Empty period state ────────────────────────────────────────────────────
export function EmptyPeriodState({
  period,
  periodSummaries,
  onAddAd,
  onOpenCopy,
}: {
  period: string;
  periodSummaries: PeriodSummary[];
  onAddAd: () => void;
  onOpenCopy: () => void;
}) {
  const readOnly = usePacerReadOnly();
  const hasSources = periodSummaries.some(
    (p) => p.period !== period && p.adCount > 0,
  );
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] py-10 px-6 text-center mb-3">
      <ClipboardDocumentListIcon className="w-10 h-10 mx-auto mb-3 text-[var(--muted-foreground)]" />
      <p className="text-sm text-[var(--foreground)] font-medium mb-1">
        No ads planned for {fmtPeriodLong(period)} yet.
      </p>
      <p className="text-xs text-[var(--muted-foreground)] mb-5">
        {readOnly
          ? 'This month is frozen — reopen it to add ads.'
          : 'Start fresh, or copy ads from a previous month.'}
      </p>
      {!readOnly && (
        <div className="flex flex-wrap gap-2 justify-center items-center">
          <button
            type="button"
            onClick={onAddAd}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)]/10 px-3 py-2 text-xs font-medium text-[var(--primary)] hover:bg-[var(--primary)]/20 transition-colors"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Add first ad
          </button>
          {hasSources && (
            <button
              type="button"
              onClick={onOpenCopy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <DocumentDuplicateIcon className="w-3.5 h-3.5" />
              Copy from another month
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Add Plan dropdown ─────────────────────────────────────────────────────
// The optional import entry is brand-parameterized (importIcon/importLabel/
// importHint) so the Meta tool shows "Import from Meta" + the Meta logo and the
// Google tool shows its own — the dropdown itself stays shared.
export function AddPlanButton({
  onCreateNew,
  onOpenCopy,
  onImport,
  hasOtherPeriods,
  importIcon,
  importLabel = 'Import',
  importHint = 'Bring existing ad sets in as rows',
}: {
  onCreateNew: () => void;
  onOpenCopy: () => void;
  onImport?: () => void;
  hasOtherPeriods: boolean;
  importIcon?: ReactNode;
  importLabel?: string;
  importHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)]/90 text-white px-3 py-1.5 text-xs font-medium hover:bg-[var(--primary)] transition-colors"
      >
        <PlusIcon className="w-3.5 h-3.5" />
        Add Plan
        <ChevronDownIcon className="w-3 h-3" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-64 rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-2xl py-1 z-30"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onCreateNew();
            }}
            className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-[var(--muted)] transition-colors"
          >
            <PlusIcon className="w-4 h-4 text-[var(--primary)] flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-[var(--foreground)]">
                Create a new plan
              </div>
              <div className="text-[10px] text-[var(--muted-foreground)]">
                Start with a blank ad
              </div>
            </div>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!hasOtherPeriods}
            onClick={() => {
              setOpen(false);
              onOpenCopy();
            }}
            className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-[var(--muted)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <DocumentDuplicateIcon className="w-4 h-4 text-[var(--primary)] flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-[var(--foreground)]">
                Copy plan from another month
              </div>
              <div className="text-[10px] text-[var(--muted-foreground)]">
                {hasOtherPeriods
                  ? 'Pick ads to bring into this month'
                  : 'No other months with ads yet'}
              </div>
            </div>
          </button>
          {onImport && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onImport();
              }}
              className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-[var(--muted)] transition-colors"
            >
              {importIcon && (
                <span className="w-4 h-4 flex-shrink-0 mt-0.5">{importIcon}</span>
              )}
              <div>
                <div className="text-xs font-semibold text-[var(--foreground)]">
                  {importLabel}
                </div>
                <div className="text-[10px] text-[var(--muted-foreground)]">
                  {importHint}
                </div>
              </div>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
