'use client';

/**
 * StackAdapt (OTT/CTV/display) tab of the Ads report. Fetches
 * /api/reporting/stackadapt and renders KPIs, daily trend, top campaigns,
 * spend by campaign group, and top creatives. StackAdapt's delivery API has no
 * device/demographic breakdowns, so those sections are absent (Oz parity).
 */

import useSWR from 'swr';
import {
  CurrencyDollarIcon,
  EyeIcon,
  UserGroupIcon,
  ArrowPathIcon,
  BoltIcon,
  ChartBarIcon,
  CheckBadgeIcon,
  ExclamationTriangleIcon,
  LinkSlashIcon,
  ArrowTrendingUpIcon,
  InboxStackIcon,
  RectangleGroupIcon,
  FilmIcon,
} from '@heroicons/react/24/outline';
import {
  type DateRangeKey,
  fetcher,
  usd,
  num,
  compact,
  prettyDate,
  pctDelta,
  Kpi,
  Section,
  Muted,
  EmptyState,
  LoadingState,
  DataTable,
  DailyChart,
  SpendBar,
  SpendDonut,
} from './shared';
import { ExportMenu } from './export-menu';
import type { ReportDoc } from '@/lib/reporting/report-doc';

interface Metrics {
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  spend: number;
  cpm: number;
  conversions: number;
  cost_per_conversion: number;
  unique_impressions: number;
  frequency: number;
}
interface Row extends Metrics {
  id: string;
  name: string;
}
interface DailyRow extends Metrics {
  date: string;
  label: string;
}
interface StackAdaptData {
  dealer: string;
  margin: number;
  startDate: string;
  endDate: string;
  accountMetrics: Metrics;
  campaigns: Row[];
  campaignGroups: Row[];
  daily: DailyRow[];
  creatives: Row[];
  compare: { label: string; accountMetrics: Metrics } | null;
}

export function StackAdaptReport({
  accountKey,
  from,
  to,
  compareTo,
  isDark,
  onJump,
}: {
  accountKey: string;
  from: string;
  to: string;
  compareTo: string;
  isDark: boolean;
  onJump: (k: DateRangeKey) => void;
}) {
  const { data, error, isLoading } = useSWR<StackAdaptData, Error & { code?: string }>(
    `/api/reporting/stackadapt?accountKey=${encodeURIComponent(accountKey)}&start_date=${from}&end_date=${to}&compare_to=${compareTo}`,
    fetcher,
  );

  if (isLoading) return <LoadingState />;
  if (error) {
    return error.code === 'not_configured' || error.code === 'no_advertiser' ? (
      <EmptyState icon={LinkSlashIcon} title="StackAdapt not connected" body={error.message} />
    ) : (
      <EmptyState icon={ExclamationTriangleIcon} title="Couldn't load StackAdapt report" body={error.message} tone="error" />
    );
  }
  if (!data) return null;

  const m = data.accountMetrics;
  const cmp = data.compare?.accountMetrics ?? null;
  const hasData = m.impressions > 0 || m.spend > 0 || data.campaigns.length > 0;

  if (!hasData) {
    return (
      <EmptyState
        icon={InboxStackIcon}
        title="No delivery in this window"
        body={`Nothing ran for ${data.dealer} between ${prettyDate(data.startDate)} and ${prettyDate(
          data.endDate,
        )}. Widen the range to find this advertiser's active flights.`}
        action={{ label: 'View last 12 months', onClick: () => onJump('12m') }}
      />
    );
  }

  const perfCols = (firstCol: string): ReportDoc['sections'][number]['columns'] => [
    { header: firstCol, type: 'text' },
    { header: 'Spend', type: 'currency' },
    { header: 'Impr.', type: 'integer' },
    { header: 'CPM', type: 'currency', total: 'none' },
    { header: 'Conv.', type: 'integer' },
  ];
  const perfRows = (rows: Row[]) =>
    [...rows].sort((a, b) => b.spend - a.spend).map((r) => [r.name, r.spend, r.impressions, r.cpm, r.conversions]);
  const sections: ReportDoc['sections'] = [
    { title: 'Campaigns', columns: perfCols('Campaign'), rows: perfRows(data.campaigns) },
  ];
  if (data.campaignGroups.length) {
    sections.push({ title: 'Campaign groups', columns: perfCols('Group'), rows: perfRows(data.campaignGroups) });
  }
  if (data.creatives.length) {
    sections.push({ title: 'Creatives', columns: perfCols('Creative'), rows: perfRows(data.creatives) });
  }
  if (data.daily.length) {
    sections.push({
      title: 'Daily',
      columns: [
        { header: 'Date', type: 'text' },
        { header: 'Spend', type: 'currency' },
        { header: 'Impr.', type: 'integer' },
        { header: 'CPM', type: 'currency', total: 'none' },
        { header: 'Conv.', type: 'integer' },
      ],
      rows: data.daily.map((d) => [d.date, d.spend, d.impressions, d.cpm, d.conversions]),
    });
  }
  const doc: ReportDoc = {
    title: `StackAdapt (OTT / CTV) — ${data.dealer}`,
    subtitle: `${prettyDate(data.startDate)} – ${prettyDate(data.endDate)}`,
    meta: [
      { label: 'Account', value: data.dealer },
      { label: 'Range', value: `${prettyDate(data.startDate)} → ${prettyDate(data.endDate)}` },
      ...(data.compare ? [{ label: 'Compared to', value: data.compare.label }] : []),
    ],
    kpis: [
      { label: 'Spend', value: usd(m.spend) },
      { label: 'Impressions', value: num(m.impressions) },
      { label: 'Reach', value: num(m.unique_impressions), secondary: 'unique' },
      { label: 'Frequency', value: m.frequency.toFixed(1), secondary: 'avg / user' },
      { label: 'CPM', value: usd(m.cpm) },
      { label: 'Conversions', value: num(m.conversions), secondary: m.conversions > 0 ? `${usd(m.cost_per_conversion)} / conv` : undefined },
    ],
    sections,
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--muted-foreground)]">
          <span className="font-medium text-[var(--foreground)]">{prettyDate(data.startDate)}</span> →{' '}
          <span className="font-medium text-[var(--foreground)]">{prettyDate(data.endDate)}</span>
          {data.compare && (
            <>
              {' '}· vs. <span className="font-medium text-[var(--foreground)]">{data.compare.label}</span>
            </>
          )}
        </p>
        <ExportMenu doc={doc} filenameBase={`stackadapt-${data.dealer}-${data.startDate}-${data.endDate}`} />
      </div>

      {/* OTT/CTV is impression-based — no clicks/CTR/CPC. Surface reach,
          frequency and CPM instead. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={CurrencyDollarIcon} label="Spend" value={usd(m.spend)} tone="primary" delta={pctDelta(m.spend, cmp?.spend)} />
        <Kpi icon={EyeIcon} label="Impressions" value={compact(m.impressions)} secondary={num(m.impressions)} tone="sky" delta={pctDelta(m.impressions, cmp?.impressions)} />
        <Kpi icon={UserGroupIcon} label="Reach" value={compact(m.unique_impressions)} secondary={`${num(m.unique_impressions)} unique`} tone="violet" delta={pctDelta(m.unique_impressions, cmp?.unique_impressions)} />
        <Kpi icon={ArrowPathIcon} label="Frequency" value={m.frequency.toFixed(1)} secondary="avg / user" tone="zinc" />
        <Kpi icon={BoltIcon} label="CPM" value={usd(m.cpm)} tone="amber" delta={pctDelta(m.cpm, cmp?.cpm, true)} />
        <Kpi icon={CheckBadgeIcon} label="Conversions" value={num(m.conversions)} secondary={m.conversions > 0 ? `${usd(m.cost_per_conversion)} / conv` : undefined} tone="emerald" delta={pctDelta(m.conversions, cmp?.conversions)} />
      </div>

      {data.daily.length > 1 && (
        <Section title="Daily performance" icon={ArrowTrendingUpIcon} subtitle={`${data.daily.length} days`}>
          <DailyChart
            rows={data.daily.map((d) => ({ date: d.date, spend: d.spend, secondary: d.impressions }))}
            secondaryName="Impressions"
            isDark={isDark}
          />
        </Section>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Section title="Top campaigns" icon={ChartBarIcon} subtitle={`${data.campaigns.length} total`}>
          {data.campaigns.length === 0 ? (
            <Muted>No campaigns delivered in this period.</Muted>
          ) : (
            <>
              <SpendBar items={data.campaigns.slice(0, 8).map((c) => ({ label: c.name, value: c.spend }))} isDark={isDark} />
              <PerfTable rows={data.campaigns} />
            </>
          )}
        </Section>

        <Section title="Spend by campaign group" icon={RectangleGroupIcon}>
          {data.campaignGroups.length === 0 ? (
            <Muted>No campaign groups in this period.</Muted>
          ) : (
            <SpendDonut items={data.campaignGroups.slice(0, 6).map((g) => ({ label: g.name, value: g.spend }))} isDark={isDark} />
          )}
        </Section>
      </div>

      {data.creatives.length > 0 && (
        <Section title="Top creatives" icon={FilmIcon} subtitle={`${data.creatives.length} shown`}>
          <PerfTable rows={data.creatives} firstCol="Creative" />
        </Section>
      )}
    </div>
  );
}

/** Spend/impr/CPM/conv table for campaigns, groups, creatives (no clicks — OTT). */
function PerfTable({ rows, firstCol = 'Campaign' }: { rows: Row[]; firstCol?: string }) {
  const sorted = [...rows].sort((a, b) => b.spend - a.spend);
  return (
    <div className="mt-5">
      <DataTable
        head={[firstCol, 'Spend', 'Impr.', 'CPM', 'Conv.']}
        rows={sorted.map((r) => [r.name, usd(r.spend), num(r.impressions), usd(r.cpm), num(r.conversions)])}
      />
    </div>
  );
}
