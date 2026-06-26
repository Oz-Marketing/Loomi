'use client';

/**
 * Websites tab body. Fetches /api/reporting/ga4 and renders KPIs, a daily
 * sessions/users trend, channel + device mix, vehicle-detail-page (VDP)
 * engagement, top pages, and a source/medium table. GA4 is the source of
 * truth; this component only presents.
 */

import useSWR from 'swr';
import {
  CursorArrowRaysIcon,
  UsersIcon,
  UserPlusIcon,
  EyeIcon,
  ArrowTrendingDownIcon,
  ClockIcon,
  GlobeAltIcon,
  DevicePhoneMobileIcon,
  TruckIcon,
  FunnelIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import {
  fetcher,
  num,
  pctText,
  prettyDate,
  Kpi,
  Section,
  Muted,
  EmptyState,
  LoadingState,
  DataTable,
} from '../../ads/_components/shared';
import { Ga4TrendChart, Ga4ChannelDonut } from './ga4-charts';

interface Overview {
  sessions: number;
  totalUsers: number;
  newUsers: number;
  pageViews: number;
  bounceRate: number;
  avgSessionDuration: number;
}
interface TrendPoint {
  date: string;
  sessions: number;
  users: number;
}
interface SourceRow {
  channel: string;
  sessions: number;
  users: number;
}
interface PageRow {
  title: string;
  path: string;
  views: number;
  avgTime: number;
}
interface DeviceRow {
  device: string;
  sessions: number;
  users: number;
}
interface SourceMediumRow {
  source: string;
  medium: string;
  sessions: number;
  users: number;
  newUsers: number;
  bounceRate: number;
  avgDuration: number;
  pageViews: number;
}
interface VdpPageRow {
  title: string;
  path: string;
  views: number;
  users: number;
  avgDuration: number;
}
interface Ga4Data {
  dealer: string;
  propertyId: string;
  platform: string;
  startDate: string;
  endDate: string;
  overview: Overview;
  trend: TrendPoint[];
  sources: SourceRow[];
  topPages: PageRow[];
  devices: DeviceRow[];
  sourceMedium: SourceMediumRow[];
  vdp: { totalViews: number; pages: VdpPageRow[] };
}

/** Seconds → "1m 42s" / "0m 8s". */
function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

export function Ga4Report({
  accountKey,
  from,
  to,
  isDark,
}: {
  accountKey: string;
  from: string;
  to: string;
  isDark: boolean;
}) {
  const { data, error, isLoading } = useSWR<Ga4Data, Error & { code?: string }>(
    `/api/reporting/ga4?accountKey=${encodeURIComponent(accountKey)}&start_date=${from}&end_date=${to}`,
    fetcher,
  );

  if (isLoading) return <LoadingState />;
  if (error) {
    const body =
      error.code === 'no_property'
        ? 'No GA4 property is mapped to this account yet. Map it on the server, then refresh.'
        : error.code === 'not_configured'
          ? "Google Analytics isn't configured on the server yet."
          : error.message;
    return (
      <EmptyState
        icon={ExclamationTriangleIcon}
        title="Couldn't load website analytics"
        body={body}
        tone="error"
      />
    );
  }
  if (!data) return null;

  const o = data.overview;

  return (
    <div className="mt-8 space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={CursorArrowRaysIcon} label="Sessions" value={num(o.sessions)} tone="primary" />
        <Kpi icon={UsersIcon} label="Users" value={num(o.totalUsers)} tone="sky" />
        <Kpi icon={UserPlusIcon} label="New users" value={num(o.newUsers)} tone="emerald" />
        <Kpi icon={EyeIcon} label="Page views" value={num(o.pageViews)} tone="violet" />
        <Kpi icon={ArrowTrendingDownIcon} label="Bounce rate" value={pctText(o.bounceRate * 100)} tone="amber" />
        <Kpi icon={ClockIcon} label="Avg session" value={duration(o.avgSessionDuration)} tone="zinc" />
      </div>

      <Section title="Traffic trend" subtitle={`${prettyDate(data.startDate)} – ${prettyDate(data.endDate)}`}>
        {data.trend.length ? (
          <Ga4TrendChart rows={data.trend} isDark={isDark} />
        ) : (
          <Muted>No sessions recorded for this range.</Muted>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Channels" subtitle="by sessions" icon={GlobeAltIcon}>
          {data.sources.length ? (
            <Ga4ChannelDonut items={data.sources.map((s) => ({ label: s.channel, value: s.sessions }))} isDark={isDark} />
          ) : (
            <Muted>No channel data for this range.</Muted>
          )}
        </Section>

        <Section title="Devices" subtitle="by sessions" icon={DevicePhoneMobileIcon}>
          {data.devices.length ? (
            <Ga4ChannelDonut items={data.devices.map((d) => ({ label: d.device, value: d.sessions }))} isDark={isDark} />
          ) : (
            <Muted>No device data for this range.</Muted>
          )}
        </Section>
      </div>

      <Section
        title="Vehicle detail pages"
        subtitle={`${num(data.vdp.totalViews)} VDP views · ${data.platform}`}
        icon={TruckIcon}
      >
        {data.vdp.pages.length ? (
          <DataTable
            head={['Vehicle page', 'Path', 'Views', 'Users', 'Avg time']}
            rows={data.vdp.pages.map((p) => [
              p.title || '(untitled)',
              p.path,
              num(p.views),
              num(p.users),
              duration(p.avgDuration),
            ])}
          />
        ) : (
          <Muted>No vehicle-detail-page views matched the {data.platform} URL pattern for this range.</Muted>
        )}
      </Section>

      <Section title="Top pages" subtitle="by views" icon={DocumentTextIcon}>
        {data.topPages.length ? (
          <DataTable
            head={['Page', 'Path', 'Views', 'Avg time']}
            rows={data.topPages.map((p) => [p.title || '(untitled)', p.path, num(p.views), duration(p.avgTime)])}
          />
        ) : (
          <Muted>No page data for this range.</Muted>
        )}
      </Section>

      <Section title="Source / medium" subtitle="top 25 by sessions" icon={FunnelIcon}>
        {data.sourceMedium.length ? (
          <DataTable
            head={['Source', 'Medium', 'Sessions', 'Users', 'New', 'Bounce', 'Views']}
            rows={data.sourceMedium.map((s) => [
              s.source,
              s.medium,
              num(s.sessions),
              num(s.users),
              num(s.newUsers),
              pctText(s.bounceRate * 100),
              num(s.pageViews),
            ])}
          />
        ) : (
          <Muted>No source/medium data for this range.</Muted>
        )}
      </Section>

      <p className="text-[11px] text-[var(--muted-foreground)]">GA4 property {data.propertyId}</p>
    </div>
  );
}
