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
  ClockIcon,
  ArrowTrendingDownIcon,
  GlobeAltIcon,
  DevicePhoneMobileIcon,
  TruckIcon,
  FunnelIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  LinkSlashIcon,
  CheckBadgeIcon,
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
import { connectTarget } from '../../_components/connect-targets';
import type { ReportLens } from '../../_components/lens';
import { Ga4TrendChart, Ga4ChannelDonut } from './ga4-charts';

interface Overview {
  sessions: number;
  totalUsers: number;
  newUsers: number;
  pageViews: number;
  bounceRate: number;
  avgSessionDuration: number;
  /** GA4's 2024 rename of "conversions" — form fills, calls, VDP milestones. */
  keyEvents: number;
  keyEventRate: number;
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
  keyEvents: number;
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
  lens,
}: {
  accountKey: string;
  from: string;
  to: string;
  isDark: boolean;
  lens: ReportLens;
}) {
  const { data, error, isLoading } = useSWR<Ga4Data, Error & { code?: string }>(
    `/api/reporting/ga4?accountKey=${encodeURIComponent(accountKey)}&start_date=${from}&end_date=${to}`,
    fetcher,
  );

  if (isLoading) return <LoadingState />;
  if (error) {
    // An unmapped account is a SETUP state, not a failure: an agency user can
    // fix it in two clicks and a client should not be shown a red panel about
    // our configuration. `not_configured` stays an error — that one is a
    // missing server credential, with no per-account fix to link to.
    if (error.code === 'no_property') {
      return (
        <EmptyState
          icon={LinkSlashIcon}
          title="Google Analytics not connected"
          body="No GA4 property is linked to this account yet, so there are no website numbers to show."
          connect={connectTarget('ga4', accountKey)}
        />
      );
    }
    return (
      <EmptyState
        icon={ExclamationTriangleIcon}
        title="Couldn't load website analytics"
        body={
          error.code === 'not_configured'
            ? "Google Analytics isn't configured on the server yet."
            : error.message
        }
        tone="error"
      />
    );
  }
  if (!data) return null;

  const o = data.overview;
  const team = lens === 'team';

  return (
    <div className="mt-8 space-y-8">
      {/* Four across, not six: with key events added there are seven headline
          metrics, and a six-wide grid strands the seventh alone on its own row.
          4 + 3 also gives each tile enough width that a two-word label
          ("Bounce rate", "Avg session") stops truncating. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        <Kpi
          icon={CheckBadgeIcon}
          label="Key events"
          value={num(o.keyEvents)}
          secondary={
            o.keyEvents > 0
              ? `${pctText(o.keyEventRate * 100)} of sessions`
              : 'none configured in GA4'
          }
          tone="primary"
        />
        <Kpi icon={CursorArrowRaysIcon} label="Sessions" value={num(o.sessions)} tone="sky" />
        <Kpi icon={UsersIcon} label="Users" value={num(o.totalUsers)} tone="emerald" />
        <Kpi icon={UserPlusIcon} label="New users" value={num(o.newUsers)} tone="violet" />
        <Kpi icon={EyeIcon} label="Page views" value={num(o.pageViews)} tone="amber" />
        {/* GA4 renamed this metric's replacement `engagementRate` and treats
            bounce as its inverse, but bounce rate is still what a dealer asks
            for by name — so it stays. Swapping to engaged sessions is a
            deliberate, separate change (Tier 2), not a silent one. */}
        <Kpi
          icon={ArrowTrendingDownIcon}
          label="Bounce rate"
          value={pctText(o.bounceRate * 100)}
          tone="zinc"
        />
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
        <Section title="Channels" subtitle="sessions & key events" icon={GlobeAltIcon}>
          {data.sources.length ? (
            <>
              <Ga4ChannelDonut items={data.sources.map((s) => ({ label: s.channel, value: s.sessions }))} isDark={isDark} />
              <DataTable
                head={['Channel', 'Sessions', 'Users', 'Key events']}
                rows={data.sources.map((s) => [s.channel, num(s.sessions), num(s.users), num(s.keyEvents)])}
                maxRows={6}
              />
            </>
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

      {/* TEAM ONLY. Channels above already answer "where did traffic come
          from" for a client. This is the reconciliation cut — where (not set),
          self-referrals and bot traffic surface, and where GA4 gets tied back
          to the ad platforms. It is a debugging tool, not a result. */}
      {team && (
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
      )}

      {team && (
        <p className="text-[11px] text-[var(--muted-foreground)]">GA4 property {data.propertyId}</p>
      )}
    </div>
  );
}
