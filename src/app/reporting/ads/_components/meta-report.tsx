'use client';

/**
 * Meta (Facebook) tab of the Ads report. Fetches /api/reporting/ads for the
 * active account + window and renders KPIs, daily trend, top-campaign bar +
 * table, device split, conversions, and demographics. Margin is applied
 * server-side; this component only presents.
 */

import useSWR from 'swr';
import {
  CurrencyDollarIcon,
  EyeIcon,
  CursorArrowRaysIcon,
  ChartBarIcon,
  BoltIcon,
  CheckBadgeIcon,
  ExclamationTriangleIcon,
  LinkSlashIcon,
  UsersIcon,
  ArrowTrendingUpIcon,
  InboxStackIcon,
} from '@heroicons/react/24/outline';
import {
  type DateRangeKey,
  fetcher,
  usd,
  usd0,
  num,
  compact,
  pctText,
  prettyDate,
  pctDelta,
  pointDelta,
  Kpi,
  Section,
  Muted,
  EmptyState,
  LoadingState,
  DataTable,
  DailyChart,
  SpendBar,
  SpendDonut,
  DemographicsChart,
} from './shared';

interface Metrics {
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  spend: number;
  cpm: number;
  conversions: number;
  cost_per_conversion: number;
  offline_leads: number;
  offline_purchases: number;
  offline_purchase_value: number;
}
interface CampaignRow extends Metrics {
  id: string;
  name: string;
}
interface DeviceRow {
  device: string;
  impressions: number;
  clicks: number;
  ctr: number;
  spend: number;
}
interface DailyRow {
  date: string;
  label: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
}
interface DemographicRow {
  age: string;
  gender: string;
  impressions: number;
  clicks: number;
  spend: number;
}
interface MetaReportData {
  dealer: string;
  margin: number;
  startDate: string;
  endDate: string;
  accountMetrics: Metrics;
  campaigns: CampaignRow[];
  devices: DeviceRow[];
  daily: DailyRow[];
  demographics: DemographicRow[];
  compare: { label: string; accountMetrics: Metrics } | null;
}

export function MetaReport({
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
  const { data, error, isLoading } = useSWR<MetaReportData, Error & { code?: string }>(
    `/api/reporting/ads?accountKey=${encodeURIComponent(accountKey)}&start_date=${from}&end_date=${to}&compare_to=${compareTo}`,
    fetcher,
  );

  if (isLoading) return <LoadingState />;
  if (error) {
    return error.code === 'not_configured' || error.code === 'no_ad_account' ? (
      <EmptyState icon={LinkSlashIcon} title="Meta not connected" body={error.message} />
    ) : (
      <EmptyState icon={ExclamationTriangleIcon} title="Couldn't load Meta report" body={error.message} tone="error" />
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
        )}. Widen the range to find this account's active flights.`}
        action={{ label: 'View last 12 months', onClick: () => onJump('12m') }}
      />
    );
  }

  return (
    <div className="space-y-8">
      <p className="text-xs text-[var(--muted-foreground)]">
        <span className="font-medium text-[var(--foreground)]">{prettyDate(data.startDate)}</span> →{' '}
        <span className="font-medium text-[var(--foreground)]">{prettyDate(data.endDate)}</span>
        {data.compare && (
          <>
            {' '}· vs. <span className="font-medium text-[var(--foreground)]">{data.compare.label}</span>
          </>
        )}
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={CurrencyDollarIcon} label="Spend" value={usd(m.spend)} secondary={`${usd(m.cpm)} CPM`} tone="primary" delta={pctDelta(m.spend, cmp?.spend)} />
        <Kpi icon={EyeIcon} label="Impressions" value={compact(m.impressions)} secondary={num(m.impressions)} tone="sky" delta={pctDelta(m.impressions, cmp?.impressions)} />
        <Kpi icon={CursorArrowRaysIcon} label="Clicks" value={compact(m.clicks)} secondary={num(m.clicks)} tone="violet" delta={pctDelta(m.clicks, cmp?.clicks)} />
        <Kpi icon={ChartBarIcon} label="CTR" value={pctText(m.ctr)} tone="emerald" delta={pointDelta(m.ctr, cmp?.ctr)} />
        <Kpi icon={BoltIcon} label="CPC" value={usd(m.cpc)} tone="amber" delta={pctDelta(m.cpc, cmp?.cpc, true)} />
        <Kpi icon={CheckBadgeIcon} label="Conversions" value={num(m.conversions)} secondary={m.conversions > 0 ? `${usd(m.cost_per_conversion)} / conv` : undefined} tone="zinc" delta={pctDelta(m.conversions, cmp?.conversions)} />
      </div>

      {data.daily.length > 1 && (
        <Section title="Daily performance" icon={ArrowTrendingUpIcon} subtitle={`${data.daily.length} days`}>
          <DailyChart rows={data.daily.map((d) => ({ date: d.date, spend: d.spend, secondary: d.clicks }))} isDark={isDark} />
        </Section>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Section title="Top campaigns" icon={ChartBarIcon} subtitle={`${data.campaigns.length} total`}>
          {data.campaigns.length === 0 ? (
            <Muted>No campaigns delivered in this period.</Muted>
          ) : (
            <>
              <SpendBar items={[...data.campaigns].sort((a, b) => b.spend - a.spend).slice(0, 8).map((c) => ({ label: c.name, value: c.spend }))} isDark={isDark} />
              <CampaignTable rows={data.campaigns} />
            </>
          )}
        </Section>

        <Section title="Spend by device" icon={EyeIcon}>
          {data.devices.length === 0 ? (
            <Muted>No device data.</Muted>
          ) : (
            <SpendDonut items={data.devices.map((d) => ({ label: d.device, value: d.spend }))} isDark={isDark} />
          )}
        </Section>
      </div>

      <Section title="Conversions" icon={CheckBadgeIcon}>
        <ConversionsPanel m={m} />
      </Section>

      {data.demographics.length > 0 && (
        <Section title="Audience" icon={UsersIcon} subtitle="Spend by age & gender">
          <DemographicsChart rows={data.demographics} isDark={isDark} />
        </Section>
      )}
    </div>
  );
}

function ConversionsPanel({ m }: { m: Metrics }) {
  const hasAny =
    m.conversions > 0 || m.offline_leads > 0 || m.offline_purchases > 0 || m.offline_purchase_value > 0;
  if (!hasAny) return <Muted>No conversions tracked in this window.</Muted>;
  const tiles = [
    { label: 'Total conversions', value: num(m.conversions) },
    { label: 'Cost / conversion', value: m.cost_per_conversion > 0 ? usd(m.cost_per_conversion) : '—' },
    { label: 'Offline leads', value: num(m.offline_leads) },
    { label: 'Offline purchases', value: num(m.offline_purchases) },
    { label: 'Offline revenue', value: usd0(m.offline_purchase_value) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-[var(--border)] p-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">{t.label}</p>
          <p className="mt-1 text-lg font-bold tabular-nums">{t.value}</p>
        </div>
      ))}
    </div>
  );
}

function CampaignTable({ rows }: { rows: CampaignRow[] }) {
  const sorted = [...rows].sort((a, b) => b.spend - a.spend);
  return (
    <div className="mt-5">
      <DataTable
        head={['Campaign', 'Spend', 'Impr.', 'Clicks', 'CTR', 'Conv.']}
        rows={sorted.map((c) => [c.name, usd(c.spend), num(c.impressions), num(c.clicks), pctText(c.ctr), num(c.conversions)])}
      />
    </div>
  );
}
