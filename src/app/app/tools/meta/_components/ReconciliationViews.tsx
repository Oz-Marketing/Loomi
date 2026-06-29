'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardDocumentListIcon,
  ExclamationTriangleIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { InvestmentIcon } from '@/components/icons/investment';
import type { PacerAd, DirectoryUser } from '@/lib/ad-pacer/types';
import { COLORS, AD_COLORS } from '@/lib/ad-pacer/constants';
import {
  fmt,
  fmtDate,
  effMarkupOf,
  num,
  sourceColor,
  sourceTint,
  sourceLabel,
} from '@/lib/ad-pacer/helpers';
import { fmtPeriodLong, currentPeriod } from '@/lib/ad-pacer/period';
import { type PlanFilters, applyFilters, activeFilterCount } from '@/lib/ad-pacer/filters';
import {
  Tooltip,
  SectionLabel,
  StatusBattery,
  AccountNotesButton,
  AdStatusPill,
} from '@/app/app/tools/_shared';
import { AccountNotesDrawer } from './AccountNotesDrawer';

// Meta-only reconciliation / over-under / overview surfaces. Split out of
// MetaAdsPlannerTool to shrink the file; these are Meta-specific (own API
// fetches) and not shared with the Google tool.
// ─── Reconciliation panel (Phase 2b) ───────────────────────────────────────
interface ReconMonth {
  period: string;
  state: 'current' | 'grace' | 'closed' | 'future';
  isBackfilled: boolean;
  hasTarget: boolean;
  hasActual: boolean;
  clientBudget: number;
  spendTarget: number;
  adjustedSpendTarget: number;
  actual: number;
  variance: number;
  carryover: number;
  exceedsThreshold: boolean;
  appliedOut: number;
  unapplied: number;
  appliedIn: number;
  // §3: month has a lifetime ad still running — excluded from the over/under
  // base (books once on completion); drives the 'lifetime · in progress' badge.
  hasLifetimeInProgress: boolean;
  // CM4: per-ad over/under contributions for this month — the row drill-down.
  ads?: {
    name: string;
    inMonthSpend: number;
    billedActual: number;
    contribution: number;
    klass: 'real' | 'billed-cross-month' | 'lifetime-in-progress';
    settlesThisMonth?: boolean;
  }[];
}
interface CarryoverApplication {
  id: string;
  sourceMonth: string;
  targetMonth: string;
  bucket: 'base' | 'added';
  amount: number;
  appliedAt: string;
}
interface ReconData {
  year: number;
  markup: number;
  targetPeriod: string;
  months: ReconMonth[];
  ytdVariance: number;
  ytdCarryover: number;
  ytdUnapplied: number;
  // §4: lifetime drift incl. the in-progress live month (health gauge), and the
  // settled months still carrying unapplied over/under (named in the UI).
  ytdVarianceInclLive: number;
  unappliedMonths: string[];
  appliedThisMonth: { base: number; added: number; total: number };
  // §5: individual ledger entries, newest first — powers both-ends provenance.
  applications: CarryoverApplication[];
}

/**
 * Year reconciliation: per-month over/under (tracked + backfilled), a YTD net
 * still to reconcile, and apply/undo controls. Applying rolls a month's (or all
 * months') over/under into the live month's bucket via the ledger, correcting
 * the account's running annual variance.
 */
export function ReconciliationPanel({ accountKey }: { accountKey: string }) {
  const { confirm } = useLoomiDialog();
  const [year, setYear] = useState<number>(() =>
    Number(currentPeriod().slice(0, 4)),
  );
  const [data, setData] = useState<ReconData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [bucket, setBucket] = useState<'base' | 'added'>('base');
  const [backfilling, setBackfilling] = useState(false);
  const [clearingBackfill, setClearingBackfill] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // CM4: which month rows are expanded to their per-ad variance breakdown.
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setData(null);
    setLoadError(null);
    fetch(`/api/meta-ads-pacer/${accountKey}/reconciliation?year=${year}`)
      .then(async (r) => {
        if (!r.ok) {
          const t = await r.text().catch(() => '');
          throw new Error(`HTTP ${r.status} ${t.slice(0, 160)}`);
        }
        return r.json();
      })
      .then((json: ReconData) => setData(json))
      .catch((err) =>
        setLoadError(
          err instanceof Error ? err.message : 'Failed to load reconciliation.',
        ),
      );
  }, [accountKey, year]);

  useEffect(() => {
    load();
  }, [load]);

  const post = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setActionError(null);
    try {
      const r = await fetch(
        `/api/meta-ads-pacer/${accountKey}/reconciliation?year=${year}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`);
      setData(json as ReconData);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  };

  const backfill = async () => {
    setBackfilling(true);
    setActionError(null);
    try {
      const r = await fetch(
        `/api/meta-ads-pacer/${accountKey}/backfill-history?year=${year}`,
        { method: 'POST' },
      );
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Backfill failed.');
    } finally {
      setBackfilling(false);
    }
  };

  // Undo the backfill — clear the Meta-pulled actual spend for pre-tool months
  // so it stops tainting variance. Scoped to the year on screen.
  const clearBackfill = async () => {
    const ok = await confirm({
      title: `Remove backfilled spend for ${year}?`,
      message:
        'Clears the actual-spend amounts pulled from Meta for pre-tool months this year so they stop counting toward reconciliation variance. Your tracked months are untouched, and you can re-run Backfill later.',
      confirmLabel: 'Remove backfill',
      destructive: true,
    });
    if (!ok) return;
    setClearingBackfill(true);
    setActionError(null);
    try {
      const r = await fetch(
        `/api/meta-ads-pacer/${accountKey}/backfill-history?year=${year}`,
        { method: 'DELETE' },
      );
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to clear backfill.');
    } finally {
      setClearingBackfill(false);
    }
  };

  // variance > 0 = overspent (warn); < 0 = underspent (lifetime/blue).
  const overUnder = (v: number) =>
    Math.abs(v) < 0.005
      ? { text: 'On target', color: 'var(--muted-foreground)' }
      : v > 0
        ? { text: `${fmt(v)} over`, color: COLORS.warn }
        : { text: `${fmt(-v)} under`, color: COLORS.lifetime };

  const net = data?.ytdUnapplied ?? 0;
  const netReconciled = Math.abs(net) < 0.005;
  const canApply = !!data?.targetPeriod && !netReconciled;
  // §4: name the settled months still carrying unapplied over/under.
  const unappliedMonthsLabel = (data?.unappliedMonths ?? [])
    .map((p) =>
      new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1, 1).toLocaleDateString(
        'en-US',
        { month: 'short' },
      ),
    )
    .join(', ');

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <h2 className="m-0 flex items-center gap-2 text-base font-bold tracking-tight text-[var(--foreground)]">
          <InvestmentIcon className="w-4 h-4" />
          Reconciliation
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)]">
            <button
              type="button"
              onClick={() => setYear((y) => y - 1)}
              className="px-2.5 py-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              aria-label="Previous year"
            >
              <ChevronLeftIcon className="w-4 h-4" />
            </button>
            <span className="px-2 text-sm font-semibold text-[var(--foreground)] tabular-nums">
              {year}
            </span>
            <button
              type="button"
              onClick={() => setYear((y) => y + 1)}
              disabled={year >= Number(currentPeriod().slice(0, 4))}
              className="px-2.5 py-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Next year"
            >
              <ChevronRightIcon className="w-4 h-4" />
            </button>
          </div>
          <Tooltip label="Pull account-total monthly spend from Meta for pre-tool months this year">
          <button
            type="button"
            onClick={backfill}
            disabled={backfilling}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${backfilling ? 'animate-spin' : ''}`} />
            {backfilling ? 'Backfilling…' : 'Backfill historical spend'}
          </button>
          </Tooltip>
          {data?.months.some((m) => m.isBackfilled) && (
            <Tooltip label="Remove the Meta-pulled actual spend for pre-tool months this year (your tracked months stay untouched)">
            <button
              type="button"
              onClick={clearBackfill}
              disabled={clearingBackfill}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
            >
              <TrashIcon className="w-3.5 h-3.5" />
              {clearingBackfill ? 'Removing…' : 'Remove backfill'}
            </button>
            </Tooltip>
          )}
        </div>
      </div>

      {loadError ? (
        <div className="text-center py-12 text-xs text-red-400">{loadError}</div>
      ) : !data ? (
        <div className="text-center py-12 text-xs text-[var(--muted-foreground)]">
          Loading…
        </div>
      ) : (
        <>
          {/* YTD net + apply-all controls */}
          <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 flex items-start justify-between gap-5 flex-wrap">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                {year} net still to reconcile
              </div>
              <div
                className="text-3xl font-bold tabular-nums leading-tight mt-1"
                style={{
                  color: netReconciled
                    ? COLORS.success
                    : net > 0
                      ? COLORS.lifetime
                      : COLORS.warn,
                }}
              >
                {netReconciled
                  ? 'Fully reconciled'
                  : `${net > 0 ? '' : '−'}${fmt(Math.abs(net))}`}
              </div>
              <div className="text-xs text-[var(--muted-foreground)] mt-1">
                {netReconciled
                  ? 'No outstanding over/under across settled months.'
                  : net > 0
                    ? `Underspent ${unappliedMonthsLabel ? `across ${unappliedMonthsLabel}` : 'across settled (closed) months'}. Apply adds ${fmt(net)} to ${data.targetPeriod ? fmtPeriodLong(data.targetPeriod) : 'the live month'}.`
                    : `Overspent ${unappliedMonthsLabel ? `across ${unappliedMonthsLabel}` : 'across settled (closed) months'}. Apply pulls ${fmt(-net)} from ${data.targetPeriod ? fmtPeriodLong(data.targetPeriod) : 'the live month'}.`}
              </div>
              {data.appliedThisMonth.total !== 0 && data.targetPeriod && (
                <div className="text-[11px] text-[var(--muted-foreground)] mt-2 flex items-center gap-2 flex-wrap">
                  <span>
                    Applied into {fmtPeriodLong(data.targetPeriod)}:{' '}
                    <span className="font-semibold text-[var(--foreground)] tabular-nums">
                      {data.appliedThisMonth.total > 0 ? '+' : '−'}
                      {fmt(Math.abs(data.appliedThisMonth.total))}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => post({ type: 'unapply' }, 'clear-all')}
                    disabled={busy === 'clear-all'}
                    className="text-[var(--primary)] hover:underline disabled:opacity-50"
                  >
                    {busy === 'clear-all' ? 'Clearing…' : 'Clear all'}
                  </button>
                </div>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--background)] p-1">
                {(['base', 'added'] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBucket(b)}
                    className={`px-3 py-1 text-[11px] font-medium rounded transition-colors ${
                      bucket === b
                        ? 'bg-[var(--primary)] text-white'
                        : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    {b === 'base' ? 'Base' : 'Added'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => post({ type: 'apply-all', bucket }, 'apply-all')}
                disabled={!canApply || busy === 'apply-all'}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3.5 py-2 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy === 'apply-all'
                  ? 'Applying…'
                  : `Apply all unapplied → ${bucket === 'base' ? 'Base' : 'Added'}`}
              </button>
              <span className="text-[10px] text-[var(--muted-foreground)] text-right max-w-[200px]">
                Carryover lands in the {bucket === 'base' ? 'Base' : 'Added'} bucket of the live month.
              </span>
            </div>
          </div>

          {actionError && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-400">
              {actionError}
            </div>
          )}

          {/* Per-month table */}
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                  <th className="text-left font-semibold px-3 py-2.5">Month</th>
                  <th className="text-right font-semibold px-3 py-2.5">Spend Target</th>
                  <th className="text-right font-semibold px-3 py-2.5">Actual</th>
                  <th className="text-right font-semibold px-3 py-2.5">Over / Under</th>
                  <th className="text-right font-semibold px-3 py-2.5 w-[200px]">Reconcile</th>
                </tr>
              </thead>
              <tbody>
                {data.months.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-[var(--muted-foreground)]">
                      No months to show for {year} yet.
                    </td>
                  </tr>
                )}
                {data.months.map((m) => {
                  const isLive = m.period === data.targetPeriod;
                  const noData = !m.hasActual && !m.hasTarget;
                  const needsTarget = m.isBackfilled && !m.hasTarget;
                  const applied = Math.abs(m.appliedOut) >= 0.005;
                  const ou = overUnder(m.variance);
                  const hasAdDetail = (m.ads?.length ?? 0) > 0;
                  const expanded = expandedMonths.has(m.period);
                  return (
                    <Fragment key={m.period}>
                    <tr
                      className={`border-b border-[var(--border)] last:border-0 ${
                        isLive ? 'bg-[var(--primary)]/5' : ''
                      }`}
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-[var(--foreground)] flex items-center gap-2">
                          {hasAdDetail && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedMonths((s) => {
                                  const next = new Set(s);
                                  if (next.has(m.period)) next.delete(m.period);
                                  else next.add(m.period);
                                  return next;
                                })
                              }
                              aria-label={expanded ? 'Hide ad breakdown' : 'Show ad breakdown'}
                              className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                              style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
                            >
                              <ChevronRightIcon className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {fmtPeriodLong(m.period)}
                          {isLive && (
                            <span className="text-[9px] font-medium uppercase tracking-wider rounded px-1.5 py-0.5 bg-[var(--primary)]/15 text-[var(--primary)]">
                              Live
                            </span>
                          )}
                          {m.isBackfilled && (
                            <Tooltip label="Pre-tool month — actual pulled from Meta account spend">
                            <span
                              className="text-[9px] font-medium uppercase tracking-wider rounded px-1.5 py-0.5 bg-[var(--muted)] text-[var(--muted-foreground)]"
                            >
                              Backfilled
                            </span>
                            </Tooltip>
                          )}
                          {m.hasLifetimeInProgress && (
                            <Tooltip label="A lifetime ad is still running this month — excluded from the over/under base (its single variance books once when the run completes). Its spend still shows in the Pacer's total spend.">
                            <span
                              className="text-[9px] font-medium uppercase tracking-wider rounded px-1.5 py-0.5"
                              style={{
                                background: 'rgba(167,139,250,0.15)',
                                color: COLORS.lifetime,
                              }}
                            >
                              Lifetime in progress
                            </span>
                            </Tooltip>
                          )}
                        </div>
                        {isLive && (
                          <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                            target month — over/under lands here
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {needsTarget ? (
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-[var(--muted-foreground)]">$</span>
                            <input
                              value={drafts[m.period] ?? ''}
                              onChange={(e) =>
                                setDrafts((d) => ({ ...d, [m.period]: e.target.value }))
                              }
                              placeholder="budget"
                              inputMode="decimal"
                              className="w-20 rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-1 text-right text-xs text-[var(--foreground)]"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                post(
                                  {
                                    type: 'set-target',
                                    period: m.period,
                                    clientBudget: drafts[m.period] ?? '',
                                  },
                                  `target:${m.period}`,
                                )
                              }
                              disabled={busy === `target:${m.period}`}
                              className="text-[10px] text-[var(--primary)] hover:underline disabled:opacity-50"
                            >
                              Save
                            </button>
                          </div>
                        ) : m.hasTarget || m.appliedIn !== 0 ? (
                          <>
                            <div className="text-[var(--foreground)] font-semibold">
                              {fmt(m.adjustedSpendTarget)}
                            </div>
                            {m.hasTarget && (
                              <div className="text-[9px] text-[var(--muted-foreground)]">
                                {fmt(m.clientBudget)} × {Math.round(data.markup * 100)}%
                              </div>
                            )}
                            {m.appliedIn !== 0 && (
                              <Tooltip label="Carryover applied INTO this month from a prior month's over/under (adjusts this month's target; the client budget is unchanged).">
                              <div
                                className="text-[9px]"
                                style={{ color: COLORS.lifetime }}
                              >
                                ← {m.appliedIn > 0 ? '+' : '−'}
                                {fmt(Math.abs(m.appliedIn))} from{' '}
                                {(() => {
                                  const srcs = Array.from(
                                    new Set(
                                      (data.applications ?? [])
                                        .filter((a) => a.targetMonth === m.period)
                                        .map((a) => a.sourceMonth),
                                    ),
                                  );
                                  return srcs.length
                                    ? srcs.map((s) => fmtPeriodLong(s)).join(', ')
                                    : 'a prior month';
                                })()}
                              </div>
                              </Tooltip>
                            )}
                          </>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--foreground)]">
                        {m.hasActual ? fmt(m.actual) : <span className="text-[var(--muted-foreground)]">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {noData || !m.hasTarget || !m.hasActual ? (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        ) : (
                          <span style={{ color: ou.color }} className="font-semibold">
                            {ou.text}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {isLive ? (
                          <span className="text-[10px] text-[var(--muted-foreground)]">
                            In progress
                          </span>
                        ) : applied ? (
                          <div className="flex items-center justify-end gap-2">
                            <Tooltip
                              label={`This month's over/under was applied into ${
                                data.targetPeriod
                                  ? fmtPeriodLong(data.targetPeriod)
                                  : 'the live month'
                              }`}
                            >
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-semibold"
                              style={{ color: COLORS.success }}
                            >
                              <CheckIcon className="w-3 h-3" />
                              Applied {m.appliedOut >= 0 ? '+' : '−'}
                              {fmt(Math.abs(m.appliedOut))} →{' '}
                              {(() => {
                                const tgts = Array.from(
                                  new Set(
                                    (data.applications ?? [])
                                      .filter((a) => a.sourceMonth === m.period)
                                      .map((a) => a.targetMonth),
                                  ),
                                );
                                return tgts.length
                                  ? tgts.map((t) => fmtPeriodLong(t)).join(', ')
                                  : data.targetPeriod
                                    ? fmtPeriodLong(data.targetPeriod)
                                    : 'live month';
                              })()}
                            </span>
                            </Tooltip>
                            <button
                              type="button"
                              onClick={() =>
                                post(
                                  { type: 'unapply', sourceMonth: m.period },
                                  `unapply:${m.period}`,
                                )
                              }
                              disabled={busy === `unapply:${m.period}`}
                              className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:underline disabled:opacity-50"
                            >
                              {busy === `unapply:${m.period}` ? '…' : 'Undo'}
                            </button>
                          </div>
                        ) : noData ? (
                          <span className="text-[10px] text-[var(--muted-foreground)]">
                            No data
                          </span>
                        ) : (
                          <span className="text-[10px] text-[var(--muted-foreground)]">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                    {expanded && hasAdDetail && (
                      <tr className={isLive ? 'bg-[var(--primary)]/5' : ''}>
                        <td colSpan={5} className="px-3 pb-3 pt-0">
                          <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 overflow-hidden">
                            <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] border-b border-[var(--border)]">
                              Variance by ad
                            </div>
                            <div className="divide-y divide-[var(--border)]/60">
                              {(m.ads ?? []).map((av, i) => {
                                const amtColor =
                                  av.klass === 'lifetime-in-progress'
                                    ? COLORS.lifetime
                                    : av.klass === 'billed-cross-month'
                                      ? '#f97316'
                                      : overUnder(av.contribution).color;
                                return (
                                  <div
                                    key={`${m.period}-${i}`}
                                    className="flex items-center justify-between gap-3 px-3 py-1.5"
                                  >
                                    <div className="min-w-0 flex items-center gap-2">
                                      <span className="text-[11px] text-[var(--foreground)] truncate">
                                        {av.name || 'Untitled ad'}
                                      </span>
                                      {av.klass === 'billed-cross-month' && (
                                        <Tooltip
                                          label="Billed in this month though it ran across months — the over/under counts its full run; only part spent this month."
                                          className="flex-shrink-0"
                                        >
                                        <span
                                          className="text-[9px] font-semibold"
                                          style={{ color: '#f97316' }}
                                        >
                                          billed cross-month
                                        </span>
                                        </Tooltip>
                                      )}
                                      {av.klass === 'lifetime-in-progress' && (
                                        <Tooltip
                                          label={
                                            av.settlesThisMonth === false
                                              ? 'Cross-month lifetime run — its variance settles in a future month at flight completion.'
                                              : "Lifetime ad still running — not paceable (Meta controls delivery). It settles at this month's close, not a future month."
                                          }
                                          className="flex-shrink-0"
                                        >
                                        <span
                                          className="text-[9px] font-semibold"
                                          style={{ color: COLORS.lifetime }}
                                        >
                                          {av.settlesThisMonth === false
                                            ? 'lifetime · settles on completion'
                                            : 'lifetime · settles at month end'}
                                        </span>
                                        </Tooltip>
                                      )}
                                    </div>
                                    <span
                                      className="text-[11px] font-semibold tabular-nums flex-shrink-0"
                                      style={{ color: amtColor }}
                                    >
                                      {av.klass === 'lifetime-in-progress'
                                        ? `${fmt(av.inMonthSpend)} held`
                                        : `${av.contribution >= 0 ? '+' : '−'}${fmt(Math.abs(av.contribution))}`}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[10px] text-[var(--muted-foreground)] leading-relaxed">
            Over/under is measured against the margin-adjusted spend target
            (client budget × {Math.round(data.markup * 100)}%). Applying a month
            rolls its over/under into the live month&apos;s budget via an
            auditable ledger entry — it never edits the original month&apos;s
            billing record. Backfilled months pull account-total spend from Meta;
            enter their client budget to compute a variance.
          </p>
        </>
      )}
    </div>
  );
}


// ─── Admin Overview ────────────────────────────────────────────────────────
export interface OverviewAccount {
  accountKey: string;
  dealer: string;
  // §0.1: resolved per-account markup factor for the gross-up display.
  markup: number;
  baseBudgetGoal: string | null;
  addedBudgetGoal: string | null;
  // Per-source carryover folded into the spend target (target = goal × markup
  // + carryover). Lets the remaining-budget footer reconcile against the same
  // target the planner uses, so an applied carryover doesn't read as unallocated.
  baseCarryover: string | null;
  addedCarryover: string | null;
  // Server-side aggregated count of account-level pacer notes — drives
  // the chat badge on the overview row without an extra round-trip.
  notesCount: number;
  ads: PacerAd[];
}

function OverviewAccountRow({
  account,
  period,
  expanded,
  onToggle,
  onOpenAccount,
  filters,
  currentUserId,
  users,
}: {
  account: OverviewAccount;
  period: string;
  expanded: boolean;
  onToggle: () => void;
  onOpenAccount: () => void;
  filters: PlanFilters;
  currentUserId: string | null;
  users: DirectoryUser[];
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesCount, setNotesCount] = useState<number>(account.notesCount);
  useEffect(() => {
    setNotesCount(account.notesCount);
  }, [account.notesCount]);
  const visibleAds = useMemo(
    () => applyFilters(account.ads, filters, currentUserId),
    [account.ads, filters, currentUserId],
  );
  const filtersActive = activeFilterCount(filters) > 0;
  // When filters are active, the collapsed header reflects only the
  // matching subset so reps can scan which accounts have hits without
  // expanding each row. Default state (no filters) shows the full picture.
  const headerAds = filtersActive ? visibleAds : account.ads;
  const noMatches = filtersActive && visibleAds.length === 0;

  // Show the client's agreed budget goals (gross dollars) rather than the
  // running allocation total — easier for admins to see commitments at a
  // glance. The COMBINED Base+Added is the primary billing figure (Change 8);
  // Base/Added are shown as its components so the sum is visible at a glance.
  // Always the true client budget (gross) — never carryover/pacing-adjusted.
  const baseTotal = num(account.baseBudgetGoal) ?? 0;
  const addedTotal = num(account.addedBudgetGoal) ?? 0;
  const combinedTotal = baseTotal + addedTotal;

  return (
    <div
      className={`glass-section-card rounded-xl mb-2.5 overflow-hidden transition-opacity ${
        noMatches ? 'opacity-50' : ''
      }`}
    >
      {/* Header row — title + tag stay inline, status battery stacks below.
          Right cluster (Base/Added/Open) is vertically centered against the
          full card height. */}
      <div
        className="flex items-center justify-between gap-4 px-4 py-3.5 cursor-pointer"
        onClick={onToggle}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap min-w-0 mb-2">
            {expanded ? (
              <ChevronDownIcon className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
            ) : (
              <ChevronRightIcon className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
            )}
            <span className="text-lg font-bold text-[var(--foreground)] truncate min-w-0 max-w-[320px] tracking-tight">
              {account.dealer}
            </span>
            <span className="text-[11px] text-[var(--muted-foreground)] bg-[var(--muted)] px-2 py-0.5 rounded-full whitespace-nowrap">
              {filtersActive
                ? `${visibleAds.length} of ${account.ads.length} ad${account.ads.length !== 1 ? 's' : ''}`
                : `${account.ads.length} ad${account.ads.length !== 1 ? 's' : ''}`}
            </span>
          </div>
          {headerAds.length > 0 ? (
            <div className="pl-7 max-w-[440px]">
              <StatusBattery ads={headerAds} size="lg" />
            </div>
          ) : noMatches ? (
            <div className="pl-7 text-[11px] text-[var(--muted-foreground)] italic">
              No ads match the current filters.
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-5 flex-shrink-0">
          {combinedTotal > 0 && (
            <Tooltip label="Billing figure — combined Base + Added client budget (gross). Should match the planner for this account and month.">
            <div
              className="text-right"
            >
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                Total Budget
              </div>
              <div className="text-xl font-bold tabular-nums text-[var(--foreground)]">
                {fmt(combinedTotal)}
              </div>
              {/* Components — the two add up to the total, in view for an
                  at-a-glance reconciliation. */}
              <div className="flex items-center justify-end gap-1.5 mt-0.5 text-[10px] tabular-nums">
                <span style={{ color: COLORS.base }}>Base {fmt(baseTotal)}</span>
                <span className="text-[var(--muted-foreground)]">·</span>
                <span style={{ color: COLORS.added }}>
                  Added {fmt(addedTotal)}
                </span>
              </div>
            </div>
            </Tooltip>
          )}
          <div onClick={(e) => e.stopPropagation()}>
            <AccountNotesButton
              count={notesCount}
              onClick={() => setNotesOpen(true)}
              ariaLabel={`Open notes for ${account.dealer}`}
            />
          </div>
          <Tooltip label="Open account">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenAccount();
            }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            Open
          </button>
          </Tooltip>
        </div>
      </div>

      {/* Drill-down: compact ad rows */}
      {expanded && (
        <div className="border-t border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3">
          {account.ads.length === 0 ? (
            <div className="text-xs text-[var(--muted-foreground)] py-3 text-center">
              No ads in this period.
            </div>
          ) : visibleAds.length === 0 ? (
            <div className="text-xs text-[var(--muted-foreground)] py-3 text-center">
              No ads match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    {[
                      'Ad',
                      'Status',
                      'Source',
                      'Type',
                      'Client Budget',
                      'Allocation',
                      'Flight',
                      'Action',
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-2 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleAds.map((ad, i) => (
                    <tr key={ad.id} className="border-b border-[var(--border)]">
                      <td className="px-2 py-2 text-[var(--foreground)] max-w-[200px] truncate">
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-sm mr-1.5 align-middle"
                          style={{ background: AD_COLORS[i % AD_COLORS.length] }}
                        />
                        {ad.name}
                      </td>
                      <td className="px-2 py-2">
                        <AdStatusPill status={ad.adStatus} />
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                          style={{
                            background: sourceTint(ad.budgetSource),
                            color: sourceColor(ad.budgetSource),
                          }}
                        >
                          {sourceLabel(ad.budgetSource)}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-[var(--muted-foreground)]">
                        {ad.budgetType}
                      </td>
                      <td
                        className="px-2 py-2 font-semibold whitespace-nowrap"
                        style={{ color: COLORS.daily }}
                      >
                        <Tooltip label="Gross client-facing dollars (allocation grossed up by markup)">
                        {(() => {
                          const m = effMarkupOf(account.markup);
                          return num(ad.allocation) != null && m > 0
                            ? fmt(Math.round((num(ad.allocation)! / m) * 100) / 100)
                            : '—';
                        })()}
                        </Tooltip>
                      </td>
                      <td className="px-2 py-2 text-[var(--foreground)]">
                        {num(ad.allocation) != null ? fmt(num(ad.allocation)!) : '—'}
                      </td>
                      <td className="px-2 py-2 text-[var(--muted-foreground)] whitespace-nowrap">
                        {ad.flightStart && ad.flightEnd
                          ? `${fmtDate(ad.flightStart)} – ${fmtDate(ad.flightEnd)}`
                          : '—'}
                      </td>
                      <td className="px-2 py-2 text-[var(--muted-foreground)]">
                        {ad.actionNeeded || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Remaining-budget summary — reconciles what's allocated to ads this
              month against the account's SPEND TARGET, mirroring the planner:
              target = client budget × markup + carryover. Folding carryover in
              keeps an applied carryover from reading as unallocated budget (the
              raw client budget would otherwise disagree with the planner). Uses
              the full account, not the filtered subset, so it's a true total. */}
          {combinedTotal > 0 &&
            (() => {
              const m = effMarkupOf(account.markup);
              // Net (actual-spend) sums across the whole account.
              const allocatedNet = account.ads.reduce(
                (s, a) => s + (num(a.allocation) ?? 0),
                0,
              );
              const carryoverNet =
                (num(account.baseCarryover) ?? 0) +
                (num(account.addedCarryover) ?? 0);
              // Gross (client-dollar) equivalents so the readout matches the
              // Total Budget figure and the Client Budget column.
              const allocatedGross = m > 0 ? allocatedNet / m : 0;
              const carryoverGross = m > 0 ? carryoverNet / m : 0;
              const targetGross = combinedTotal + carryoverGross;
              const remaining =
                Math.round((targetGross - allocatedGross) * 100) / 100;
              const hasCarry = Math.abs(carryoverGross) >= 0.005;
              const over = remaining < -0.005;
              const fullyAllocated = Math.abs(remaining) <= 0.005;
              const accent = over
                ? COLORS.error
                : fullyAllocated
                  ? COLORS.success
                  : COLORS.warn;
              return (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[var(--border)] pt-2.5 text-xs">
                  <span className="text-[var(--muted-foreground)]">
                    <span className="font-semibold text-[var(--foreground)] tabular-nums">
                      {fmt(allocatedGross)}
                    </span>{' '}
                    of{' '}
                    <span className="font-semibold text-[var(--foreground)] tabular-nums">
                      {fmt(hasCarry ? targetGross : combinedTotal)}
                    </span>{' '}
                    {hasCarry ? 'spend target allocated' : 'client budget allocated'}
                    {hasCarry && (
                      <span>
                        {' · '}
                        {fmt(combinedTotal)} budget{' '}
                        {carryoverGross > 0 ? '+' : '−'}
                        {fmt(Math.abs(carryoverGross))} carryover
                      </span>
                    )}
                  </span>
                  <span
                    className="font-semibold tabular-nums"
                    style={{ color: accent }}
                  >
                    {over
                      ? `Over budget by ${fmt(-remaining)}`
                      : fullyAllocated
                        ? 'Fully allocated'
                        : `${fmt(remaining)} remaining to allocate`}
                  </span>
                </div>
              );
            })()}
        </div>
      )}

      {notesOpen && (
        <AccountNotesDrawer
          accountKey={account.accountKey}
          accountLabel={account.dealer}
          period={period}
          users={users}
          currentUserId={currentUserId}
          onClose={() => setNotesOpen(false)}
          onCountChange={setNotesCount}
        />
      )}
    </div>
  );
}

export function OverviewView({
  period,
  filters,
  currentUserId,
  onOpenAccount,
  users,
  accounts,
  loadError,
}: {
  period: string;
  filters: PlanFilters;
  currentUserId: string | null;
  onOpenAccount: (accountKey: string) => void;
  users: DirectoryUser[];
  // List + error are owned by the parent so the filter sidebar can
  // share the same ads — see MetaAdsPlannerTool for the fetch.
  accounts: OverviewAccount[] | null;
  loadError: string | null;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (loadError) {
    return (
      <div className="glass-section-card rounded-xl text-center py-16 px-6">
        <ExclamationTriangleIcon className="w-8 h-8 mx-auto mb-3 text-red-400" />
        <p className="text-sm text-[var(--foreground)] font-medium mb-1">
          Could not load overview.
        </p>
        <p className="text-xs text-[var(--muted-foreground)]">{loadError}</p>
      </div>
    );
  }

  if (accounts == null) {
    return (
      <div className="text-center py-16 text-[var(--muted-foreground)] text-sm">
        Loading accounts…
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="glass-section-card rounded-xl text-center py-16 px-6">
        <p className="text-sm text-[var(--foreground)] font-medium mb-1">
          No accounts available.
        </p>
        <p className="text-xs text-[var(--muted-foreground)]">
          You don&apos;t have access to any accounts.
        </p>
      </div>
    );
  }

  // Sort: accounts with ads first, then by dealer name (already alphabetical)
  const sorted = [...accounts].sort((a, b) => {
    if (a.ads.length === 0 && b.ads.length > 0) return 1;
    if (a.ads.length > 0 && b.ads.length === 0) return -1;
    return 0;
  });

  return (
    <div className="space-y-2.5">
      <SectionLabel
        icon={<ClipboardDocumentListIcon className="w-3 h-3" />}
        text={`All Accounts · ${fmtPeriodLong(period)}`}
      />
      {sorted.map((acct) => (
        <OverviewAccountRow
          key={acct.accountKey}
          account={acct}
          period={period}
          expanded={expanded.has(acct.accountKey)}
          onToggle={() => toggleExpand(acct.accountKey)}
          onOpenAccount={() => onOpenAccount(acct.accountKey)}
          filters={filters}
          currentUserId={currentUserId}
          users={users}
        />
      ))}
    </div>
  );
}
