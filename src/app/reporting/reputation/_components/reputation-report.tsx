'use client';

/**
 * Reputation tab body. Fetches /api/reporting/reputation and renders the live
 * Google rating + review count (with an optional you-vs-competitor comparison)
 * and recent reviews. Google Places is the source of truth; this only presents.
 */

import useSWR from 'swr';
import { StarIcon as StarSolid } from '@heroicons/react/24/solid';
import {
  StarIcon as StarOutline,
  MapPinIcon,
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon,
  ChartBarIcon,
  LinkSlashIcon,
} from '@heroicons/react/24/outline';
import {
  fetcher,
  num,
  Section,
  Muted,
  EmptyState,
  LoadingState,
  DataTable,
} from '../../ads/_components/shared';
import { connectTarget } from '../../_components/connect-targets';

interface Review {
  author: string;
  rating: number;
  text: string;
  relativeTime: string;
}
interface Place {
  placeId: string;
  name: string;
  address: string;
  rating: number | null;
  reviewCount: number;
  mapsUrl: string;
  website: string;
  businessStatus: string;
  reviews: Review[];
}
interface RepData {
  dealer: string;
  place: Place;
  competitor: Place | null;
  /** Null when the reviews sync hasn't reached this account, or errored. */
  history: ReviewHistory | null;
  coverage: HistoryCoverage | null;
}

interface ReviewHistory {
  reviews: number;
  average: number | null;
  replied: number;
  replyRate: number | null;
  distribution: { stars: number; reviews: number; share: number }[];
  months: { period: string; label: string; reviews: number; average: number | null; replied: number }[];
}
interface HistoryCoverage {
  reviews: number;
  earliest: string | null;
}

function Stars({ rating, size = 'h-4 w-4' }: { rating: number; size?: string }) {
  const rounded = Math.round(rating);
  return (
    <div className="flex items-center gap-0.5 text-amber-400">
      {[1, 2, 3, 4, 5].map((i) =>
        i <= rounded ? <StarSolid key={i} className={size} /> : <StarOutline key={i} className={`${size} text-[var(--muted-foreground)]/40`} />,
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (!status || status === 'OPERATIONAL') return null;
  const closed = status.startsWith('CLOSED');
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider ${
        closed ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'
      }`}
    >
      {status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

function RatingCard({ place, label }: { place: Place; label?: string }) {
  return (
    <div className="glass-section-card rounded-2xl border border-[var(--border)] p-5">
      {label && (
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">{place.name || '(unknown business)'}</p>
          {place.address && (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
              <MapPinIcon className="h-3 w-3" />
              {place.address}
            </p>
          )}
        </div>
        <StatusBadge status={place.businessStatus} />
      </div>

      <div className="mt-4 flex items-baseline gap-3">
        <span className="text-4xl font-bold tabular-nums text-[var(--foreground)]">
          {place.rating != null ? place.rating.toFixed(1) : '—'}
        </span>
        <div>
          {place.rating != null && <Stars rating={place.rating} />}
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{num(place.reviewCount)} reviews</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-[11px]">
        {place.mapsUrl && (
          <a href={place.mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--primary)] hover:underline">
            Google listing <ArrowTopRightOnSquareIcon className="h-3 w-3" />
          </a>
        )}
        {place.website && (
          <a href={place.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--primary)] hover:underline">
            Website <ArrowTopRightOnSquareIcon className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

export function ReputationReport({ accountKey }: { accountKey: string }) {
  const { data, error, isLoading } = useSWR<RepData, Error & { code?: string }>(
    `/api/reporting/reputation?accountKey=${encodeURIComponent(accountKey)}`,
    fetcher,
  );

  if (isLoading) return <LoadingState />;
  if (error) {
    // Unmapped is a setup state an agency user can fix, not an error worth a
    // red panel — see the same split in the GA4 report. `not_configured` is a
    // missing server API key, so it has no per-account link.
    if (error.code === 'no_place') {
      return (
        <EmptyState
          icon={LinkSlashIcon}
          title="Google listing not connected"
          body="No Google place is linked to this account yet, so there is no rating or review history to show."
          connect={connectTarget('places', accountKey)}
        />
      );
    }
    return (
      <EmptyState
        icon={ExclamationTriangleIcon}
        title="Couldn't load reputation"
        body={
          error.code === 'not_configured'
            ? "Google Places isn't configured on the server yet."
            : error.message
        }
        tone="error"
      />
    );
  }
  if (!data) return null;

  const { place, competitor } = data;
  const delta = competitor?.rating != null && place.rating != null ? place.rating - competitor.rating : null;

  return (
    <div className="mt-8 space-y-8">
      {competitor ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RatingCard place={place} label="You" />
          <RatingCard place={competitor} label="Competitor" />
        </div>
      ) : (
        <RatingCard place={place} />
      )}

      {delta != null && (
        <p className="text-xs text-[var(--muted-foreground)]">
          {delta === 0 ? (
            <>Tied with the competitor on rating.</>
          ) : (
            <>
              You&rsquo;re{' '}
              <span className={delta > 0 ? 'font-medium text-emerald-400' : 'font-medium text-red-400'}>
                {Math.abs(delta).toFixed(1)}★ {delta > 0 ? 'ahead of' : 'behind'}
              </span>{' '}
              the competitor.
            </>
          )}
        </p>
      )}

      <Section title="Recent reviews" subtitle="latest from Google">
        {place.reviews.length ? (
          <ul className="space-y-4">
            {place.reviews.map((r, i) => (
              <li key={i} className="border-t border-[var(--border)] pt-4 first:border-0 first:pt-0">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-[var(--foreground)]">{r.author}</span>
                  <div className="flex items-center gap-2">
                    <Stars rating={r.rating} size="h-3.5 w-3.5" />
                    <span className="text-[11px] text-[var(--muted-foreground)]">{r.relativeTime}</span>
                  </div>
                </div>
                {r.text && <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">{r.text}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <Muted>No recent reviews returned for this place.</Muted>
        )}
      </Section>

      <ReviewHistorySection history={data.history ?? null} coverage={data.coverage ?? null} />

      <p className="text-[11px] text-[var(--muted-foreground)]">
        The rating above is live from Google Places — it reflects every review the listing has ever
        had. The history below counts only reviews recorded since the sync began, so the two
        averages can differ.
      </p>
    </div>
  );
}

/**
 * Review history — the half Google Places cannot answer.
 *
 * Places has no history endpoint: no reviews-in-March, no distribution over a
 * range, and no reply status. These come from `ReviewEvent`, which only holds
 * what the sync has recorded — so the section says how far back it goes rather
 * than letting a short history read as a quiet quarter.
 */
function ReviewHistorySection({
  history,
  coverage,
}: {
  history: ReviewHistory | null;
  coverage: HistoryCoverage | null;
}) {
  if (!history || history.reviews === 0) {
    return (
      <Section title="Review history" icon={ChartBarIcon}>
        <Muted>
          No review history recorded yet. History accumulates from the reviews sync — it cannot be
          backfilled from the live Google listing, which only returns a handful of recent reviews.
        </Muted>
      </Section>
    );
  }

  const max = Math.max(...history.distribution.map((d) => d.reviews), 1);

  return (
    <>
      <Section
        title="Review history"
        subtitle={
          coverage?.earliest
            ? `${history.reviews.toLocaleString()} in range · recorded since ${coverage.earliest}`
            : `${history.reviews.toLocaleString()} in range`
        }
        icon={ChartBarIcon}
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            {history.distribution.map((d) => (
              <div key={d.stars} className="flex items-center gap-3">
                <span className="w-10 shrink-0 text-xs tabular-nums text-[var(--muted-foreground)]">
                  {d.stars}★
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--muted)]">
                  <div
                    className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-300"
                    style={{ width: `${(d.reviews / max) * 100}%` }}
                  />
                </div>
                <span className="w-14 shrink-0 text-right text-xs tabular-nums">
                  {d.reviews.toLocaleString()}
                </span>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
                Average in range
              </p>
              <p className="text-xl font-bold tabular-nums">
                {history.average === null ? '—' : history.average.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
                Replied
              </p>
              <p className="text-xl font-bold tabular-nums">
                {history.replyRate === null ? '—' : `${history.replyRate.toFixed(1)}%`}
              </p>
              <Muted>
                {history.replied.toLocaleString()} of {history.reviews.toLocaleString()} reviews in
                this range have a reply.
              </Muted>
            </div>
          </div>
        </div>
      </Section>

      {history.months.length > 0 && (
        <Section title="Reviews by month" icon={ChartBarIcon}>
          <DataTable
            head={['Month', 'Reviews', 'Average', 'Replied']}
            rows={history.months
              .slice()
              .reverse()
              .map((m) => [
                m.label,
                m.reviews.toLocaleString(),
                m.average === null ? '—' : m.average.toFixed(2),
                m.replied.toLocaleString(),
              ])}
            maxRows={12}
          />
        </Section>
      )}
    </>
  );
}
