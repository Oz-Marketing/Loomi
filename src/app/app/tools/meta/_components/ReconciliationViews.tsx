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
import {
  fmtPeriodLong,
  fmtPeriodShort,
  currentPeriod,
  monthRangeLabel,
} from '@/lib/ad-pacer/period';
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
  // CM4: per-ad over/under contributions for this month — the row drill-down.
  ads?: {
    name: string;
    inMonthSpend: number;
    billedActual: number;
    contribution: number;
    klass: 'real' | 'billed-cross-month' | 'lifetime-in-progress';
    settlesThisMonth?: boolean;
  }[];
  // Cross-month spend chain: Raw (what the account spent, from Meta) and
  // Counted (what the pacer rows carry, billed basis) are sourced independently,
  // and `tieOut` reconciles one against the other. `residual` is the gap.
  rawSpend: number;
  rawSource: 'account' | 'backfill' | 'rows';
  crossMonthOut: number;
  crossMonthIn: number;
  tieOut: number;
  countedSpend: number;
  residual: number;
  residualChecked: boolean;
  pendingForward: number;
  crossMonthLines: CrossMonthLine[];
}
/** One flight line behind a month's Out / In / Pending cell (spec §6). */
interface CrossMonthLine {
  flightId: string;
  flightName: string;
  runStart: string | null;
  runEnd: string | null;
  billedMonth: string;
  flightTotal: number;
  amount: number;
  status: 'pending' | 'settled';
  direction: 'out' | 'in' | 'pending';
}
/** The conservation invariant (spec §5) — proves no dollar was lost or doubled. */
interface ConservationCheck {
  sumOut: number;
  sumIn: number;
  carryIn: number;
  carryOut: number;
  delta: number;
  balanced: boolean;
}
interface CrossMonthFlight {
  flightId: string;
  flightName: string;
  runStart: string | null;
  runEnd: string | null;
  billedMonth: string;
  flightTotal: number;
  originTotal: number;
  status: 'pending' | 'settled';
  fromSnapshot: boolean;
  /** Pulled OUT of auto-reconciliation — its numbers need a human (§8). */
  needsReview: boolean;
  reviewReason:
    | 'missing_run_spend'
    | 'unsplittable_span'
    | 'billed_month_has_no_row'
    | null;
  budgetCap: number | null;
  exceedsBudgetCap: boolean;
  runSpendMismatch: number | null;
}

/** Why a flight was excluded, in the language of the person who has to fix it. */
const REVIEW_REASON_TEXT: Record<string, string> = {
  missing_run_spend:
    "Meta hasn't reported a full-run spend for this flight, so the months it delivered in can't be worked out. Re-sync the account, or unmark the cross-month billing until it does.",
  unsplittable_span:
    'This flight ran across three or more months, and its rows don’t say how much landed in each. Rather than post the whole amount to one month, it’s left out — split it by hand or bill it in the month it ran.',
  billed_month_has_no_row:
    'The month this flight bills in has no ad row, so nothing there can carry the run. Add the ad to that month, or bill it in a month that has one.',
};
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
  // The per-flight ledger and the trust check.
  crossMonthFlights?: CrossMonthFlight[];
  conservation?: ConservationCheck;
  // The tie-out: Σ (Raw − Out + In − Counted) over months whose Raw is
  // independent, and the months carrying a gap. Nonzero blocks the apply.
  residualTotal?: number;
  residualMonths?: string[];
  rawSpendAvailable?: boolean;
}

/** "→ Jul 2026" for the pending-forward hint: where these dollars will land. */
function pendingTargetLabel(lines: CrossMonthLine[] | undefined): string {
  const months = Array.from(
    new Set(
      (lines ?? [])
        .filter((l) => l.direction === 'pending')
        .map((l) => l.billedMonth),
    ),
  ).sort();
  return months.length ? months.map((m) => fmtPeriodShort(m)).join(', ') : 'a later month';
}

/**
 * Year reconciliation: per-month over/under (tracked + backfilled), a YTD net
 * still to reconcile, and apply/undo controls. Applying rolls a month's (or all
 * months') over/under into the live month's bucket via the ledger, correcting
 * the account's running annual variance.
 */
export function ReconciliationPanel({
  accountKey,
  platform,
}: {
  accountKey: string;
  /** 'google' scopes the whole tab to Google's ledger; omit/undefined = Meta. */
  platform?: 'meta' | 'google';
}) {
  const { confirm } = useLoomiDialog();
  const isGoogle = platform === 'google';
  // Appended to every reconciliation fetch so reads + applies stay on the
  // caller's platform ledger.
  const platformQs = isGoogle ? '&platform=google' : '';
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
  const toggleMonth = (period: string) =>
    setExpandedMonths((s) => {
      const next = new Set(s);
      if (next.has(period)) next.delete(period);
      else next.add(period);
      return next;
    });

  const load = useCallback(() => {
    setData(null);
    setLoadError(null);
    fetch(`/api/meta-ads-pacer/${accountKey}/reconciliation?year=${year}${platformQs}`)
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
        `/api/meta-ads-pacer/${accountKey}/reconciliation?year=${year}${platformQs}`,
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

  // Raw · Out · In · Counted render on every account, every year — no gate. Raw
  // is a standing cross-check against what Meta says the account spent, whether
  // or not any flight moved; on an account with no cross-month flights Out/In
  // are simply blank, which is the answer, not noise.
  const flights = data?.crossMonthFlights ?? [];
  const reviewFlights = flights.filter((f) => f.needsReview);
  const colCount = 8;
  const conservation = data?.conservation;
  const net = data?.ytdUnapplied ?? 0;
  const netReconciled = Math.abs(net) < 0.005;
  // The tie-out gate. While the account's own spend doesn't reconcile to what
  // Loomi tracked, the over/under isn't a number to act on — applying it would
  // roll a data gap into next month's budget. Resolve the gap, then apply.
  const residualMonths = data?.residualMonths ?? [];
  const residualTotal = data?.residualTotal ?? 0;
  const tieOutBlocked = residualMonths.length > 0;
  const canApply = !!data?.targetPeriod && !netReconciled && !tieOutBlocked;
  // §4: name the settled months still carrying unapplied over/under.
  const unappliedMonthsLabel = monthRangeLabel(data?.unappliedMonths ?? []);
  // Reconcilable months whose spend can still move (an unsettled cross-month
  // flight is sitting in them) — their over/under isn't final.
  const pendingMonths = (data?.months ?? [])
    .filter(
      (m) =>
        Math.abs(m.pendingForward ?? 0) >= 0.005 &&
        m.period !== data?.targetPeriod,
    )
    .map((m) => m.period);

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
          {/* Backfill pulls account-total spend from Meta — Meta-only (Google has
              no pre-tool backfill), so the controls are hidden for Google. */}
          {!isGoogle && (
            <>
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
            </>
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
              {/* A month with dollars still waiting to move has an over/under
                  that isn't final: when the flight settles, that month's spend
                  changes and the difference resurfaces as unapplied. Applying
                  early isn't wrong (nothing double-counts — the ledger entry
                  keeps its amount and the delta comes back), but it means a
                  second pass, so say so before they click. */}
              {/* The apply gate. A clean tie-out is the precondition for
                  trusting the carryover: while the account's own spend doesn't
                  reconcile to what Loomi tracked, applying would roll a data gap
                  into next month's budget. */}
              {tieOutBlocked && (
                <Tooltip label="Meta says the account spent a different amount than the ads tracked here account for. Until that's resolved, the over/under isn't a number to act on — applying it would carry the gap into the live month's budget.">
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-right"
                    style={{ color: COLORS.warn }}
                  >
                    <ExclamationTriangleIcon className="h-3 w-3 flex-shrink-0" />
                    {monthRangeLabel(residualMonths)} don&apos;t tie out — resolve first
                  </span>
                </Tooltip>
              )}
              {pendingMonths.length > 0 && (
                <Tooltip label="A cross-month flight hasn't settled yet, so these months' spend can still change. Applying now is safe — the difference just comes back as unapplied when it settles — but you'll reconcile them twice.">
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-right"
                    style={{ color: COLORS.warn }}
                  >
                    <ExclamationTriangleIcon className="h-3 w-3 flex-shrink-0" />
                    {monthRangeLabel(pendingMonths)} not final yet
                  </span>
                </Tooltip>
              )}
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
                  <th className="text-right font-semibold px-3 py-2.5">
                    <Tooltip label="What the whole ad account spent this month, straight from Meta and dated to the day of delivery. Pulled independently of the ads tracked here, which is what lets the two be checked against each other.">
                      <span className="border-b border-dotted border-current">Raw Spend</span>
                    </Tooltip>
                  </th>
                  <th className="text-right font-semibold px-3 py-2.5">
                    <Tooltip label="Dollars LEAVING this month because their flight invoices in a different month. Settled flights only. Click a figure for the flights behind it.">
                      <span className="border-b border-dotted border-current">Cross-Month Out (−)</span>
                    </Tooltip>
                  </th>
                  <th className="text-right font-semibold px-3 py-2.5">
                    <Tooltip label="Dollars ARRIVING here from another month, because this is the month their flight invoices in. Settled flights only.">
                      <span className="border-b border-dotted border-current">Cross-Month In (+)</span>
                    </Tooltip>
                  </th>
                  <th className="text-right font-semibold px-3 py-2.5">
                    <Tooltip label="What the ads tracked here spent, counting each cross-month flight once in the month it bills. This is the spend the over/under is measured against. Raw − Out + In should land on the same number — when it doesn't, the gap is shown as a flagged line.">
                      <span className="border-b border-dotted border-current">Counted Spend</span>
                    </Tooltip>
                  </th>
                  <th className="text-right font-semibold px-3 py-2.5">Over / Under</th>
                  <th className="text-right font-semibold px-3 py-2.5 w-[200px]">Reconcile</th>
                </tr>
              </thead>
              <tbody>
                {data.months.length === 0 && (
                  <tr>
                    <td colSpan={colCount} className="px-3 py-8 text-center text-[var(--muted-foreground)]">
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
                  const hasAdDetail =
                    (m.ads?.length ?? 0) > 0 || (m.crossMonthLines?.length ?? 0) > 0;
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
                        {/* Raw shows whenever Meta has an account figure, even
                            for a month the pacer never tracked — "the account
                            spent this, Loomi counted nothing here" is exactly
                            what a reader needs to see to go and backfill it. */}
                        {m.hasActual || m.rawSource === 'account' ? (
                          <>
                            <div>{fmt(m.rawSpend)}</div>
                            {/* Raw that isn't the independent account pull can't
                                prove anything — say so rather than letting a
                                row-summed figure pass as Meta's own number. */}
                            {m.rawSource !== 'account' && (
                              <Tooltip
                                label={
                                  m.rawSource === 'backfill'
                                    ? "Backfilled from Meta's account total for a month the pacer didn't track."
                                    : "Meta's account total isn't available for this month, so this is the tracked ads added up. It can't be cross-checked against the account until the next successful sync."
                                }
                              >
                                <div className="text-[9px] text-[var(--muted-foreground)]">
                                  {m.rawSource === 'backfill' ? 'backfilled' : 'from tracked ads'}
                                </div>
                              </Tooltip>
                            )}
                            {/* Pending Forward (spec §2 col 10): informational —
                                these dollars are still counted HERE until the
                                flight settles, so the month never looks light
                                for money that hasn't arrived anywhere yet. */}
                            {Math.abs(m.pendingForward ?? 0) >= 0.005 && (
                              <Tooltip
                                label={`${fmt(m.pendingForward)} of this month's raw spend belongs to a flight that will invoice later. It stays counted here until the run ends and its billed month arrives — nothing has moved yet.`}
                              >
                                <div
                                  className="text-[9px] font-semibold"
                                  style={{ color: COLORS.warn }}
                                >
                                  {fmt(m.pendingForward)} pending →{' '}
                                  {pendingTargetLabel(m.crossMonthLines)}
                                </div>
                              </Tooltip>
                            )}
                          </>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>
                      <>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {Math.abs(m.crossMonthOut ?? 0) >= 0.005 ? (
                              <button
                                type="button"
                                onClick={() => toggleMonth(m.period)}
                                className="font-semibold hover:underline"
                                style={{ color: COLORS.warn }}
                              >
                                −{fmt(m.crossMonthOut)}
                              </button>
                            ) : (
                              <span className="text-[var(--muted-foreground)]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {Math.abs(m.crossMonthIn ?? 0) >= 0.005 ? (
                              <button
                                type="button"
                                onClick={() => toggleMonth(m.period)}
                                className="font-semibold hover:underline"
                                style={{ color: COLORS.lifetime }}
                              >
                                +{fmt(m.crossMonthIn)}
                              </button>
                            ) : (
                              <span className="text-[var(--muted-foreground)]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[var(--foreground)]">
                            {m.hasActual ? (
                              <>
                                <div>{fmt(m.countedSpend)}</div>
                                {/* The tie-out. Raw restated onto the billed
                                    basis should land exactly on Counted; the
                                    difference is spend the account made that
                                    Loomi never tracked (or a flight billed to
                                    the wrong month). It is a data gap to close,
                                    not an over/under to carry forward. */}
                                {m.residualChecked &&
                                  Math.abs(m.residual) >= 0.005 && (
                                    <Tooltip
                                      label={
                                        m.residual > 0
                                          ? `The account spent ${fmt(m.residual)} more this month than the ads tracked here account for. Usually an ad running in Meta that was never added to the pacer. Add it (or turn it off), then reconcile.`
                                          : `The ads tracked here account for ${fmt(-m.residual)} more than the account actually spent this month. Usually a cross-month flight billed to the wrong month, or a duplicated row.`
                                      }
                                    >
                                      <div
                                        className="text-[9px] font-semibold"
                                        style={{ color: COLORS.warn }}
                                      >
                                        {m.residual > 0 ? '+' : '−'}
                                        {fmt(Math.abs(m.residual))} in account, not in Loomi
                                      </div>
                                    </Tooltip>
                                  )}
                              </>
                            ) : (
                              <span className="text-[var(--muted-foreground)]">—</span>
                            )}
                          </td>
                        </>
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
                        <td colSpan={colCount} className="px-3 pb-3 pt-0 space-y-2">
                          {/* Spec §6: the Out / In / Pending cells must never be
                              bare numbers — expand to the flights behind them so
                              a reader sees WHY the month counts what it counts. */}
                          {(m.crossMonthLines?.length ?? 0) > 0 && (
                            <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 overflow-hidden">
                              <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] border-b border-[var(--border)]">
                                Cross-month flights
                              </div>
                              <div className="divide-y divide-[var(--border)]/60">
                                {m.crossMonthLines.map((l, i) => {
                                  const color =
                                    l.direction === 'in'
                                      ? COLORS.lifetime
                                      : l.direction === 'pending'
                                        ? COLORS.warn
                                        : COLORS.warn;
                                  const sign = l.direction === 'in' ? '+' : '−';
                                  return (
                                    <div
                                      key={`${m.period}-cm-${i}`}
                                      className="flex items-center justify-between gap-3 px-3 py-1.5"
                                    >
                                      <div className="min-w-0">
                                        <div className="text-[11px] text-[var(--foreground)] truncate">
                                          {l.flightName || 'Untitled flight'}
                                        </div>
                                        <div className="text-[9px] text-[var(--muted-foreground)]">
                                          {l.runStart ? fmtDate(l.runStart) : '—'} –{' '}
                                          {l.runEnd ? fmtDate(l.runEnd) : '—'} · bills{' '}
                                          <span className="font-semibold text-[var(--foreground)]">
                                            {fmtPeriodShort(l.billedMonth)}
                                          </span>{' '}
                                          · flight total {fmt(l.flightTotal)} ·{' '}
                                          {l.status === 'settled' ? 'settled' : 'pending'}
                                        </div>
                                      </div>
                                      <div className="flex-shrink-0 text-right">
                                        <div
                                          className="text-[11px] font-semibold tabular-nums"
                                          style={{ color }}
                                        >
                                          {sign}
                                          {fmt(l.amount)}
                                        </div>
                                        <div className="text-[9px] text-[var(--muted-foreground)]">
                                          {l.direction === 'in'
                                            ? 'in to here'
                                            : l.direction === 'out'
                                              ? 'out from here'
                                              : 'will leave at settlement'}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {(m.ads?.length ?? 0) > 0 && (
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
                          )}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* The tie-out, for the whole window. This is the headline proof:
              Raw comes from the account, Counted from the rows, and they are
              restated onto the same basis and compared. Clean means every dollar
              the account spent is in a number the pacer tracked. */}
          {(data.rawSpendAvailable ?? false) && (
            <div
              className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] ${
                tieOutBlocked
                  ? 'border-red-500/40 bg-red-500/10 text-red-400'
                  : 'border-[var(--border)] bg-[var(--muted)]/30 text-[var(--muted-foreground)]'
              }`}
            >
              {tieOutBlocked ? (
                <ExclamationTriangleIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              ) : (
                <CheckIcon
                  className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                  style={{ color: COLORS.success }}
                />
              )}
              <span>
                {tieOutBlocked ? (
                  <>
                    <span className="font-semibold">
                      {residualTotal > 0
                        ? `In account, not in Loomi: ${fmt(residualTotal)}`
                        : `Tracked here but not in the account: ${fmt(-residualTotal)}`}{' '}
                      ({monthRangeLabel(residualMonths)}).
                    </span>{' '}
                    {residualTotal > 0
                      ? "Meta reports more account spend than the ads tracked here add up to — usually an ad running in Meta that was never added to the pacer. It isn't an over/under to carry forward; add or turn off the ad, then reconcile."
                      : 'The ads tracked here add up to more than the account actually spent — usually a cross-month flight billed to the wrong month, or a duplicated row.'}{' '}
                    Applying is held until it&apos;s resolved.
                  </>
                ) : (
                  <>
                    Every dollar the account spent is accounted for: Meta&apos;s
                    account total, restated for cross-month billing, matches what
                    Loomi counted in every month checked.
                  </>
                )}
              </span>
            </div>
          )}
          {/* Flights held out of auto-reconciliation. Rare by design: the
              subtraction gives one lump for the months outside the billed one,
              and when it can't be placed honestly the flight raises its hand
              instead of posting a wrong number to a month. */}
          {reviewFlights.length > 0 && (
            <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2 text-[11px] text-[var(--muted-foreground)] space-y-1">
              {reviewFlights.map((f) => (
                <div key={`review-${f.flightId}`} className="flex items-start gap-2">
                  <ExclamationTriangleIcon
                    className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                    style={{ color: COLORS.warn }}
                  />
                  <span>
                    <span className="font-semibold text-[var(--foreground)]">
                      {f.flightName || 'Untitled flight'}
                    </span>{' '}
                    needs a manual review and is left out of the columns above.{' '}
                    {REVIEW_REASON_TEXT[f.reviewReason ?? ''] ??
                      'Its cross-month numbers cannot be worked out from the data on hand.'}
                  </span>
                </div>
              ))}
            </div>
          )}
          {/* The conservation check. Σ Out must equal Σ In (± the window's
              carry-in/carry-out). If it doesn't, a slice is orphaned or double
              counted and the reconciliation is FLAGGED rather than silently
              passed: this check is the answer to "can I trust the counted
              number". Shown as a quiet confirmation when it balances, because a
              proof nobody can see is not a proof. */}
          {flights.length > 0 && conservation && (
            <div
              className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] ${
                conservation.balanced
                  ? 'border-[var(--border)] bg-[var(--muted)]/30 text-[var(--muted-foreground)]'
                  : 'border-red-500/40 bg-red-500/10 text-red-400'
              }`}
            >
              {conservation.balanced ? (
                <CheckIcon
                  className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                  style={{ color: COLORS.success }}
                />
              ) : (
                <ExclamationTriangleIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              )}
              <span>
                {conservation.balanced ? (
                  <>
                    Cross-month dollars balance: {fmt(conservation.sumOut)} out,{' '}
                    {fmt(conservation.sumIn)} in
                    {Math.abs(conservation.carryOut) >= 0.005 && (
                      <>, {fmt(conservation.carryOut)} carried out past {data.year}</>
                    )}
                    {Math.abs(conservation.carryIn) >= 0.005 && (
                      <>, {fmt(conservation.carryIn)} carried in from before {data.year}</>
                    )}
                    . Every dollar counted exactly once.
                  </>
                ) : (
                  <>
                    <span className="font-semibold">
                      Cross-month dollars don&apos;t balance — off by{' '}
                      {fmt(Math.abs(conservation.delta))}.
                    </span>{' '}
                    {fmt(conservation.sumOut)} left their origin month but{' '}
                    {fmt(conservation.sumIn)} arrived. A slice is orphaned or double
                    counted, so the counted figures above are not trustworthy yet.
                    Check the flights in the expanded rows.
                  </>
                )}
              </span>
            </div>
          )}
          {/* §8a sanity flag: Meta does not permit lifetime overspend, so a
              settled flight computing over its cap signals a bad split entry
              rather than real spend. */}
          {flights.some((f) => f.exceedsBudgetCap || f.runSpendMismatch != null) && (
            <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2 text-[11px] text-[var(--muted-foreground)] space-y-1">
              {flights
                .filter((f) => f.exceedsBudgetCap)
                .map((f) => (
                  <div key={`cap-${f.flightId}`} className="flex items-start gap-2">
                    <ExclamationTriangleIcon
                      className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                      style={{ color: COLORS.warn }}
                    />
                    <span>
                      <span className="font-semibold text-[var(--foreground)]">
                        {f.flightName || 'Untitled flight'}
                      </span>{' '}
                      computes {fmt(f.flightTotal)} against a {fmt(f.budgetCap ?? 0)}{' '}
                      lifetime budget. Meta doesn&apos;t allow lifetime overspend, so
                      review the month split rather than treating this as real spend.
                    </span>
                  </div>
                ))}
              {flights
                .filter((f) => f.runSpendMismatch != null)
                .map((f) => (
                  <div key={`drift-${f.flightId}`} className="flex items-start gap-2">
                    <ExclamationTriangleIcon
                      className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                      style={{ color: COLORS.warn }}
                    />
                    <span>
                      <span className="font-semibold text-[var(--foreground)]">
                        {f.flightName || 'Untitled flight'}
                      </span>
                      : Meta reports {fmt(f.runSpendMismatch ?? 0)} for the full run but
                      its month rows sum to {fmt(f.flightTotal)}. A month row is missing
                      or stale — the slices are what the ledger counts.
                    </span>
                  </div>
                ))}
            </div>
          )}
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
  platform = 'meta',
}: {
  account: OverviewAccount;
  period: string;
  expanded: boolean;
  onToggle: () => void;
  onOpenAccount: () => void;
  filters: PlanFilters;
  currentUserId: string | null;
  users: DirectoryUser[];
  // Scopes the per-account notes drawer to the caller's platform ledger.
  platform?: 'meta' | 'google';
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
          platform={platform}
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
  platform = 'meta',
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
  // Scopes each row's notes drawer to the caller's platform (Google reuses this
  // whole overview for its admin drill-down).
  platform?: 'meta' | 'google';
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
          platform={platform}
        />
      ))}
    </div>
  );
}
