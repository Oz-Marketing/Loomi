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
} from '@heroicons/react/24/outline';
import { fetcher, num, Section, Muted, EmptyState, LoadingState } from '../../ads/_components/shared';

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
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
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
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p>
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
    const body =
      error.code === 'no_place'
        ? 'No Google place is mapped to this account yet. Map it on the server, then refresh.'
        : error.code === 'not_configured'
          ? "Google Places isn't configured on the server yet."
          : error.message;
    return <EmptyState icon={ExclamationTriangleIcon} title="Couldn't load reputation" body={body} tone="error" />;
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

      <p className="text-[11px] text-[var(--muted-foreground)]">
        Live from Google Places. Full review history, trends, and reply rates arrive with the reviews pipeline.
      </p>
    </div>
  );
}
