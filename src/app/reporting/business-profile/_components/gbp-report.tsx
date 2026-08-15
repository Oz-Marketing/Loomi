'use client';

/**
 * Business Profile report body. Fetches /api/reporting/gbp.
 *
 * The interesting part is the failure handling. Every other platform report can
 * only fail one way — the vendor API is unhappy. This one has a per-account
 * credential, so it distinguishes "the server has no Google app configured",
 * "this account was never connected", "connected but nobody picked a location",
 * and "the grant was revoked". Each needs a different next step, and only staff
 * can take any of them, so the message a client sees points at their account
 * manager rather than at a button they can't use.
 */

import useSWR from 'swr';
import {
  ExclamationTriangleIcon,
  EyeIcon,
  MapIcon,
  MagnifyingGlassIcon,
  CursorArrowRaysIcon,
  PhoneIcon,
  MapPinIcon,
  BoltIcon,
  DevicePhoneMobileIcon,
  BuildingStorefrontIcon,
  LinkIcon,
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
import { DailyStackChart, ShareDonut } from '../../_components/dealer-charts';

interface DailyPoint {
  date: string;
  impressions: number;
  mapImpressions: number;
  searchImpressions: number;
  websiteClicks: number;
  callClicks: number;
  directionRequests: number;
}
interface Summary {
  totalImpressions: number;
  mapImpressions: number;
  searchImpressions: number;
  desktopImpressions: number;
  mobileImpressions: number;
  websiteClicks: number;
  callClicks: number;
  directionRequests: number;
  bookings: number;
  conversations: number;
  foodOrders: number;
  totalActions: number;
}
interface GbpData {
  dealer: string;
  startDate: string;
  endDate: string;
  location: { id: string; name: string | null; address: string | null };
  summary: Summary;
  daily: DailyPoint[];
  devices: { label: string; value: number }[];
  platforms: { label: string; value: number }[];
  keywords: { keyword: string; impressions: number }[];
  keywordsError: string | null;
  keywordsMonth: string;
}

/** What a non-staff viewer is told for each failure the report can hit. */
const CLIENT_MESSAGE: Record<string, string> = {
  not_configured: 'Business Profile reporting isn’t switched on yet. Your account manager can set it up.',
  not_connected:
    'This account isn’t linked to its Google Business Profile yet. Your account manager can connect it.',
  no_location:
    'The Google connection is in place but no location has been selected yet. Your account manager can finish the setup.',
  auth_expired:
    'The Google connection for this account needs to be renewed. Your account manager can reconnect it.',
};

export function GbpReport({
  accountKey,
  from,
  to,
  isDark,
  canManage,
  refreshKey,
}: {
  accountKey: string;
  from: string;
  to: string;
  isDark: boolean;
  /** Staff see the connect panel; clients see an explanation. */
  canManage: boolean;
  /** Bumped by the connect panel so the report refetches after a change. */
  refreshKey: number;
}) {
  const { data, error, isLoading } = useSWR<GbpData, Error & { code?: string }>(
    `/api/reporting/gbp?accountKey=${encodeURIComponent(accountKey)}&start_date=${from}&end_date=${to}&r=${refreshKey}`,
    fetcher,
  );

  if (isLoading) return <LoadingState />;

  if (error) {
    const code = error.code ?? '';
    const setupIssue = code in CLIENT_MESSAGE;

    // Staff get the connect panel rendered above by the page, so here they only
    // need to know what's wrong — not a second copy of the buttons.
    return (
      <EmptyState
        icon={setupIssue ? LinkIcon : ExclamationTriangleIcon}
        title={setupIssue ? 'Not connected yet' : 'Couldn’t load Business Profile'}
        body={
          canManage
            ? error.message
            : (CLIENT_MESSAGE[code] ??
              'This report is temporarily unavailable. Your account manager has been able to see the details.')
        }
        tone={setupIssue ? 'muted' : 'error'}
      />
    );
  }
  if (!data) return null;

  const s = data.summary;

  if (!s.totalImpressions && !s.totalActions) {
    return (
      <EmptyState
        icon={MapIcon}
        title="No activity in this range"
        body={`Google reported no impressions or actions for ${data.location.name ?? 'this location'} between ${prettyDate(data.startDate)} and ${prettyDate(data.endDate)}. Business Profile data also lags by two to three days.`}
      />
    );
  }

  const actionRows = [
    { label: 'Website clicks', value: s.websiteClicks },
    { label: 'Calls', value: s.callClicks },
    { label: 'Direction requests', value: s.directionRequests },
    { label: 'Messages', value: s.conversations },
    { label: 'Bookings', value: s.bookings },
    { label: 'Food orders', value: s.foodOrders },
  ].filter((r) => r.value > 0);

  return (
    <div className="mt-8 space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={EyeIcon} label="Impressions" value={num(s.totalImpressions)} tone="primary" />
        <Kpi
          icon={MagnifyingGlassIcon}
          label="Search"
          value={num(s.searchImpressions)}
          secondary={
            s.totalImpressions ? pctText((s.searchImpressions / s.totalImpressions) * 100) : undefined
          }
          tone="emerald"
        />
        <Kpi
          icon={MapIcon}
          label="Maps"
          value={num(s.mapImpressions)}
          secondary={
            s.totalImpressions ? pctText((s.mapImpressions / s.totalImpressions) * 100) : undefined
          }
          tone="sky"
        />
        <Kpi icon={CursorArrowRaysIcon} label="Website clicks" value={num(s.websiteClicks)} tone="violet" />
        <Kpi icon={PhoneIcon} label="Calls" value={num(s.callClicks)} tone="amber" />
        <Kpi
          icon={BoltIcon}
          label="Total actions"
          value={num(s.totalActions)}
          secondary={
            s.totalImpressions
              ? `${pctText((s.totalActions / s.totalImpressions) * 100)} of impressions`
              : undefined
          }
          tone="zinc"
        />
      </div>

      <Section
        title="Impressions by day"
        subtitle={`${prettyDate(data.startDate)} – ${prettyDate(data.endDate)}`}
        icon={EyeIcon}
      >
        {data.daily.length ? (
          <DailyStackChart
            rows={data.daily}
            series={[
              { name: 'Search', key: 'searchImpressions' },
              { name: 'Maps', key: 'mapImpressions' },
            ]}
            isDark={isDark}
          />
        ) : (
          <Muted>No daily data for this range.</Muted>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Where people saw you" subtitle="Search vs Maps" icon={MapIcon}>
          <ShareDonut items={data.platforms} isDark={isDark} />
        </Section>
        <Section title="What they were on" subtitle="Mobile vs desktop" icon={DevicePhoneMobileIcon}>
          <ShareDonut items={data.devices} isDark={isDark} />
        </Section>
      </div>

      {actionRows.length > 0 && (
        <Section title="What people did" subtitle="Actions taken from the listing" icon={BoltIcon}>
          <DataTable
            head={['Action', 'Count', 'Share of actions']}
            rows={actionRows.map((r) => [
              r.label,
              num(r.value),
              s.totalActions ? pctText((r.value / s.totalActions) * 100) : '—',
            ])}
            maxRows={6}
          />
        </Section>
      )}

      <Section
        title="Search terms"
        subtitle={`Impressions in ${new Date(`${data.keywordsMonth}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`}
        icon={MagnifyingGlassIcon}
      >
        {data.keywordsError ? (
          <Muted>Search terms aren&rsquo;t available for this location ({data.keywordsError}).</Muted>
        ) : data.keywords.length ? (
          <>
            <DataTable
              head={['Search term', 'Impressions']}
              rows={data.keywords.map((k) => [k.keyword, num(k.impressions)])}
              maxRows={10}
            />
            <div className="mt-3">
              <Muted>
                Google only publishes search terms by calendar month, so this covers the whole of
                the month above rather than the date range on the rest of the page. Terms below
                Google&rsquo;s privacy threshold are withheld and won&rsquo;t appear.
              </Muted>
            </div>
          </>
        ) : (
          <Muted>No search terms reported for this month.</Muted>
        )}
      </Section>

      <Section title="Location" icon={BuildingStorefrontIcon}>
        <div className="flex items-start gap-2">
          <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">
              {data.location.name ?? data.location.id}
            </p>
            {data.location.address && <Muted>{data.location.address}</Muted>}
          </div>
        </div>
      </Section>
    </div>
  );
}
