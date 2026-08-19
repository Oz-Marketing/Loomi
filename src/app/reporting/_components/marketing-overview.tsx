'use client';

/**
 * Marketing Overview — the single-account composite, and the Reporting home
 * page whenever one account is selected.
 *
 * Port of Oz Dealer Tools' `reports/marketing-dashboard`, which fanned out to
 * seventeen AJAX endpoints to build one page. Loomi's version fans out to the
 * report routes that already exist, so every figure here is the same number
 * its own report shows — this page adds no arithmetic of its own beyond
 * summing media spend across channels.
 *
 * ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
 * The individual reports answer "how is Google doing". This answers "how is
 * this store doing" — the question a rep opens the tool with. So it leads with
 * the things a dealer actually judges the month on (spend, leads, sold units,
 * repair orders) and links out rather than trying to reproduce each report.
 *
 * ── PARTIAL IS NORMAL ───────────────────────────────────────────────────────
 * No account has every channel. A source that is unconfigured or failing gets
 * a labelled, muted tile carrying the route's own message — never a silent
 * omission, and never a zero, which would read as "we ran it and got nothing".
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowTrendingUpIcon,
  BanknotesIcon,
  ChartBarIcon,
  CursorArrowRaysIcon,
  EyeIcon,
  StarIcon,
  TruckIcon,
  UserPlusIcon,
  WrenchScrewdriverIcon,
  ArrowRightIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useTheme } from '@/contexts/theme-context';
import { DashboardToolbar } from '@/components/filters/dashboard-toolbar';
import { DEFAULT_DATE_RANGE } from '@/lib/date-ranges';
import {
  num,
  usd0,
  pctText,
  Kpi,
  Section,
  Muted,
  LoadingState,
  DataTable,
  resolveBounds,
  ALL_TIME_FLOOR,
  type CustomDateRange,
  type DateRangeKey,
} from '../ads/_components/shared';
import { RankedBarChart } from './dealer-charts';
import { AccountScopeToggle } from '@/components/account-scope-toggle';
import {
  fetchAllSources,
  fetchJson,
  isMediaSource,
  sourceSpend,
  type SourceResult,
} from './account-sources';

interface DealerSummaries {
  sales: { totalUnits: number; totalRevenue: number; avgPrice: number } | null;
  service: { roCount: number; totalRevenue: number; avgRoValue: number } | null;
  leads: { leads: number; converted: number } | null;
  budget: { planned: number; contractTotal: number | null } | null;
}

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/** Where each channel's own report lives, for the "open it" links. */
const REPORT_HREF: Record<string, string> = {
  google: '/ads/google',
  meta: '/ads/meta',
  stackadapt: '/ads/stackadapt',
  email: '/ads/blasts',
  ga4: '/websites',
  reputation: '/reputation',
};

/**
 * Channel name as the table's first cell. Channels with their own report link
 * out — matching the arrow-on-hover affordance of `OverviewRow` below — and
 * any channel not in `REPORT_HREF` stays plain text rather than linking
 * somewhere it cannot open.
 */
function ChannelCell({ label, sourceKey }: { label: string; sourceKey: string }) {
  const href = REPORT_HREF[sourceKey];
  if (!href) return <span title={label}>{label}</span>;
  return (
    <Link
      href={href}
      title={label}
      className="group flex items-center gap-1.5 transition-colors hover:text-[var(--primary)]"
    >
      <span className="min-w-0 truncate">{label}</span>
      <ArrowRightIcon className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
    </Link>
  );
}

export function MarketingOverview({ accountKey, dealer }: { accountKey: string; dealer: string }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [rangeKey, setRangeKey] = useState<DateRangeKey>(DEFAULT_DATE_RANGE);
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);
  const { from, to } = resolveBounds(rangeKey, customRange);

  const [sources, setSources] = useState<SourceResult[] | null>(null);
  const [dealerData, setDealerData] = useState<DealerSummaries | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      const period = to.slice(0, 7);
      const year = Number(to.slice(0, 4));
      const q = `accountKey=${encodeURIComponent(accountKey)}&start_date=${from}&end_date=${to}`;

      const [srcs, sales, service, leads, budget] = await Promise.all([
        fetchAllSources(accountKey, from, to),
        fetchJson<{ summary: DealerSummaries['sales'] }>(`/api/reporting/sales-trend?${q}`),
        fetchJson<{ summary: DealerSummaries['service'] }>(`/api/reporting/service-trend?${q}`),
        fetchJson<{ current: { leads: number; converted: number } | null }>(
          `/api/reporting/leads?accountKey=${encodeURIComponent(accountKey)}&period=${period}`,
        ),
        fetchJson<{ planned: number; contractTotal: number | null }>(
          `/api/reporting/budget?accountKey=${encodeURIComponent(accountKey)}&year=${year}`,
        ),
      ]);

      // A stale range's results must not overwrite a newer one's.
      if (cancelled) return;
      setSources(srcs);
      setDealerData({
        sales: sales?.summary ?? null,
        service: service?.summary ?? null,
        leads: leads?.current ?? null,
        budget: budget ? { planned: budget.planned, contractTotal: budget.contractTotal } : null,
      });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [accountKey, from, to]);

  const live = (sources ?? []).filter((s) => s.status === 'ok' && s.metrics);
  const missing = (sources ?? []).filter((s) => s.status !== 'ok');
  const media = live.filter(isMediaSource);

  const spend = media.reduce((t, s) => t + sourceSpend(s), 0);
  const impressions = media.reduce((t, s) => t + n(s.metrics?.impressions), 0);
  const clicks = media.reduce((t, s) => t + n(s.metrics?.clicks), 0);
  const conversions = media.reduce((t, s) => t + n(s.metrics?.conversions), 0);

  const ga4 = live.find((s) => s.key === 'ga4');
  const reputation = live.find((s) => s.key === 'reputation');
  const d = dealerData;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{dealer}</h1>
            <Muted>Everything for this account in one place.</Muted>
          </div>
          {/* The reporting index swaps between THIS page and the roll-up
              dashboard on `isRollup`, so without the toggle here a group has no
              way back to its own numbers. */}
          <AccountScopeToggle />
        </div>
        <DashboardToolbar
          dateRange={rangeKey}
          onDateRangeChange={setRangeKey}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
          showReset={false}
          align="left"
          hidePresets={['all']}
          minDate={ALL_TIME_FLOOR}
        />
      </div>

      {loading ? (
        <LoadingState />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Kpi
              icon={BanknotesIcon}
              label="Media spend"
              value={usd0(spend)}
              secondary={`${media.length} channel${media.length === 1 ? '' : 's'}`}
              tone="primary"
            />
            <Kpi icon={EyeIcon} label="Impressions" value={num(impressions)} tone="sky" />
            <Kpi
              icon={CursorArrowRaysIcon}
              label="Clicks"
              value={num(clicks)}
              secondary={impressions > 0 ? `${pctText((clicks / impressions) * 100)} CTR` : undefined}
              tone="violet"
            />
            <Kpi
              icon={UserPlusIcon}
              label="Leads"
              value={d?.leads ? num(d.leads.leads) : '—'}
              secondary={d?.leads ? `${num(d.leads.converted)} bought` : 'No lead data'}
              tone="emerald"
            />
            <Kpi
              icon={TruckIcon}
              label="Units sold"
              value={d?.sales ? num(d.sales.totalUnits) : '—'}
              secondary={d?.sales ? `${usd0(d.sales.avgPrice)} avg` : 'No sales data'}
              tone="amber"
            />
            <Kpi
              icon={WrenchScrewdriverIcon}
              label="Repair orders"
              value={d?.service ? num(d.service.roCount) : '—'}
              secondary={d?.service ? `${usd0(d.service.avgRoValue)} avg` : 'No service data'}
              tone="zinc"
            />
          </div>

          {media.length > 0 && (
            <Section title="Where the money went" subtitle="Media spend by channel" icon={ChartBarIcon}>
              <RankedBarChart
                items={media.map((s) => ({ label: s.label, value: sourceSpend(s) }))}
                isDark={isDark}
                money
                valueLabel="Spend"
              />
            </Section>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Section title="Channel performance" subtitle="Open a channel for the full report" icon={ArrowTrendingUpIcon}>
              {media.length ? (
                <DataTable
                  head={['Channel', 'Spend', 'Impressions', 'Clicks', 'Conversions']}
                  rows={media.map((s) => [
                    <ChannelCell key={s.key} label={s.label} sourceKey={s.key} />,
                    usd0(sourceSpend(s)),
                    num(n(s.metrics?.impressions)),
                    num(n(s.metrics?.clicks)),
                    num(n(s.metrics?.conversions)),
                  ])}
                  maxRows={8}
                />
              ) : (
                <Muted>No media channels reported for this range.</Muted>
              )}
              {conversions > 0 && (
                <div className="mt-3">
                  <Muted>
                    {num(conversions)} conversions across all channels
                    {spend > 0 && ` — ${usd0(spend / conversions)} each`}.
                  </Muted>
                </div>
              )}
            </Section>

            <Section title="The rest of the picture" icon={ChartBarIcon}>
              <ul className="space-y-2 text-xs">
                <OverviewRow
                  icon={EyeIcon}
                  label="Website sessions"
                  value={ga4 ? num(n(ga4.metrics?.sessions)) : null}
                  href="/websites"
                />
                <OverviewRow
                  icon={StarIcon}
                  label="Google rating"
                  value={
                    reputation && n(reputation.metrics?.rating) > 0
                      ? `${n(reputation.metrics?.rating).toFixed(1)} · ${num(n(reputation.metrics?.reviewCount))} reviews`
                      : null
                  }
                  href="/reputation"
                />
                <OverviewRow
                  icon={BanknotesIcon}
                  label="Planned budget"
                  value={d?.budget ? usd0(d.budget.planned) : null}
                  href="/budget"
                />
                <OverviewRow
                  icon={TruckIcon}
                  label="Sales revenue"
                  value={d?.sales ? usd0(d.sales.totalRevenue) : null}
                  href="/sales-trend"
                />
                <OverviewRow
                  icon={WrenchScrewdriverIcon}
                  label="Service revenue"
                  value={d?.service ? usd0(d.service.totalRevenue) : null}
                  href="/service-trend"
                />
              </ul>
            </Section>
          </div>

          {missing.length > 0 && (
            <Section title="Not reporting" subtitle={`${missing.length} of ${sources?.length ?? 0} channels`}>
              <ul className="space-y-1.5">
                {missing.map((s) => (
                  <li key={s.key} className="flex items-start gap-2">
                    <ExclamationTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
                    <span className="text-xs">
                      <span className="font-medium">{s.label}</span>
                      <span className="text-[var(--muted-foreground)]"> — {s.note}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <Muted>
                  These aren&rsquo;t zeros — they&rsquo;re channels that didn&rsquo;t report. The
                  totals above exclude them entirely.
                </Muted>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

/** One linked stat. A null value renders as an em dash, never as zero. */
function OverviewRow({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  value: string | null;
  href: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center justify-between rounded-lg px-2 py-2 transition-colors hover:bg-[var(--muted)]/50"
      >
        <span className="flex items-center gap-2 text-[var(--muted-foreground)]">
          <Icon className="h-4 w-4" />
          {label}
        </span>
        <span className="flex items-center gap-1.5 font-medium tabular-nums">
          {value ?? '—'}
          <ArrowRightIcon className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
        </span>
      </Link>
    </li>
  );
}
