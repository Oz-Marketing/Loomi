'use client';

/**
 * The single list of per-account reporting sources, and the fan-out that
 * gathers them.
 *
 * Two surfaces need "every report for one account, side by side": the
 * Marketing Overview dashboard and the Ad Meeting deliverable. They were
 * always going to drift if each kept its own list of routes and its own idea
 * of where a platform hides its totals — one would gain a channel the other
 * silently lacked, and nobody would notice until a client asked why the deck
 * and the dashboard disagreed. So the list lives here and both import it.
 *
 * THE FAN-OUT IS CLIENT-SIDE, and deliberately: these are the same routes the
 * individual report pages call, with the same auth, margin handling and
 * comparison logic. A server-side aggregator would be a second implementation
 * of all of it, and its first bug would be a number here disagreeing with the
 * report it came from.
 *
 * EVERY SOURCE FAILS INDEPENDENTLY. No account has every channel, so an
 * unconfigured or failing one becomes a labelled absence carrying the route's
 * own message — never a silently missing tile.
 */

export type SourceStatus = 'ok' | 'unavailable';

export interface SourceResult {
  key: string;
  label: string;
  status: SourceStatus;
  /** Why it's missing — the route's own words, shown to the user. */
  note?: string;
  metrics: Record<string, number> | null;
}

export interface SourceDef {
  key: string;
  label: string;
  path: string;
  /** Whether the route accepts start_date/end_date. */
  dated: boolean;
}

/** Order here is the order channels appear in both surfaces. */
export const ACCOUNT_SOURCES: SourceDef[] = [
  { key: 'google', label: 'Google Ads', path: '/api/reporting/google', dated: true },
  { key: 'meta', label: 'Meta', path: '/api/reporting/ads', dated: true },
  { key: 'stackadapt', label: 'OTT / CTV', path: '/api/reporting/stackadapt', dated: true },
  // Repointed from /api/reporting/email, which carried only the previous
  // provider's sends AND nested them under `stats` — a key extractMetrics
  // below never reads, so this channel has been coming back empty whatever the
  // account had. The merged route exposes `summary`, which it does read.
  { key: 'email', label: 'Email & text', path: '/api/reporting/blasts', dated: true },
  { key: 'ga4', label: 'Website', path: '/api/reporting/ga4', dated: true },
  { key: 'reputation', label: 'Reputation', path: '/api/reporting/reputation', dated: false },
];

/**
 * Pull the flat totals object out of a route response.
 *
 * The platform routes nest theirs under `accountMetrics`; GA4 uses `overview`;
 * reputation reports a rating at the top level. Mirrors the mapping in
 * `rollup-configs.ts`, which does the same job for the multi-account roll-up.
 */
export function extractMetrics(key: string, data: unknown): Record<string, number> | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;

  const candidate = d.accountMetrics ?? d.overview ?? d.summary ?? null;
  if (candidate && typeof candidate === 'object') {
    return candidate as Record<string, number>;
  }
  if (key === 'reputation') {
    const rating = Number((d.place as { rating?: number } | undefined)?.rating ?? d.rating ?? 0);
    const reviewCount = Number(
      (d.place as { reviewCount?: number } | undefined)?.reviewCount ?? d.reviewCount ?? 0,
    );
    return rating || reviewCount ? { rating, reviewCount } : null;
  }
  return null;
}

export async function fetchSource(
  src: SourceDef,
  accountKey: string,
  from: string,
  to: string,
): Promise<SourceResult> {
  const params = new URLSearchParams({ accountKey });
  if (src.dated) {
    params.set('start_date', from);
    params.set('end_date', to);
  }
  try {
    const res = await fetch(`${src.path}?${params.toString()}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        key: src.key,
        label: src.label,
        status: 'unavailable',
        // The route's own message distinguishes "not configured" from "the
        // vendor is down", which a generic string would flatten.
        note: body?.error || `Request failed (${res.status})`,
        metrics: null,
      };
    }
    const metrics = extractMetrics(src.key, body);
    return metrics
      ? { key: src.key, label: src.label, status: 'ok', metrics }
      : {
          key: src.key,
          label: src.label,
          status: 'unavailable',
          note: 'No data reported for this period',
          metrics: null,
        };
  } catch (err) {
    return {
      key: src.key,
      label: src.label,
      status: 'unavailable',
      note: err instanceof Error ? err.message : 'Could not be reached',
      metrics: null,
    };
  }
}

/** All sources in parallel — independent vendor calls, so don't serialize. */
export function fetchAllSources(
  accountKey: string,
  from: string,
  to: string,
): Promise<SourceResult[]> {
  return Promise.all(ACCOUNT_SOURCES.map((s) => fetchSource(s, accountKey, from, to)));
}

/** GET a dealer-data route, or null if it isn't available for this account. */
export async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/** Google reports `cost` where Meta and StackAdapt report `spend`. */
export function sourceSpend(r: SourceResult): number {
  return n(r.metrics?.spend ?? r.metrics?.cost);
}

/** Media sources only — GA4 and Reputation buy nothing. */
export function isMediaSource(r: SourceResult): boolean {
  return r.key !== 'ga4' && r.key !== 'reputation';
}
