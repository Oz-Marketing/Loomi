'use client';

/**
 * Billboard report body — the board list, the map, and what's about to lapse.
 *
 * The renewal table leads because that is the job this report actually does.
 * ODT's version opened on the map, which is the prettier answer to a question
 * nobody was asking; the reason anyone opens this page is to find out what
 * comes off the wall next month.
 */

import useSWR from 'swr';
import {
  ExclamationTriangleIcon,
  MapPinIcon,
  ClockIcon,
  EyeIcon,
  BanknotesIcon,
  TableCellsIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';
import {
  fetcher,
  usd0,
  Kpi,
  Section,
  Muted,
  EmptyState,
  LoadingState,
  DataTable,
} from '../../ads/_components/shared';
import { BillboardMap, type BoardPoint } from './billboard-map';

interface Board {
  id: string;
  accountKey: string;
  providerName: string;
  billboardNumber: string;
  artworkUrl: string | null;
  facingDirection: string | null;
  avgDailyTraffic: number | null;
  pricePerPeriod: number | null;
  numPeriods: number;
  periodType: string;
  expirationDate: string | null;
  latitude: number;
  longitude: number;
  notes: string | null;
  state: 'active' | 'expiring' | 'expired' | 'archived';
  daysToExpiry: number | null;
  contractValue: number | null;
  inherited: boolean;
}

interface BoardData {
  dealer: string;
  boards: Board[];
  totals: {
    boards: number;
    active: number;
    expiringSoon: number;
    expired: number;
    totalDailyTraffic: number;
    totalValue: number | null;
    pricedBoards: number;
  };
}

const num = (n: number) => n.toLocaleString('en-US');

/** "in 12 days" / "18 days ago" / "no end date" — a countdown reads faster
    than a date when the question is "how long have I got". */
function countdown(days: number | null, date: string | null): string {
  if (date === null || days === null) return 'No end date';
  if (days === 0) return 'Ends today';
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} left`;
  return `${Math.abs(days)} day${days === -1 ? '' : 's'} ago`;
}

const STATE_TEXT: Record<Board['state'], string> = {
  active: 'Active',
  expiring: 'Expiring soon',
  expired: 'Expired',
  archived: 'Archived',
};

export function BillboardReport({
  accountKey,
  isDark,
}: {
  accountKey: string;
  isDark: boolean;
}) {
  const { data, error, isLoading } = useSWR<BoardData, Error>(
    `/api/reporting/billboards?accountKey=${encodeURIComponent(accountKey)}`,
    fetcher,
  );

  if (isLoading) return <LoadingState />;
  if (error) {
    return (
      <EmptyState
        icon={ExclamationTriangleIcon}
        title="Couldn't load billboards"
        body={error.message}
        tone="error"
      />
    );
  }
  if (!data) return null;

  const { boards, totals } = data;

  if (!boards.length) {
    return (
      <EmptyState
        icon={MapPinIcon}
        title="No boards on file"
        body="Nothing has been recorded for this account. Out-of-home boards are added by your Oz team as contracts are signed."
      />
    );
  }

  // Archived boards stay out of the map and the renewal list — they are history,
  // not inventory — but remain in the full table below so nothing disappears.
  const live = boards.filter((b) => b.state !== 'archived');
  const points: BoardPoint[] = live.map((b) => ({
    id: b.id,
    lat: b.latitude,
    lng: b.longitude,
    label: `#${b.billboardNumber}${b.facingDirection ? ` · facing ${b.facingDirection}` : ''}`,
    provider: b.providerName,
    state: b.state,
    traffic: b.avgDailyTraffic,
  }));

  const renewals = live
    .filter((b) => b.state === 'expiring' || b.state === 'expired')
    .sort((a, b) => (a.daysToExpiry ?? 0) - (b.daysToExpiry ?? 0));

  const inherited = boards.filter((b) => b.inherited).length;
  const withArtwork = boards.filter((b) => b.artworkUrl);

  return (
    <div className="mt-8 space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Kpi icon={MapPinIcon} label="Boards" value={num(totals.boards)} tone="primary" />
        <Kpi
          icon={MapPinIcon}
          label="Active"
          value={num(totals.active)}
          secondary={inherited ? `${num(inherited)} shared from a parent account` : undefined}
          tone="emerald"
        />
        <Kpi
          icon={ClockIcon}
          label="Expiring soon"
          value={num(totals.expiringSoon)}
          secondary="Within 30 days"
          tone="amber"
        />
        <Kpi
          icon={EyeIcon}
          label="Daily impressions"
          value={num(totals.totalDailyTraffic)}
          secondary="Sum of average daily traffic"
          tone="sky"
        />
        <Kpi
          icon={BanknotesIcon}
          label="Contract value"
          value={totals.totalValue == null ? '—' : usd0(totals.totalValue)}
          secondary={
            totals.totalValue == null
              ? 'No boards are priced'
              : totals.pricedBoards < totals.boards
                ? `${num(totals.pricedBoards)} of ${num(totals.boards)} boards priced`
                : undefined
          }
          tone="violet"
        />
      </div>

      {totals.expired > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <Muted>
            {num(totals.expired)} board{totals.expired === 1 ? '' : 's'} passed the contract end date
            and {totals.expired === 1 ? 'is' : 'are'} still listed as active. Either the contract was
            renewed and the date needs updating, or the board has come down.
          </Muted>
        </div>
      )}

      {renewals.length > 0 && (
        <Section
          title="Coming up for renewal"
          subtitle="Soonest first"
          icon={ClockIcon}
        >
          <DataTable
            head={['Board', 'Provider', 'Ends', 'Countdown', 'Status', 'Value']}
            rows={renewals.map((b) => [
              `#${b.billboardNumber}`,
              b.providerName,
              b.expirationDate ?? '—',
              countdown(b.daysToExpiry, b.expirationDate),
              STATE_TEXT[b.state],
              b.contractValue == null ? '—' : usd0(b.contractValue),
            ])}
            maxRows={12}
          />
        </Section>
      )}

      <Section
        title="Board locations"
        subtitle={`${num(points.length)} board${points.length === 1 ? '' : 's'} plotted`}
        icon={MapPinIcon}
      >
        <BillboardMap points={points} isDark={isDark} />
        <div className="mt-3">
          <Muted>
            Positions come from the coordinates recorded for each board. Hover a pin for its number
            and provider. Archived boards are not plotted.
          </Muted>
        </div>
      </Section>

      <Section title="All boards" icon={TableCellsIcon}>
        <DataTable
          head={['Board', 'Provider', 'Facing', 'Daily traffic', 'Term', 'Ends', 'Status']}
          rows={boards.map((b) => [
            `#${b.billboardNumber}${b.inherited ? ' (shared)' : ''}`,
            b.providerName,
            b.facingDirection ?? '—',
            b.avgDailyTraffic == null ? '—' : num(b.avgDailyTraffic),
            `${b.numPeriods || 1} × ${b.periodType}`,
            b.expirationDate ?? '—',
            STATE_TEXT[b.state],
          ])}
          maxRows={25}
        />
        {inherited > 0 && (
          <div className="mt-3">
            <Muted>
              Boards marked &ldquo;shared&rdquo; belong to a parent account and run across more than
              one sub-account, so their traffic and cost are not this sub-account&rsquo;s alone.
            </Muted>
          </div>
        )}
      </Section>

      {withArtwork.length > 0 && (
        <Section
          title="Creative"
          subtitle={`${num(withArtwork.length)} of ${num(boards.length)} boards have artwork on file`}
          icon={PhotoIcon}
        >
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {withArtwork.map((b) => (
              <figure key={b.id} className="overflow-hidden rounded-xl border border-[var(--border)]">
                {/* Plain <img>: artwork lives on the provider's CDN, and routing
                    third-party hosts through the Next image optimizer means a
                    remotePatterns entry per provider that nobody will maintain. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={b.artworkUrl as string}
                  alt={`Creative on board ${b.billboardNumber}`}
                  className="h-32 w-full bg-[var(--muted)] object-cover"
                  loading="lazy"
                />
                <figcaption className="px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
                  #{b.billboardNumber} · {b.providerName}
                </figcaption>
              </figure>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
