'use client';

import { useEffect, useState } from 'react';
import { ScaleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { COLORS } from '@/lib/ad-pacer/constants';
import { fmt, num, effMarkupOf, sourceColor, sourceLabel } from '@/lib/ad-pacer/helpers';
import { effectiveActual, effectiveTarget } from '@/lib/ad-pacer/pacer-calc';
import { fmtPeriodLong, daysInPeriod, daysElapsedInPeriod } from '@/lib/ad-pacer/period';
import { Tooltip } from './Tooltip';

// Within-month, per-ad Over/Under Spend diagnostic — shared by Meta + Google.
// Platform-scoped via the `platform` prop (appends &platform= to the per-account
// plan fetch); omit it for Meta's existing all-ads behavior.
// ─── Over/Under Spend panel ────────────────────────────────────────────────
interface YearMonthRow {
  period: string;
  clientBudget: number; // gross client budget (Base + Added) — context only
  spendTarget: number; // margin-adjusted target (client budget × markup)
  actual: number; // actual spend
}

interface MonthAd {
  id: string;
  name: string;
  budgetSource: 'base' | 'added' | 'split';
  budgetType: 'Daily' | 'Lifetime';
  // When budgetSource === 'split', this is the dollar portion of
  // `allocation` drawn from Base. The rest comes from Added. Spend
  // apportions proportionally for the Over/Under math.
  splitBaseAmount: string | null;
  allocation: number;
  actual: number;
  // §3: a lifetime ad still running — excluded from the over/under base (both
  // its actual slice AND its allocation) while in progress; books its single
  // variance once it completes. Still counted in total month spend.
  lifetimeInProgress: boolean;
  // §2a: the YYYY-MM the ad's full run was counted in (resolved straddler), or
  // null. Drives the 'full run → applied to [month]' badge on the row.
  fullRunAppliedToMonth: string | null;
  // Cross-month clarity: this ad's over/under contribution + WHY it differs from
  // plan. Computed server-side (classifyAdVariance) so every surface agrees.
  variance?: {
    inMonthSpend: number;
    billedActual: number;
    contribution: number;
    klass: 'real' | 'billed-cross-month' | 'lifetime-in-progress';
    settlesThisMonth?: boolean;
  };
}

interface MonthPlanData {
  baseBudgetGoal: number;
  addedBudgetGoal: number;
  // Per-account markup override; null = fall back to the agency default markup.
  // Needed for the Over/Under math because pacerActual is in actual-spend
  // dollars while the budget goals are gross client dollars.
  markup: number | null;
  // All-accounts mode only: a pre-summed spend target where each account's own
  // markup was already applied before summing (a single cross-account markup
  // would be wrong). When set, it's the variance basis instead of
  // gross × markup. null in single-account mode (computed from the goals).
  spendTargetOverride: number | null;
  ads: MonthAd[];
}

export function ComparePanel({
  accountKey,
  period,
  platform,
}: {
  accountKey: string | null;
  period: string;
  /** Scope the per-account fetch to a platform (Google passes 'google'). */
  platform?: 'meta' | 'google';
}) {
  // §6: the Over/Under page is a within-month, per-ad diagnostic only. Everything
  // cross-month/annual (running balance, adjusted targets, apply/undo, audit
  // trail) lives on the Reconciliation page, which owns it — so the old "Year"
  // tab here (an unadjusted, no-reconcile duplicate of that table) is removed.
  return (
    <div>
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <h2 className="m-0 flex items-center gap-2 text-base font-bold tracking-tight text-[var(--foreground)]">
          <ScaleIcon className="w-4 h-4" />
          {accountKey ? 'Over/Under Spend' : 'Over/Under Spend — all accounts'}
        </h2>
      </div>
      <OverUnderMonthView accountKey={accountKey} period={period} platform={platform} />
    </div>
  );
}

function OverUnderMonthView({
  accountKey,
  period,
  platform,
}: {
  accountKey: string | null;
  // Driven by the page's sticky-header month selector — no separate in-page
  // selector (single source of truth for the active month).
  period: string;
  platform?: 'meta' | 'google';
}) {
  const [data, setData] = useState<MonthPlanData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLoadError(null);

    const url = accountKey
      ? `/api/meta-ads-pacer/${accountKey}?period=${period}${platform ? `&platform=${platform}` : ''}`
      : `/api/meta-ads-pacer/year-summary?year=${period.slice(0, 4)}`;

    fetch(url)
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(`HTTP ${r.status} ${text.slice(0, 200)}`);
        }
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        if (accountKey) {
          const ads = Array.isArray(json?.ads) ? json.ads : [];
          setData({
            baseBudgetGoal: num(json?.baseBudgetGoal) ?? 0,
            addedBudgetGoal: num(json?.addedBudgetGoal) ?? 0,
            markup:
              typeof json?.markup === 'number' && Number.isFinite(json.markup)
                ? json.markup
                : null,
            // Single account: target is derived from goals × markup below.
            spendTargetOverride: null,
            ads: ads.map(
              (a: {
                id: string;
                name?: string | null;
                budgetSource?: string;
                budgetType?: string;
                period?: string;
                splitBaseAmount?: string | null;
                allocation?: string | null;
                pacerActual?: string | null;
                pacerRunSpend?: string | null;
                fullRunAppliedToMonth?: string | null;
                lifetimeInProgress?: boolean;
                variance?: {
                  inMonthSpend: number;
                  billedActual: number;
                  contribution: number;
                  klass: 'real' | 'billed-cross-month' | 'lifetime-in-progress';
                  settlesThisMonth?: boolean;
                };
              }) => {
                const eff = { ...a, period: a.period ?? period };
                return {
                  id: a.id,
                  name: a.name || 'Untitled Ad',
                  budgetSource:
                    a.budgetSource === 'split'
                      ? ('split' as const)
                      : a.budgetSource === 'added'
                        ? ('added' as const)
                        : ('base' as const),
                  budgetType:
                    a.budgetType === 'Lifetime'
                      ? ('Lifetime' as const)
                      : ('Daily' as const),
                  splitBaseAmount: a.splitBaseAmount ?? null,
                  allocation: effectiveTarget(eff),
                  // Display/total = what actually spent THIS month (the slice);
                  // the over/under uses billedActual from `variance` below.
                  actual: a.variance?.inMonthSpend ?? effectiveActual(eff),
                  lifetimeInProgress: a.lifetimeInProgress === true,
                  fullRunAppliedToMonth: a.fullRunAppliedToMonth ?? null,
                  variance: a.variance,
                };
              },
            ),
          });
        } else {
          // All-accounts mode — fall back to the year-summary aggregate
          // for the selected month. No per-ad breakdown available here, but
          // the endpoint already applied each account's own markup to build
          // spendTarget, so we use that directly as the variance basis rather
          // than re-applying one blanket markup to the cross-account gross.
          const months: YearMonthRow[] = Array.isArray(json?.months) ? json.months : [];
          const row = months.find((m) => m.period === period);
          setData({
            baseBudgetGoal: row?.clientBudget ?? 0,
            addedBudgetGoal: 0,
            markup: null,
            spendTargetOverride: row?.spendTarget ?? 0,
            ads: row
              ? [
                  {
                    id: 'aggregate',
                    name: 'All tracked ads (aggregate)',
                    budgetSource: 'base' as const,
                    budgetType: 'Daily' as const,
                    splitBaseAmount: null,
                    allocation: row.clientBudget,
                    actual: row.actual,
                    lifetimeInProgress: false,
                    fullRunAppliedToMonth: null,
                  },
                ]
              : [],
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('[meta-ads-pacer] over/under month load failed', err);
        setLoadError(err instanceof Error ? err.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, period, platform]);

  // Budget goals are stored gross; pacerActual is actual-spend. Convert
  // budget through the account's effective markup so the comparison is
  // apples-to-apples (everything in actual-spend dollars).
  const effectiveMarkup = effMarkupOf(data?.markup);
  const budgetGross = data ? data.baseBudgetGoal + data.addedBudgetGoal : 0;
  // All-accounts mode supplies a pre-summed, per-account-correct target;
  // single-account mode derives it from this account's goals × markup.
  const budgetActual =
    data?.spendTargetOverride != null
      ? data.spendTargetOverride
      : budgetGross * effectiveMarkup;
  // The split (X2): two reconciling totals.
  //  • totalInMonth — what actually spent THIS calendar month (every ad's
  //    in-month slice). The honest "total spend".
  //  • overUnderActual — what the over/under is BILLED on: the full run for an
  //    ad the user billed cross-month (variance.billedActual), and $0 for an
  //    in-progress lifetime ad (§3, books on completion) — so both are handled
  //    without a separate subtraction.
  const allAds = data?.ads ?? [];
  const inProgressLifetime = allAds.filter((a) => a.lifetimeInProgress);
  // Of those, the cross-month runs deferred to a future month (vs single-month
  // lifetime ads that settle at this month's close — Prompt 2).
  const deferredLifetimeCount = inProgressLifetime.filter(
    (a) => a.variance?.settlesThisMonth === false,
  ).length;
  const ipLifeAlloc = inProgressLifetime.reduce((s, a) => s + a.allocation, 0);
  const totalInMonth = allAds.reduce((s, a) => s + a.actual, 0);
  const overUnderActual = allAds.reduce(
    (s, a) => s + (a.variance?.billedActual ?? a.actual),
    0,
  );
  const daysIn = daysInPeriod(period);
  const daysElapsed = daysElapsedInPeriod(period);
  // Target nets out an in-progress lifetime ad's allocation (§3).
  const shouldHaveSpent = budgetActual - ipLifeAlloc;
  const variance = overUnderActual - shouldHaveSpent;

  // What explains total ≠ over/under basis: cross-month-billed runs (billed here
  // but spent in another month) + in-progress lifetime spend (spent this month,
  // not yet booked).
  const billedElsewhere = allAds.reduce(
    (s, a) =>
      a.variance?.klass === 'billed-cross-month'
        ? s + (a.variance.billedActual - a.variance.inMonthSpend)
        : s,
    0,
  );
  const heldOutLifetime = inProgressLifetime.reduce((s, a) => s + a.actual, 0);
  const crossMonthCount = allAds.filter(
    (a) => a.variance?.klass === 'billed-cross-month',
  ).length;

  const varianceColor = (v: number) =>
    Math.abs(v) < 0.005
      ? COLORS.success
      : v > 0
        ? COLORS.error
        : COLORS.warn;

  return (
    <div>
      {/* Month is controlled by the page's sticky-header selector — this is a
          read-only label for context, not a second selector. */}
      <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
        <span className="text-sm font-bold text-[var(--foreground)]">
          {fmtPeriodLong(period)}
        </span>
        <div className="text-[10px] text-[var(--muted-foreground)]">
          {daysElapsed} of {daysIn} day{daysIn === 1 ? '' : 's'} elapsed
        </div>
      </div>

      {loadError ? (
        <div className="glass-section-card rounded-xl text-center py-12 px-6">
          <ExclamationTriangleIcon className="w-8 h-8 mx-auto mb-3 text-red-400" />
          <p className="text-sm text-[var(--foreground)] font-medium mb-1">
            Could not load monthly over/under.
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">{loadError}</p>
        </div>
      ) : data == null ? (
        <div className="text-center py-12 text-[var(--muted-foreground)] text-sm">
          Loading…
        </div>
      ) : (
        <div className="space-y-4">
          {/* Per-ad spend block — denser 2-column grid so 10+ ads stay
              readable without a long scroll. Single-column on mobile. */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
            <div className="px-3 py-2 bg-[var(--muted)] border-b border-[var(--border)] text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
              Spend by ad
            </div>
            {data.ads.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-[var(--muted-foreground)]">
                No ads in {fmtPeriodLong(period)}.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-px gap-y-px bg-[var(--border)]">
                  {data.ads.map((ad) => (
                    <div
                      key={ad.id}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 bg-[var(--card)]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium text-[var(--foreground)] truncate leading-tight">
                          {ad.name}
                        </div>
                        {ad.id !== 'aggregate' && (
                          <div className="text-[9px] leading-tight">
                            <span
                              className="font-semibold"
                              style={{ color: sourceColor(ad.budgetSource) }}
                            >
                              {sourceLabel(ad.budgetSource)}
                            </span>
                            <span className="text-[var(--muted-foreground)]">
                              {' · '}
                              {ad.allocation > 0 ? fmt(ad.allocation) : '—'}
                            </span>
                            {ad.lifetimeInProgress && (
                              ad.variance?.settlesThisMonth === false ? (
                                <Tooltip label="Cross-month lifetime run — its variance settles in a future month at flight completion (excluded here, still counted in total spend).">
                                <span
                                  className="ml-1 font-semibold"
                                  style={{ color: COLORS.lifetime }}
                                >
                                  · lifetime · settles on completion
                                </span>
                                </Tooltip>
                              ) : (
                                <Tooltip label="Lifetime ad — not paceable (Meta controls delivery). It settles at this month's close, not a future month.">
                                <span
                                  className="ml-1 font-semibold"
                                  style={{ color: COLORS.lifetime }}
                                >
                                  · lifetime · settles at month end
                                </span>
                                </Tooltip>
                              )
                            )}
                            {ad.fullRunAppliedToMonth && (
                              <Tooltip label="Full run counted in this month — the over/under compares the full run to the full target.">
                              <span
                                className="ml-1 font-semibold"
                                style={{ color: '#f97316' }}
                              >
                                · full run → {fmtPeriodLong(ad.fullRunAppliedToMonth)}
                              </span>
                              </Tooltip>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <div className="text-sm font-semibold text-[var(--foreground)] tabular-nums">
                          {fmt(ad.actual)}
                        </div>
                        {ad.id !== 'aggregate' &&
                          ad.variance &&
                          ad.variance.klass !== 'lifetime-in-progress' &&
                          Math.abs(ad.variance.contribution) >= 0.005 && (
                            <Tooltip
                              label={
                                ad.variance.klass === 'billed-cross-month'
                                  ? "This ad's over/under on its FULL run vs target (billed in this month)."
                                  : "This ad's over/under vs its allocation."
                              }
                            >
                            <div
                              className="text-[9px] font-semibold tabular-nums leading-tight"
                              style={{ color: varianceColor(ad.variance.contribution) }}
                            >
                              {ad.variance.contribution >= 0 ? '+' : '−'}
                              {fmt(Math.abs(ad.variance.contribution))}
                            </div>
                            </Tooltip>
                          )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2 bg-[var(--muted)]/40 border-t-2 border-[var(--border)]">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--foreground)]">
                    Total spent this month · {data.ads.length} ad{data.ads.length === 1 ? '' : 's'}
                  </div>
                  <div className="text-sm font-bold tabular-nums text-[var(--foreground)]">
                    {fmt(totalInMonth)}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Client budget / should-have-spent (left) and the variance vs
              should-have-spent (right). */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                    Client Budget
                  </div>
                  <div className="text-base font-bold tabular-nums text-[var(--foreground)]">
                    {fmt(budgetGross)}
                  </div>
                  {accountKey && (
                    <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                      Base {fmt(data.baseBudgetGoal)} + Added{' '}
                      {fmt(data.addedBudgetGoal)}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                    Should have spent
                  </div>
                  <div
                    className="text-base font-bold tabular-nums"
                    style={{ color: COLORS.daily }}
                  >
                    {fmt(shouldHaveSpent)}
                  </div>
                  <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                    {`${fmt(budgetGross)} × ${effectiveMarkup}`}
                    {ipLifeAlloc > 0
                      ? ` − ${fmt(ipLifeAlloc)} lifetime in progress`
                      : ''}
                  </div>
                </div>
              </div>
            </div>
            {/* Variance — tracked spend vs should-have-spent. Positive =
                overspent; negative = underspent. */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                Variance vs Should Have Spent
              </div>
              <div
                className="text-2xl font-bold tabular-nums"
                style={{ color: varianceColor(variance) }}
              >
                {`${variance >= 0 ? '+' : '-'}${fmt(Math.abs(variance))}`}
                <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">
                  {variance > 0.005
                    ? 'overspent'
                    : variance < -0.005
                      ? 'underspent'
                      : 'on target'}
                </span>
              </div>
              <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                billed{' '}
                <span className="font-semibold text-[var(--foreground)]">
                  {fmt(overUnderActual)}
                </span>
                {' − '}
                <span className="font-semibold text-[var(--foreground)]">
                  {fmt(shouldHaveSpent)}
                </span>
                {' should have spent'}
              </div>
              {crossMonthCount > 0 && (
                <Tooltip label="These ads are billed in this month though they ran across months — the over/under counts their full run, so the month's total spend is lower by the part that spent in another month.">
                <div
                  className="text-[10px] mt-1"
                  style={{ color: '#f97316' }}
                >
                  {crossMonthCount} ad{crossMonthCount === 1 ? '' : 's'} billed cross-month ·{' '}
                  <span className="font-semibold text-[var(--foreground)]">
                    {fmt(billedElsewhere)}
                  </span>{' '}
                  of the billed spend landed in another month (total spent this month{' '}
                  {fmt(totalInMonth)})
                </div>
                </Tooltip>
              )}
              {inProgressLifetime.length > 0 && (
                <Tooltip label="A lifetime ad still running is excluded from the over/under — both its spend and its target — until its run completes, when its single variance books once. Its spend is still counted in the tracked total above.">
                <div
                  className="text-[10px] mt-1"
                  style={{ color: COLORS.lifetime }}
                >
                  Excludes {inProgressLifetime.length} lifetime ad
                  {inProgressLifetime.length === 1 ? '' : 's'} in progress ·{' '}
                  {fmt(heldOutLifetime)} spent ·{' '}
                  {deferredLifetimeCount === inProgressLifetime.length
                    ? 'settles on completion'
                    : deferredLifetimeCount === 0
                      ? 'settles at month end'
                      : `${deferredLifetimeCount} settle on completion, the rest at month end`}
                </div>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
