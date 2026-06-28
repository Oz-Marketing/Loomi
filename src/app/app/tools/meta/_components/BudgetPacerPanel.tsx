'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChartBarIcon,
  ChevronUpDownIcon,
  ClipboardDocumentListIcon,
  InformationCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { MetaBrandIcon } from '@/components/icons/platform-logos';
import { toast } from '@/lib/toast';
import type { PacerAd, PacerPlan } from '@/lib/ad-pacer/types';
import { type PlanFilters, EMPTY_FILTERS, applyFilters } from '@/lib/ad-pacer/filters';
import { COLORS } from '@/lib/ad-pacer/constants';
import { fmt, fmtDate, classifyPacerHealth } from '@/lib/ad-pacer/helpers';
import { buildPacerCalc } from '@/lib/ad-pacer/pacer-calc';
import { PacerRow, Tooltip, usePacerReadOnly } from '@/app/app/tools/_shared';
import { AdSetLinkPicker, type MetaAdSetOption } from './AdSetLinkPicker';
import { FilterStatus } from './FilterSidebar';

// Meta Pace view: spend-pacing panel (PacerRow cards) + its Meta-only slot
// helpers + spend totals. Split out of MetaAdsPlannerTool to shrink the file.
function MetaSyncInfo({ ad, timeZone }: { ad: PacerAd; timeZone: string }) {
  if (!ad.metaObjectId || (!ad.metaStartDate && !ad.metaEndDate)) return null;
  const effectiveEnd = buildPacerCalc(ad, Date.now(), timeZone).effectiveEnd;
  const parts: string[] = [
    `Meta run: ${ad.metaStartDate ? fmtDate(ad.metaStartDate) : '—'} → ${ad.metaEndDate ? fmtDate(ad.metaEndDate) : 'ongoing'}`,
  ];
  if (effectiveEnd && (!ad.metaEndDate || ad.metaEndDate > effectiveEnd)) {
    parts.push(`Paced to ${fmtDate(effectiveEnd)} (month end)`);
  }
  return (
    <Tooltip label={parts.join(' · ')} placement="top">
      <span className="inline-flex flex-shrink-0 items-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
        <InformationCircleIcon className="w-4 h-4" />
      </span>
    </Tooltip>
  );
}

/**
 * Meta status mismatch (Change 11): Meta reports the ad not delivering while the
 * planner still says Live mid-flight; don't auto-flip (Meta "paused" can be a
 * daily cap / billing hold) — surface a one-click confirm. null when in sync.
 */
function MetaStatusMismatch({
  ad,
  onMarkOff,
}: {
  ad: PacerAd;
  onMarkOff: () => void;
}) {
  const readOnly = usePacerReadOnly();
  const meta = ad.metaEffectiveStatus;
  const plannerLive =
    ad.adStatus === 'Live' || ad.adStatus === 'Live - Changes Required';
  if (!meta || !plannerLive || meta.toUpperCase() === 'ACTIVE') return null;
  const through = ad.metaEndDate ?? ad.flightEnd;
  return (
    <div
      className="mb-3.5 rounded-md border px-2.5 py-2 text-[10px]"
      style={{ borderColor: `${COLORS.warn}66`, background: 'rgba(245,158,11,0.08)' }}
    >
      <div className="text-[var(--foreground)] leading-snug">
        Meta shows <span className="font-semibold">{meta}</span>
        {through ? <> — but scheduled through {fmtDate(through)}</> : null}.
      </div>
      <button
        type="button"
        onClick={onMarkOff}
        disabled={readOnly}
        className="mt-1 inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--card)] px-2 py-0.5 font-medium text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Mark Off in planner
      </button>
    </div>
  );
}

// ─── Budget Pacer panel ────────────────────────────────────────────────────
export interface AccountPacing {
  // 'final' = a settled (frozen/closed) month's final variance (colored
  // over/under verdict). 'progress' = a LIVE month's plain spend-of-target
  // readout — deliberately NOT a pace verdict, so a mid-month "60% spent" can't
  // false-alarm as "under"; the per-ad pacing badges carry the on-pace judgment.
  mode: 'progress' | 'final';
  pct: number; // spent ÷ target × 100
  status: 'on-track' | 'over' | 'under' | 'neutral'; // 'progress' is always neutral
  spent: number; // account actual spend
  target: number; // effective spend target (client budget × markup + carryover)
  dayElapsed: number; // live only: day-of-month so the % reads in context
  dayTotal: number;
}

export function PacerSpendTotals({
  base,
  added,
  actual,
  pacing,
}: {
  base: number;
  added: number;
  actual: number;
  // Account-wide pacing vs TIME-ADJUSTED expected spend (Change 9), aggregated
  // per-ad (finished ads contribute full target, mid-flight ads prorated).
  pacing?: AccountPacing | null;
}) {
  const isFinal = pacing?.mode === 'final';
  const isProgress = pacing?.mode === 'progress';
  // 'final' = a colored over/under verdict; 'progress' = a neutral readout.
  const pacingColor =
    pacing == null
      ? undefined
      : isProgress
        ? 'var(--muted-foreground)'
        : pacing.status === 'on-track'
          ? COLORS.success
          : pacing.status === 'over'
            ? COLORS.error
            : COLORS.warn;
  const pacingHeader = isFinal ? 'Final variance' : 'Spend progress';
  const pacingTitle = isFinal
    ? "Settled month: total actual spend vs the account's effective target (client budget × markup + carryover) — the final over/under, matching the Over/Under page."
    : "Account spend so far vs the month's effective target (client budget × markup + carryover), with day-of-month context. A plain progress readout — NOT a pace verdict; read the per-ad pacing badges for on-track health.";
  // Big headline value (matches Total Spend / Actual) + a small gray sub-line.
  const pacingMain =
    pacing == null
      ? ''
      : isFinal
        ? pacing.status === 'on-track'
          ? 'On target'
          : `${pacing.pct - 100 > 0 ? '+' : ''}${(pacing.pct - 100).toFixed(1)}% ${
              pacing.status === 'over' ? 'over' : 'under'
            }`
        : `${pacing.pct.toFixed(0)}% of target`;
  const pacingSub =
    pacing == null
      ? ''
      : isFinal
        ? 'final variance'
        : `day ${pacing.dayElapsed}/${pacing.dayTotal}`;
  const barPct = pacing ? Math.min(Math.max(pacing.pct, 0), 100) : 0;
  // Neutral brand color for a live progress readout; status color for a
  // settled month's verdict.
  const barColor = isProgress ? COLORS.lifetime : pacingColor;
  return (
    <div className="flex flex-wrap items-start justify-end gap-6">
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
          Total Spend
        </div>
        <div className="text-lg font-bold text-[var(--foreground)]">
          {fmt(base + added)}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
          Actual (Pacer)
        </div>
        <div className="text-lg font-bold" style={{ color: COLORS.lifetime }}>
          {fmt(actual)}
        </div>
      </div>
      {pacing && pacingColor && (
        <Tooltip label={pacingTitle}>
        <div className="min-w-[160px]">
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
            {pacingHeader}
          </div>
          <div
            className="text-lg font-bold whitespace-nowrap"
            style={{ color: isProgress ? 'var(--foreground)' : pacingColor }}
          >
            {pacingMain}
          </div>
          <div className="text-[10px] text-[var(--muted-foreground)]">
            {pacingSub}
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${barPct}%`, background: barColor }}
            />
          </div>
        </div>
        </Tooltip>
      )}
    </div>
  );
}

export function BudgetPacerPanel({
  plan,
  filters,
  onFiltersChange,
  currentUserId,
  onChange,
  accountKey,
  headerActions,
}: {
  plan: PacerPlan;
  filters: PlanFilters;
  onFiltersChange: (next: PlanFilters) => void;
  currentUserId: string | null;
  onChange: (p: PacerPlan) => void;
  accountKey: string;
  headerActions?: React.ReactNode;
}) {
  // Frozen-month lock — passed to the shared PacerRow's injected link picker.
  const readOnly = usePacerReadOnly();
  // Per-ad expand state. Auto-seeded on first render (and on plan
  // changes) so rows that need attention are open by default; rep can
  // still toggle each manually.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const seededExpandedRef = useRef(false);
  // Cross-month reassurance note is dismissible (X) — once closed it stays
  // hidden for this view.
  const [crossMonthNoteDismissed, setCrossMonthNoteDismissed] = useState(false);

  const updateAd = (u: PacerAd) =>
    onChange({ ...plan, ads: plan.ads.map((a) => (a.id === u.id ? u : a)) });

  // Lazy-loaded Meta ad-set list for the per-row link picker. Fetched once on
  // first picker focus, then shared across every row.
  const [metaAdSets, setMetaAdSets] = useState<MetaAdSetOption[] | null>(null);
  const [adSetsLoading, setAdSetsLoading] = useState(false);
  const [adSetsError, setAdSetsError] = useState<string | null>(null);
  const loadMetaAdSets = useCallback(async () => {
    if (metaAdSets || adSetsLoading) return;
    setAdSetsLoading(true);
    setAdSetsError(null);
    try {
      const res = await fetch(`/api/meta-ads-pacer/${accountKey}/meta-adsets`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setAdSetsError(data?.error || 'Failed to load ad sets.');
        return;
      }
      setMetaAdSets(Array.isArray(data?.adSets) ? data.adSets : []);
    } catch {
      setAdSetsError('Failed to load ad sets.');
    } finally {
      setAdSetsLoading(false);
    }
  }, [accountKey, metaAdSets, adSetsLoading]);

  // Write a row's edited daily budget back to its linked Meta ad set. Returns a
  // result the row renders inline (the agency token needs `ads_management`, so
  // a read-only token surfaces Meta's permission error here).
  const pushDailyBudget = useCallback(
    async (adId: string, value: string): Promise<{ ok: boolean; text: string }> => {
      try {
        const res = await fetch(
          `/api/meta-ads-pacer/${accountKey}/push-budget?period=${plan.period}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adId, dailyBudget: value }),
          },
        );
        const data = await res.json().catch(() => null);
        if (!res.ok) return { ok: false, text: data?.error || 'Push failed.' };
        return { ok: true, text: 'Pushed to Meta ✓' };
      } catch {
        return { ok: false, text: 'Push failed — network error.' };
      }
    },
    [accountKey, plan.period],
  );

  // §2: resolve a cross-month straddler (count its full run in its own month),
  // set a lifetime planned split, or clear. Optimistically updates the ad's
  // persisted resolution fields, then writes through the dedicated endpoint
  // (server-authoritative, so a re-sync or autosave can't clobber it).
  const resolveCrossMonth = useCallback(
    async (
      adId: string,
      action: 'apply_full_run' | 'split' | 'clear',
      splitMap?: Record<string, number>,
    ) => {
      // The CTA is disabled when frozen and the endpoint rejects a frozen
      // month (409), so no client-side readOnly guard is needed here.
      const prior = plan.ads.find((a) => a.id === adId);
      onChange({
        ...plan,
        ads: plan.ads.map((a) =>
          a.id === adId
            ? {
                ...a,
                fullRunAppliedToMonth:
                  action === 'apply_full_run' ? plan.period : null,
                lifetimeMonthSplit:
                  action === 'split' ? JSON.stringify(splitMap ?? {}) : null,
              }
            : a,
        ),
      });
      try {
        const res = await fetch(
          `/api/meta-ads-pacer/${accountKey}/resolve-cross-month?period=${plan.period}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              adId,
              action,
              ...(action === 'split' ? { splitMap } : {}),
            }),
          },
        );
        if (!res.ok) {
          const d = await res.json().catch(() => null);
          toast.error(d?.error || 'Failed to update cross-month resolution.');
          if (prior) {
            onChange({
              ...plan,
              ads: plan.ads.map((a) => (a.id === adId ? prior : a)),
            });
          }
        }
      } catch {
        toast.error('Failed to update cross-month resolution — network error.');
        if (prior) {
          onChange({
            ...plan,
            ads: plan.ads.map((a) => (a.id === adId ? prior : a)),
          });
        }
      }
    },
    [accountKey, plan, onChange],
  );

  const visibleAds = useMemo(
    () => applyFilters(plan.ads, filters, currentUserId),
    [plan.ads, filters, currentUserId],
  );
  const allExpanded =
    visibleAds.length > 0 && visibleAds.every((a) => expandedIds.has(a.id));


  // Auto-expand needs-attention rows ONCE per mount so the rep lands on
  // the things that need work. Re-running on plan change would fight
  // the user's manual collapses; we instead seed once and let the user
  // own the state from there.
  useEffect(() => {
    if (seededExpandedRef.current) return;
    if (plan.ads.length === 0) return;
    seededExpandedRef.current = true;
    const next = new Set<string>();
    const nowMs = Date.now();
    plan.ads.forEach((ad) => {
      const c = buildPacerCalc(ad, nowMs, plan.timeZone);
      const h = classifyPacerHealth(ad, c);
      if (h.state === 'over-budget' || h.state === 'overpacing') {
        next.add(ad.id);
      }
    });
    if (next.size > 0) setExpandedIds(next);
  }, [plan.ads, plan.timeZone]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (plan.ads.length === 0) {
    return (
      <div>
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <h2 className="m-0 flex items-center gap-2 text-base font-bold tracking-tight text-[var(--foreground)]">
            <ChartBarIcon className="w-4 h-4" />
            Spend Pacing
          </h2>
          {headerActions}
        </div>
        <div className="glass-section-card rounded-xl px-6 py-12 text-center">
          <ClipboardDocumentListIcon className="w-10 h-10 mx-auto mb-3 text-[var(--muted-foreground)]" />
          <div className="text-sm text-[var(--foreground)] font-medium mb-1">
            No ads in your plan yet.
          </div>
          <div className="text-xs text-[var(--muted-foreground)]">
            Add ads in the Ad Planner tab and they'll appear here automatically.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <h2 className="m-0 flex items-center gap-2 text-base font-bold tracking-tight text-[var(--foreground)]">
          <ChartBarIcon className="w-4 h-4" />
          {`Spend Pacing (${visibleAds.length}${
            visibleAds.length !== plan.ads.length ? ` of ${plan.ads.length}` : ''
          } ad${plan.ads.length !== 1 ? 's' : ''})`}
        </h2>
        {/* All actions live on one row, grouped: table/bulk controls first,
            then a divider, then the account/Meta actions. */}
        <div className="flex items-center justify-end gap-2 flex-wrap">
          <Tooltip label={allExpanded ? 'Collapse all rows' : 'Expand all rows'}>
          <button
            type="button"
            onClick={() =>
              setExpandedIds(
                allExpanded ? new Set() : new Set(visibleAds.map((a) => a.id)),
              )
            }
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <ChevronUpDownIcon className="w-3.5 h-3.5" />
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
          </Tooltip>
          {headerActions && (
            <>
              <div className="mx-1 h-5 w-px bg-[var(--border)]" />
              {headerActions}
            </>
          )}
        </div>
      </div>
      {(() => {
        // Reassurance that an odd-looking total is explained — driven by the
        // user's MANUAL cross-month marks (no auto-detection): a billed
        // cross-month ad counts its full run in the over/under though only its
        // in-month slice lands in the month total.
        const crossMonthCount = visibleAds.filter(
          (a) => a.fullRunAppliedToMonth != null,
        ).length;
        if (crossMonthCount === 0 || crossMonthNoteDismissed) return null;
        return (
          <div
            className="mb-3 flex items-start justify-between gap-3 rounded-md border px-2.5 py-1.5 text-[11px]"
            style={{
              borderColor: 'rgba(249,115,22,0.3)',
              background: 'rgba(249,115,22,0.08)',
              color: '#f97316',
            }}
          >
            <span>
              {crossMonthCount} ad{crossMonthCount === 1 ? '' : 's'} billed
              cross-month — the full run is counted in the over/under though part
              spent in another month, so the monthly total can differ (expand a
              flagged row for details).
            </span>
            <Tooltip label="Dismiss" className="flex-shrink-0">
            <button
              type="button"
              onClick={() => setCrossMonthNoteDismissed(true)}
              aria-label="Dismiss"
              className="-mr-0.5 rounded p-0.5 hover:bg-[var(--muted)] transition-colors"
            >
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
            </Tooltip>
          </div>
        );
      })()}
      <FilterStatus
        filters={filters}
        onClear={() => onFiltersChange(EMPTY_FILTERS)}
        filteredCount={visibleAds.length}
        totalCount={plan.ads.length}
      />
      {visibleAds.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] py-10 px-6 text-center text-sm text-[var(--muted-foreground)]">
          No ads match the current filters.
        </div>
      ) : (
        visibleAds.map((ad) => (
          <PacerRow
            key={`${ad.id}-${ad.budgetType}`}
            ad={ad}
            index={plan.ads.findIndex((a) => a.id === ad.id)}
            timeZone={plan.timeZone}
            onActualChange={(v) => updateAd({ ...ad, pacerActual: v })}
            onDailyBudgetChange={(v) => updateAd({ ...ad, pacerDailyBudget: v })}
            expanded={expandedIds.has(ad.id)}
            onToggleExpanded={() => toggleExpanded(ad.id)}
            onMuteToggle={() =>
              updateAd({ ...ad, alertsMuted: !ad.alertsMuted })
            }
            onPushDailyBudget={(value) => pushDailyBudget(ad.id, value)}
            onResolveCrossMonth={(action, splitMap) =>
              resolveCrossMonth(ad.id, action, splitMap)
            }
            siblings={plan.siblingsByName?.[ad.name] ?? null}
            synced={!!ad.metaObjectId && !!ad.pacerSyncedAt}
            linkError={adSetsError}
            pushLabel="Push to Meta"
            pushIcon={<MetaBrandIcon className="w-3.5 h-3.5" />}
            linkPicker={
              <AdSetLinkPicker
                value={ad.metaObjectId}
                options={metaAdSets}
                loading={adSetsLoading}
                error={adSetsError}
                onOpen={loadMetaAdSets}
                onChange={(adSetId) =>
                  updateAd({
                    ...ad,
                    metaObjectId: adSetId,
                    metaObjectType: adSetId ? 'adset' : null,
                  })
                }
                disabled={readOnly}
              />
            }
            syncInfo={<MetaSyncInfo ad={ad} timeZone={plan.timeZone} />}
            statusMismatch={
              <MetaStatusMismatch
                ad={ad}
                onMarkOff={() => updateAd({ ...ad, adStatus: 'Off' })}
              />
            }
          />
        ))
      )}
    </div>
  );
}

// ─── Summary panel (top-level Summary tab) ─────────────────────────────────
