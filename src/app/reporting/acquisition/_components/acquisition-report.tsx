'use client';

/**
 * Acquisition Cost — what a lead and a delivered unit cost in media.
 *
 * Fans out to the channel routes for spend (same helper the Marketing Overview
 * uses, so the numbers agree by construction) and to
 * /api/reporting/acquisition-cost for the CRM outcomes, then hands both to the
 * pure computation in lib/reporting/acquisition-cost.ts.
 *
 * This component's real job is CAVEATS. The arithmetic is division; what stops
 * it misleading someone is that partial spend coverage is impossible to miss,
 * per-channel figures only appear where the platform actually attributed them,
 * and the lead definition is stated next to the number rather than in a
 * footnote nobody reads.
 */

import { useEffect, useState } from 'react';
import {
  BanknotesIcon,
  UserPlusIcon,
  TruckIcon,
  ArrowTrendingUpIcon,
  ExclamationTriangleIcon,
  InboxStackIcon,
  ChartBarIcon,
  ScaleIcon,
} from '@heroicons/react/24/outline';
import {
  usd,
  usd0,
  num,
  Kpi,
  Section,
  Muted,
  EmptyState,
  LoadingState,
  DataTable,
} from '../../ads/_components/shared';
import { MonthlyLineChart } from '../../_components/dealer-charts';
import {
  fetchAllSources,
  fetchJson,
  isMediaSource,
  sourceSpend,
  type SourceResult,
} from '../../_components/account-sources';
import {
  computeAcquisitionCost,
  monthlyAcquisitionCost,
  type AcquisitionCost,
  type ChannelSpendInput,
} from '@/lib/reporting/acquisition-cost';
import type { ReportLens } from '../../_components/lens';

interface OutcomesResponse {
  dealer: string;
  outcomes: { leads: number; soldUnits: number; revenue: number };
  monthly: Record<string, { leads: number; soldUnits: number }>;
  /** Billed media spend per month, from the budget ledger — see the route. */
  monthlySpend: Record<string, number>;
}

/**
 * Offline conversions the PLATFORM matched back to itself. Present only on the
 * ad routes, and only when the account has offline import configured — so an
 * absent key means "no attribution", which is not the same as zero.
 */
function offlineFrom(r: SourceResult): { offlineLeads?: number; offlinePurchases?: number } {
  const m = r.metrics;
  if (!m) return {};
  const hasLeads = typeof m.offline_leads === 'number';
  const hasPurchases = typeof m.offline_purchases === 'number';
  if (!hasLeads && !hasPurchases) return {};
  return {
    offlineLeads: hasLeads ? m.offline_leads : undefined,
    offlinePurchases: hasPurchases ? m.offline_purchases : undefined,
  };
}

export function AcquisitionReport({
  accountKey,
  from,
  to,
  isDark,
  lens,
}: {
  accountKey: string;
  from: string;
  to: string;
  isDark: boolean;
  lens: ReportLens;
}) {
  const [sources, setSources] = useState<SourceResult[] | null>(null);
  const [outcomes, setOutcomes] = useState<OutcomesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const team = lens === 'team';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchAllSources(accountKey, from, to),
      fetchJson<OutcomesResponse>(
        `/api/reporting/acquisition-cost?accountKey=${encodeURIComponent(accountKey)}&start_date=${from}&end_date=${to}`,
      ),
    ]).then(([s, o]) => {
      if (cancelled) return;
      setSources(s);
      setOutcomes(o);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [accountKey, from, to]);

  if (loading) return <LoadingState />;

  if (!outcomes) {
    return (
      <EmptyState
        icon={ExclamationTriangleIcon}
        title="Couldn't load acquisition cost"
        body="The sales and lead figures for this account could not be read."
        tone="error"
      />
    );
  }

  const media = (sources ?? []).filter(isMediaSource);
  const channels: ChannelSpendInput[] = media.map((r) => ({
    key: r.key,
    label: r.label,
    spend: r.status === 'ok' ? sourceSpend(r) : null,
    note: r.note,
    ...offlineFrom(r),
  }));

  const result: AcquisitionCost = computeAcquisitionCost(channels, outcomes.outcomes);
  const trend = monthlyAcquisitionCost(outcomes.monthlySpend ?? {}, outcomes.monthly);
  // Cost per unit needs ledger spend. An account whose budget lines aren't
  // classified yet gets the volume trend instead of a row of dashes.
  const trendHasCost = trend.some((t) => t.costPerSoldUnit != null);
  const hasOutcomes = outcomes.outcomes.leads > 0 || outcomes.outcomes.soldUnits > 0;

  if (result.totalSpend === 0 && !hasOutcomes) {
    return (
      <EmptyState
        icon={InboxStackIcon}
        title="Nothing to divide yet"
        body={`No media spend and no delivered units for ${outcomes.dealer} in this window.`}
      />
    );
  }

  return (
    <div className="mt-8 space-y-8">
      {/* Partial coverage first, above the numbers it invalidates. A blended
          cost that quietly omits a channel reads as an improvement, so this
          cannot be a footnote. */}
      {result.coverage.partial && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
          <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="text-xs text-[var(--muted-foreground)]">
            <span className="font-medium text-[var(--foreground)]">
              Spend below is incomplete, so every cost figure is understated.
            </span>{' '}
            Not counted:{' '}
            {result.coverage.missing.map((m, i) => (
              <span key={m.label}>
                {i > 0 && ', '}
                <span className="text-[var(--foreground)]">{m.label}</span>
                {m.note ? ` (${m.note})` : ''}
              </span>
            ))}
            .
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Kpi
          icon={BanknotesIcon}
          label="Media spend"
          value={usd0(result.totalSpend)}
          secondary={`${result.coverage.reporting.length} channel${result.coverage.reporting.length === 1 ? '' : 's'}`}
          tone="primary"
        />
        <Kpi
          icon={UserPlusIcon}
          label="Cost / lead"
          value={result.blended.costPerLead != null ? usd(result.blended.costPerLead) : '—'}
          secondary={`${num(outcomes.outcomes.leads)} leads`}
          tone="sky"
        />
        <Kpi
          icon={TruckIcon}
          label="Cost / unit"
          value={result.blended.costPerSoldUnit != null ? usd(result.blended.costPerSoldUnit) : '—'}
          secondary={`${num(outcomes.outcomes.soldUnits)} units delivered`}
          tone="emerald"
        />
        <Kpi
          icon={ChartBarIcon}
          label="Revenue"
          value={usd0(outcomes.outcomes.revenue)}
          secondary="transaction, not gross"
          tone="violet"
        />
        <Kpi
          icon={ScaleIcon}
          label="Revenue / $1 media"
          value={result.revenuePerDollar != null ? `$${result.revenuePerDollar.toFixed(0)}` : '—'}
          secondary="not ROAS — see note"
          tone="amber"
        />
      </div>

      <p className="text-xs text-[var(--muted-foreground)]">
        <span className="font-medium text-[var(--foreground)]">Blended, not attributed.</span> These
        divide <em>all</em> media spend by <em>all</em> outcomes. Nothing in the CRM ties a specific
        sale to a specific channel, so a per-channel version of this number would be invented.
        Leads are good leads — the CRM&rsquo;s bad and duplicate leads are filtered before they
        reach Loomi, so this cost per lead runs higher than a cost-per-total-leads figure.
      </p>

      <Section
        title="Spend by channel"
        icon={BanknotesIcon}
        subtitle="what each channel cost — not what each channel produced"
      >
        <DataTable
          head={['Channel', 'Spend', 'Share']}
          rows={media.map((r) => {
            const spend = r.status === 'ok' ? sourceSpend(r) : null;
            return [
              r.label,
              spend != null ? usd(spend) : <span className="text-[var(--muted-foreground)]">—</span>,
              spend != null && result.totalSpend > 0
                ? `${((spend / result.totalSpend) * 100).toFixed(0)}%`
                : (r.note ?? 'not reporting'),
            ];
          })}
        />
      </Section>

      {/* Only where the PLATFORM matched outcomes back to itself. Absent is the
          normal state and means no offline import is configured — it does not
          mean the channel produced nothing. */}
      {team && (
        <Section
          title="Platform-attributed cost"
          icon={ArrowTrendingUpIcon}
          subtitle="each platform's own matchback — not Loomi's"
        >
          {result.attributed.length > 0 && (
            <p className="mb-3 text-[11px] text-[var(--muted-foreground)]">
              These will not add up to the blended figure above, and should not. Each platform
              counts only the outcomes it managed to match back to itself, so the units here are a
              subset of total deliveries while the spend is the channel&rsquo;s full spend — which
              makes every cost below an upper bound.
            </p>
          )}
          {result.attributed.length === 0 ? (
            <Muted>
              No channel has offline conversions imported for this account, so no platform can
              attribute a lead or a sale to itself. Setting up offline conversion import in Google
              Ads or Meta is what makes this section appear.
            </Muted>
          ) : (
            <DataTable
              head={['Channel', 'Spend', 'Leads', 'Cost / lead', 'Sales', 'Cost / sale']}
              rows={result.attributed.map((c) => [
                c.label,
                usd(c.spend),
                num(c.offlineLeads),
                c.costPerLead != null ? usd(c.costPerLead) : '—',
                num(c.offlinePurchases),
                c.costPerSoldUnit != null ? usd(c.costPerSoldUnit) : '—',
              ])}
            />
          )}
        </Section>
      )}

      <Section
        title="Leads & units by month"
        icon={ArrowTrendingUpIcon}
        subtitle="the trend is the signal — a single month is distorted by the sales cycle"
      >
        {trend.length === 0 ? (
          <Muted>No monthly history for this account yet.</Muted>
        ) : (
          <>
            {trendHasCost ? (
              <MonthlyLineChart
                categories={trend.map((t) => t.label)}
                name="Cost per sold unit"
                data={trend.map((t) => t.costPerSoldUnit ?? 0)}
                isDark={isDark}
                money
                height={240}
              />
            ) : (
              <MonthlyLineChart
                categories={trend.map((t) => t.label)}
                name="Sold units"
                data={trend.map((t) => t.soldUnits)}
                isDark={isDark}
                money={false}
                height={240}
              />
            )}
            <DataTable
              head={
                trendHasCost
                  ? ['Month', 'Media spend', 'Leads', 'Cost / lead', 'Sold units', 'Cost / unit']
                  : ['Month', 'Leads', 'Sold units']
              }
              rows={trend.map((t) =>
                trendHasCost
                  ? [
                      t.label,
                      usd0(t.spend),
                      num(t.leads),
                      t.costPerLead != null ? usd(t.costPerLead) : '—',
                      num(t.soldUnits),
                      t.costPerSoldUnit != null ? usd(t.costPerSoldUnit) : '—',
                    ]
                  : [t.label, num(t.leads), num(t.soldUnits)],
              )}
              maxRows={6}
            />
            {trendHasCost ? (
              <p className="mt-3 text-[11px] text-[var(--muted-foreground)]">
                Monthly spend comes from the budget ledger (billed media lines), so it may differ
                slightly from the live platform figures in the window above.
              </p>
            ) : (
              <p className="mt-3 text-[11px] text-[var(--muted-foreground)]">
                Showing volume only — this account has no budget lines classified as media, so
                there is no monthly spend to divide by.
              </p>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
