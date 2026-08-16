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
  UserGroupIcon,
  ArrowPathIcon,
  RectangleGroupIcon,
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
import { connectTarget } from '../../_components/connect-targets';
import type { ReportLens } from '../../_components/lens';
import { ExportMenu } from './export-menu';
import type { ReportDoc } from '@/lib/reporting/report-doc';

interface Metrics {
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  spend: number;
  cpm: number;
  /** Account level only — de-duplicated, so never sum these across rows. */
  reach: number;
  frequency: number;
  conversions: number;
  cost_per_conversion: number;
  offline_leads: number;
  offline_purchases: number;
  offline_purchase_value: number;
  /**
   * Raw pre-margin spend. Present ONLY for super-admin/developer — the API
   * strips it for every other role, so `undefined` means "not permitted", not
   * "zero". See stripInternalCost in api/reporting/_lib/guard.ts.
   */
  actual_spend?: number;
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
interface PlacementRow {
  platform: string;
  position: string;
  label: string;
  impressions: number;
  clicks: number;
  ctr: number;
  spend: number;
  cpm: number;
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
  placements: PlacementRow[];
  compare: { label: string; accountMetrics: Metrics } | null;
}

export function MetaReport({
  accountKey,
  from,
  to,
  compareTo,
  isDark,
  onJump,
  lens,
}: {
  accountKey: string;
  from: string;
  to: string;
  compareTo: string;
  isDark: boolean;
  onJump: (k: DateRangeKey) => void;
  lens: ReportLens;
}) {
  const { data, error, isLoading } = useSWR<MetaReportData, Error & { code?: string }>(
    `/api/reporting/ads?accountKey=${encodeURIComponent(accountKey)}&start_date=${from}&end_date=${to}&compare_to=${compareTo}`,
    fetcher,
  );

  if (isLoading) return <LoadingState />;
  if (error) {
    return error.code === 'not_configured' || error.code === 'no_ad_account' ? (
      <EmptyState
        icon={LinkSlashIcon}
        title="Meta not connected"
        body={error.message}
        connect={connectTarget('meta', accountKey)}
      />
    ) : (
      <EmptyState icon={ExclamationTriangleIcon} title="Couldn't load Meta report" body={error.message} tone="error" />
    );
  }
  if (!data) return null;

  const m = data.accountMetrics;
  const cmp = data.compare?.accountMetrics ?? null;
  const team = lens === 'team';
  // Raw pre-margin spend reaches super-admins only; the API strips it for
  // everyone else, so its presence is the permission check.
  const rawSpend = typeof m.actual_spend === 'number' ? m.actual_spend : null;
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

  const sections: ReportDoc['sections'] = [
    {
      title: 'Campaigns',
      columns: [
        { header: 'Campaign', type: 'text' },
        { header: 'Spend', type: 'currency' },
        { header: 'Impr.', type: 'integer' },
        { header: 'Clicks', type: 'integer' },
        { header: 'CTR', type: 'percent' },
        { header: 'Conv.', type: 'integer' },
      ],
      rows: [...data.campaigns]
        .sort((a, b) => b.spend - a.spend)
        .map((c) => [c.name, c.spend, c.impressions, c.clicks, c.ctr, c.conversions]),
    },
  ];
  if (data.devices.length) {
    sections.push({
      title: 'Devices',
      columns: [
        { header: 'Device', type: 'text' },
        { header: 'Impr.', type: 'integer' },
        { header: 'Clicks', type: 'integer' },
        { header: 'CTR', type: 'percent' },
        { header: 'Spend', type: 'currency' },
      ],
      rows: data.devices.map((d) => [d.device, d.impressions, d.clicks, d.ctr, d.spend]),
    });
  }
  if (data.daily.length) {
    sections.push({
      title: 'Daily',
      columns: [
        { header: 'Date', type: 'text' },
        { header: 'Impr.', type: 'integer' },
        { header: 'Clicks', type: 'integer' },
        { header: 'Spend', type: 'currency' },
        { header: 'Conv.', type: 'integer' },
      ],
      rows: data.daily.map((d) => [d.date, d.impressions, d.clicks, d.spend, d.conversions]),
    });
  }
  if (data.demographics.length) {
    sections.push({
      title: 'Demographics',
      columns: [
        { header: 'Age', type: 'text' },
        { header: 'Gender', type: 'text' },
        { header: 'Impr.', type: 'integer' },
        { header: 'Clicks', type: 'integer' },
        { header: 'Spend', type: 'currency' },
      ],
      rows: data.demographics.map((d) => [d.age, d.gender, d.impressions, d.clicks, d.spend]),
    });
  }
  if (team && data.placements?.length) {
    sections.push({
      title: 'Placements',
      columns: [
        { header: 'Placement', type: 'text' },
        { header: 'Spend', type: 'currency' },
        { header: 'Impr.', type: 'integer' },
        { header: 'Clicks', type: 'integer' },
        { header: 'CTR', type: 'percent' },
        { header: 'Conv.', type: 'integer' },
      ],
      rows: data.placements.map((p) => [p.label, p.spend, p.impressions, p.clicks, p.ctr, p.conversions]),
    });
  }
  const doc: ReportDoc = {
    title: `Meta Ads — ${data.dealer}`,
    subtitle: `${prettyDate(data.startDate)} – ${prettyDate(data.endDate)}`,
    meta: [
      { label: 'Account', value: data.dealer },
      { label: 'Range', value: `${prettyDate(data.startDate)} → ${prettyDate(data.endDate)}` },
      ...(data.compare ? [{ label: 'Compared to', value: data.compare.label }] : []),
    ],
    kpis: [
      { label: 'Spend', value: usd(m.spend), secondary: `${usd(m.cpm)} CPM` },
      { label: 'Impressions', value: num(m.impressions) },
      { label: 'Clicks', value: num(m.clicks) },
      { label: 'CTR', value: pctText(m.ctr) },
      { label: 'CPC', value: usd(m.cpc) },
      { label: 'Reach', value: num(m.reach) },
      { label: 'Frequency', value: m.frequency.toFixed(1) },
      { label: 'Conversions', value: num(m.conversions), secondary: m.conversions > 0 ? `${usd(m.cost_per_conversion)} / conv` : undefined },
      { label: 'Offline leads', value: num(m.offline_leads) },
      { label: 'Offline purchases', value: num(m.offline_purchases) },
      { label: 'Offline revenue', value: usd0(m.offline_purchase_value) },
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
        <ExportMenu doc={doc} filenameBase={`meta-${data.dealer}-${data.startDate}-${data.endDate}`} />
      </div>

      {/* Four across: with reach and frequency there are eight tiles, and a
          six-wide grid stranded the last two on a half-empty second row. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        <Kpi
          icon={CurrencyDollarIcon}
          label="Spend"
          value={usd(m.spend)}
          secondary={team && rawSpend != null ? `${usd(rawSpend)} media · ${usd(m.cpm)} CPM` : `${usd(m.cpm)} CPM`}
          tone="primary"
          delta={pctDelta(m.spend, cmp?.spend)}
        />
        <Kpi icon={EyeIcon} label="Impressions" value={compact(m.impressions)} secondary={num(m.impressions)} tone="sky" delta={pctDelta(m.impressions, cmp?.impressions)} />
        <Kpi icon={CursorArrowRaysIcon} label="Clicks" value={compact(m.clicks)} secondary={num(m.clicks)} tone="violet" delta={pctDelta(m.clicks, cmp?.clicks)} />
        <Kpi icon={ChartBarIcon} label="CTR" value={pctText(m.ctr)} tone="emerald" delta={pointDelta(m.ctr, cmp?.ctr)} />
        <Kpi icon={BoltIcon} label="CPC" value={usd(m.cpc)} tone="amber" delta={pctDelta(m.cpc, cmp?.cpc, true)} />
        <Kpi icon={CheckBadgeIcon} label="Conversions" value={num(m.conversions)} secondary={m.conversions > 0 ? `${usd(m.cost_per_conversion)} / conv` : undefined} tone="zinc" delta={pctDelta(m.conversions, cmp?.conversions)} />
      </div>

      {/* Reach and frequency sit in their own row, apart from the additive
          metrics above, because they are NOT additive — they are de-duplicated
          over this window and cannot be summed across campaigns or days.
          Keeping them adjacent to impressions invites exactly that mistake. */}
      {(m.reach > 0 || m.frequency > 0) && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi
            icon={UserGroupIcon}
            label="Reach"
            value={compact(m.reach)}
            secondary={`${num(m.reach)} people`}
            tone="violet"
            delta={pctDelta(m.reach, cmp?.reach)}
          />
          <Kpi
            icon={ArrowPathIcon}
            label="Frequency"
            value={m.frequency.toFixed(1)}
            secondary={
              m.frequency >= 4
                ? 'high — creative fatigue likely'
                : 'avg impressions per person'
            }
            tone={m.frequency >= 4 ? 'amber' : 'sky'}
            delta={pctDelta(m.frequency, cmp?.frequency, true)}
          />
        </div>
      )}

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
              <CampaignTable rows={data.campaigns} team={team} />
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

      {/* TEAM ONLY. Placement is a buying decision — "should we turn off
          Audience Network" — not a result the client acts on. Until now it was
          the main reason to leave Loomi and open Ads Manager. */}
      {team && data.placements?.length > 0 && (
        <Section
          title="Placements"
          icon={RectangleGroupIcon}
          subtitle={`${data.placements.length} delivering · sorted by spend`}
        >
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_1.4fr]">
            <SpendBar
              items={data.placements.slice(0, 8).map((p) => ({ label: p.label, value: p.spend }))}
              isDark={isDark}
            />
            <DataTable
              head={['Placement', 'Spend', 'Impr.', 'Clicks', 'CTR', 'CPM', 'Conv.']}
              rows={data.placements.map((p) => [
                p.label,
                usd(p.spend),
                num(p.impressions),
                num(p.clicks),
                pctText(p.ctr),
                usd(p.cpm),
                num(p.conversions),
              ])}
              maxRows={10}
            />
          </div>
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
          <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">{t.label}</p>
          <p className="mt-1 text-lg font-bold tabular-nums">{t.value}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Campaign table. The team lens adds CPC and CPM — delivery-efficiency numbers
 * you compare BETWEEN campaigns to decide where budget moves. A client reading
 * their own report wants what the campaign produced, and two more cost columns
 * only make that harder to find.
 */
function CampaignTable({ rows, team }: { rows: CampaignRow[]; team: boolean }) {
  const sorted = [...rows].sort((a, b) => b.spend - a.spend);
  return (
    <div className="mt-5">
      <DataTable
        head={
          team
            ? ['Campaign', 'Spend', 'Impr.', 'Clicks', 'CTR', 'CPC', 'CPM', 'Conv.']
            : ['Campaign', 'Spend', 'Impr.', 'Clicks', 'CTR', 'Conv.']
        }
        rows={sorted.map((c) =>
          team
            ? [c.name, usd(c.spend), num(c.impressions), num(c.clicks), pctText(c.ctr), usd(c.cpc), usd(c.cpm), num(c.conversions)]
            : [c.name, usd(c.spend), num(c.impressions), num(c.clicks), pctText(c.ctr), num(c.conversions)],
        )}
      />
    </div>
  );
}
