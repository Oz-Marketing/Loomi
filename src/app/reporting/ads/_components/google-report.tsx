'use client';

/**
 * Google Ads tab of the Ads report. Fetches /api/reporting/google and renders
 * KPIs, daily trend, campaigns (with an ad-group drilldown), device split,
 * search terms, keywords, locations, auction insights, and conversions. Margin
 * is applied server-side; this component only presents.
 */

import { useState } from 'react';
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
  ArrowTrendingUpIcon,
  InboxStackIcon,
  MagnifyingGlassIcon,
  KeyIcon,
  MapPinIcon,
  TrophyIcon,
  ChevronRightIcon,
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
} from './shared';

interface Metrics {
  impressions: number;
  clicks: number;
  ctr: number;
  avg_cpc: number;
  cost: number;
  conversions: number;
  conversion_value: number;
  cost_per_conversion: number;
  offline_leads: number;
  offline_purchases: number;
  offline_purchase_value: number;
}
interface CampaignRow extends Metrics {
  id: string;
  name: string;
  status: string;
  daily_budget: number;
}
interface DeviceRow {
  device: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cost: number;
  conversions: number;
}
interface DailyRow {
  date: string;
  label: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
}
interface SearchTermRow {
  term: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cost: number;
  conversions: number;
}
interface KeywordRow {
  keyword: string;
  match_type: string;
  quality_score: number | null;
  campaign: string;
  ad_group: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cost: number;
  conversions: number;
}
interface LocationRow {
  city: string;
  region: string;
  location_type: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cost: number;
  conversions: number;
}
interface AuctionRow {
  campaign_id: string;
  campaign_name: string;
  impression_share: number | null;
  top_impression_share: number | null;
  abs_top_impression_share: number | null;
  budget_lost_is: number | null;
  rank_lost_is: number | null;
  impressions: number;
  clicks: number;
  cost: number;
}
interface AdGroupRow {
  id: string;
  name: string;
  type: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avg_cpc: number;
  cost: number;
  conversions: number;
}
interface GoogleData {
  dealer: string;
  margin: number;
  startDate: string;
  endDate: string;
  accountMetrics: Metrics;
  campaigns: CampaignRow[];
  devices: DeviceRow[];
  daily: DailyRow[];
  searchTerms: SearchTermRow[];
  keywords: KeywordRow[];
  locations: LocationRow[];
  auctionInsights: AuctionRow[];
  compare: { label: string; accountMetrics: Metrics } | null;
}

export function GoogleReport({
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
  const { data, error, isLoading } = useSWR<GoogleData, Error & { code?: string }>(
    `/api/reporting/google?accountKey=${encodeURIComponent(accountKey)}&start_date=${from}&end_date=${to}&compare_to=${compareTo}`,
    fetcher,
  );

  if (isLoading) return <LoadingState />;
  if (error) {
    return error.code === 'not_configured' || error.code === 'no_customer' ? (
      <EmptyState icon={LinkSlashIcon} title="Google Ads not connected" body={error.message} />
    ) : (
      <EmptyState icon={ExclamationTriangleIcon} title="Couldn't load Google Ads report" body={error.message} tone="error" />
    );
  }
  if (!data) return null;

  const m = data.accountMetrics;
  const cmp = data.compare?.accountMetrics ?? null;
  const hasData = m.impressions > 0 || m.cost > 0 || data.campaigns.length > 0;

  if (!hasData) {
    return (
      <EmptyState
        icon={InboxStackIcon}
        title="No delivery in this window"
        body={`Nothing ran for ${data.dealer} between ${prettyDate(data.startDate)} and ${prettyDate(
          data.endDate,
        )}. Widen the range to find this account's active campaigns.`}
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
        <Kpi icon={CurrencyDollarIcon} label="Spend" value={usd(m.cost)} tone="primary" delta={pctDelta(m.cost, cmp?.cost)} />
        <Kpi icon={EyeIcon} label="Impressions" value={compact(m.impressions)} secondary={num(m.impressions)} tone="sky" delta={pctDelta(m.impressions, cmp?.impressions)} />
        <Kpi icon={CursorArrowRaysIcon} label="Clicks" value={compact(m.clicks)} secondary={num(m.clicks)} tone="violet" delta={pctDelta(m.clicks, cmp?.clicks)} />
        <Kpi icon={ChartBarIcon} label="CTR" value={pctText(m.ctr)} tone="emerald" delta={pointDelta(m.ctr, cmp?.ctr)} />
        <Kpi icon={BoltIcon} label="Avg CPC" value={usd(m.avg_cpc)} tone="amber" delta={pctDelta(m.avg_cpc, cmp?.avg_cpc, true)} />
        <Kpi icon={CheckBadgeIcon} label="Conversions" value={num(m.conversions)} secondary={m.conversions > 0 ? `${usd(m.cost_per_conversion)} / conv` : undefined} tone="zinc" delta={pctDelta(m.conversions, cmp?.conversions)} />
      </div>

      {data.daily.length > 1 && (
        <Section title="Daily performance" icon={ArrowTrendingUpIcon} subtitle={`${data.daily.length} days`}>
          <DailyChart rows={data.daily.map((d) => ({ date: d.date, spend: d.cost, secondary: d.clicks }))} isDark={isDark} />
        </Section>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Section title="Top campaigns" icon={ChartBarIcon} subtitle={`${data.campaigns.length} total · click to drill into ad groups`}>
          {data.campaigns.length === 0 ? (
            <Muted>No campaigns delivered in this period.</Muted>
          ) : (
            <>
              <SpendBar items={data.campaigns.slice(0, 8).map((c) => ({ label: c.name, value: c.cost }))} isDark={isDark} />
              <CampaignTable campaigns={data.campaigns} accountKey={accountKey} from={from} to={to} />
            </>
          )}
        </Section>

        <Section title="Spend by device" icon={EyeIcon}>
          {data.devices.length === 0 ? <Muted>No device data.</Muted> : <SpendDonut items={data.devices.map((d) => ({ label: d.device, value: d.cost }))} isDark={isDark} />}
        </Section>
      </div>

      <Section title="Conversions" icon={CheckBadgeIcon}>
        <ConversionsPanel m={m} />
      </Section>

      {data.searchTerms.length > 0 && (
        <Section title="Top search terms" icon={MagnifyingGlassIcon} subtitle={`${data.searchTerms.length} shown`}>
          <SimpleTable
            head={['Search term', 'Impr.', 'Clicks', 'CTR', 'Cost', 'Conv.']}
            rows={data.searchTerms.map((s) => [s.term, num(s.impressions), num(s.clicks), pctText(s.ctr), usd(s.cost), num(s.conversions)])}
          />
        </Section>
      )}

      {data.keywords.length > 0 && (
        <Section title="Keywords" icon={KeyIcon} subtitle={`${data.keywords.length} shown`}>
          <SimpleTable
            head={['Keyword', 'Match', 'QS', 'Impr.', 'Clicks', 'CTR', 'Cost', 'Conv.']}
            rows={data.keywords.map((k) => [
              k.keyword,
              k.match_type,
              k.quality_score != null ? String(k.quality_score) : '—',
              num(k.impressions),
              num(k.clicks),
              pctText(k.ctr),
              usd(k.cost),
              num(k.conversions),
            ])}
          />
        </Section>
      )}

      {data.locations.length > 0 && (
        <Section title="Locations" icon={MapPinIcon} subtitle={`${data.locations.length} shown`}>
          <SimpleTable
            head={['City', 'Region', 'Impr.', 'Clicks', 'CTR', 'Cost', 'Conv.']}
            rows={data.locations.map((l) => [l.city, l.region, num(l.impressions), num(l.clicks), pctText(l.ctr), usd(l.cost), num(l.conversions)])}
          />
        </Section>
      )}

      {data.auctionInsights.length > 0 && (
        <Section title="Auction insights" icon={TrophyIcon} subtitle="Search impression share by campaign">
          <SimpleTable
            head={['Campaign', 'Impr. share', 'Top IS', 'Abs top IS', 'Lost (budget)', 'Lost (rank)']}
            rows={data.auctionInsights.map((a) => [
              a.campaign_name,
              ishare(a.impression_share),
              ishare(a.top_impression_share),
              ishare(a.abs_top_impression_share),
              ishare(a.budget_lost_is),
              ishare(a.rank_lost_is),
            ])}
          />
        </Section>
      )}
    </div>
  );
}

const ishare = (v: number | null) => (v != null ? `${v.toFixed(1)}%` : '—');

function ConversionsPanel({ m }: { m: Metrics }) {
  const hasAny = m.conversions > 0 || m.offline_leads > 0 || m.offline_purchases > 0 || m.offline_purchase_value > 0;
  if (!hasAny) return <Muted>No conversions tracked in this window.</Muted>;
  const tiles = [
    { label: 'Total conversions', value: num(m.conversions) },
    { label: 'Cost / conversion', value: m.cost_per_conversion > 0 ? usd(m.cost_per_conversion) : '—' },
    { label: 'Conv. value', value: usd0(m.conversion_value) },
    { label: 'Offline leads', value: num(m.offline_leads) },
    { label: 'Offline purchases', value: num(m.offline_purchases) },
    { label: 'Offline revenue', value: usd0(m.offline_purchase_value) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-[var(--border)] p-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">{t.label}</p>
          <p className="mt-1 text-lg font-bold tabular-nums">{t.value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Campaign table with ad-group drilldown ──

function CampaignTable({
  campaigns,
  accountKey,
  from,
  to,
}: {
  campaigns: CampaignRow[];
  accountKey: string;
  from: string;
  to: string;
}) {
  const sorted = [...campaigns].sort((a, b) => b.cost - a.cost);
  const [showAll, setShowAll] = useState(false);
  const overflowing = sorted.length > 8;
  const visible = showAll ? sorted : sorted.slice(0, 8);
  return (
    <div className="mt-5">
      <div className={`overflow-x-auto ${showAll && overflowing ? 'max-h-[24rem] overflow-y-auto' : ''}`}>
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-[var(--card)]">
            <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              <th className="py-2 pr-3">Campaign</th>
              <th className="px-3 py-2 text-right">Spend</th>
              <th className="px-3 py-2 text-right">Impr.</th>
              <th className="px-3 py-2 text-right">Clicks</th>
              <th className="px-3 py-2 text-right">CTR</th>
              <th className="py-2 pl-3 text-right">Conv.</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <CampaignRowExpandable key={c.id || c.name} campaign={c} accountKey={accountKey} from={from} to={to} />
            ))}
          </tbody>
        </table>
      </div>
      {overflowing && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="mt-2 text-[11px] font-medium text-[var(--primary)] hover:underline"
        >
          {showAll ? 'Show less' : `Show all ${sorted.length}`}
        </button>
      )}
    </div>
  );
}

function CampaignRowExpandable({
  campaign,
  accountKey,
  from,
  to,
}: {
  campaign: CampaignRow;
  accountKey: string;
  from: string;
  to: string;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useSWR<{ adGroups: AdGroupRow[] }>(
    open && campaign.id
      ? `/api/reporting/google/ad-groups?accountKey=${encodeURIComponent(accountKey)}&campaign_id=${campaign.id}&start_date=${from}&end_date=${to}`
      : null,
    fetcher,
  );

  return (
    <>
      <tr
        className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--muted)]/40"
        onClick={() => setOpen((o) => !o)}
      >
        <td className="max-w-[240px] truncate py-2.5 pr-3" title={campaign.name}>
          <ChevronRightIcon className={`mr-1 inline h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
          {campaign.name}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">{usd(campaign.cost)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{num(campaign.impressions)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{num(campaign.clicks)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{pctText(campaign.ctr)}</td>
        <td className="py-2.5 pl-3 text-right tabular-nums">{num(campaign.conversions)}</td>
      </tr>
      {open && (
        <tr className="bg-[var(--muted)]/20">
          <td colSpan={6} className="px-3 py-2">
            {isLoading ? (
              <p className="py-2 text-[11px] text-[var(--muted-foreground)]">Loading ad groups…</p>
            ) : !data?.adGroups?.length ? (
              <p className="py-2 text-[11px] text-[var(--muted-foreground)]">No ad groups in this period.</p>
            ) : (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-[9px] uppercase tracking-wider text-[var(--muted-foreground)]">
                    <th className="py-1 pr-3">Ad group</th>
                    <th className="px-3 py-1">Type</th>
                    <th className="px-3 py-1 text-right">Spend</th>
                    <th className="px-3 py-1 text-right">Impr.</th>
                    <th className="px-3 py-1 text-right">Clicks</th>
                    <th className="py-1 pl-3 text-right">Conv.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.adGroups.map((g) => (
                    <tr key={g.id || g.name} className="border-t border-[var(--border)]/60">
                      <td className="max-w-[220px] truncate py-1.5 pr-3" title={g.name}>{g.name}</td>
                      <td className="px-3 py-1.5 text-[var(--muted-foreground)]">{g.type}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{usd(g.cost)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{num(g.impressions)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{num(g.clicks)}</td>
                      <td className="py-1.5 pl-3 text-right tabular-nums">{num(g.conversions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// Search terms / keywords / locations / auction tables — collapsible + scrollable.
function SimpleTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return <DataTable head={head} rows={rows} />;
}
