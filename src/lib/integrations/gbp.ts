/**
 * Google Business Profile — OAuth + Performance API client.
 *
 * Port of Oz Dealer Tools' `GoogleBusinessProfileApi` library.
 *
 * ── WHY THIS ONE IS DIFFERENT ───────────────────────────────────────────────
 * Every other Google integration in Loomi authenticates as the AGENCY: Google
 * Ads has one refresh token in env, GA4 has one service account, and both are
 * used for every dealer. Business Profile cannot work that way. A location's
 * insights are readable only by a Google identity that manages that listing,
 * and that identity belongs to the dealership. So each account carries its own
 * grant in `GbpConnection`, and the token is a person's, not ours.
 *
 * ── CONFIG ──────────────────────────────────────────────────────────────────
 * GBP_CLIENT_ID / GBP_CLIENT_SECRET / GBP_REDIRECT_URI.
 *
 * These can be the SAME Google Cloud OAuth client Oz Dealer Tools already uses
 * (project 976098770938). The Business Profile APIs require Google to approve
 * project access through a request form; that approval already exists on the
 * ODT project, so reusing its client id and secret avoids a fresh application.
 * The only Cloud Console change needed is adding Loomi's callback to the
 * client's authorised redirect URIs.
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────────
 * `business.manage` is the only scope Google publishes for these APIs, and it
 * is read/write — there is no read-only variant. Loomi only ever issues GETs
 * (see the single `apiGet` below); nothing in this module can modify a
 * listing. Keep it that way: the scope makes writes *possible*, and the code is
 * the thing preventing them.
 */
import { z } from 'zod';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const ACCOUNT_MGMT_URL = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const BUSINESS_INFO_URL = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const PERFORMANCE_URL = 'https://businessprofileperformance.googleapis.com/v1';
const SCOPE = 'https://www.googleapis.com/auth/business.manage';

/** The daily metrics ODT requests. Same list, same names as the API. */
export const DAILY_METRICS = [
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'WEBSITE_CLICKS',
  'CALL_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS',
  'BUSINESS_BOOKINGS',
  'BUSINESS_CONVERSATIONS',
  'BUSINESS_FOOD_ORDERS',
] as const;

export type GbpErrorCode =
  | 'not_configured'
  | 'not_connected'
  | 'no_location'
  | 'auth_expired'
  | 'api_error';

export class GbpError extends Error {
  constructor(
    message: string,
    public code: GbpErrorCode,
  ) {
    super(message);
    this.name = 'GbpError';
  }
}

export interface GbpConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getGbpConfig(): GbpConfig | null {
  const clientId = process.env.GBP_CLIENT_ID?.trim();
  const clientSecret = process.env.GBP_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GBP_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

function requireConfig(): GbpConfig {
  const cfg = getGbpConfig();
  if (!cfg) {
    throw new GbpError(
      'Google Business Profile is not configured on the server (set GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REDIRECT_URI).',
      'not_configured',
    );
  }
  return cfg;
}

// ── OAuth ──

/**
 * Consent URL.
 *
 * `access_type=offline` + `prompt=consent` because we need a refresh token and
 * Google only returns one on a fresh consent — a silent re-auth of an already
 * granted client returns an access token alone, which would leave us unable to
 * refresh tomorrow.
 */
export function buildAuthUrl(state: string): string {
  const cfg = requireConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

const TokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
});

export async function exchangeCode(
  code: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const cfg = requireConfig();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new GbpError(
      `Token exchange failed: ${body?.error_description || body?.error || res.status}`,
      'api_error',
    );
  }

  const parsed = TokenResponse.safeParse(body);
  if (!parsed.success) throw new GbpError('Unexpected token response from Google.', 'api_error');
  if (!parsed.data.refresh_token) {
    // Happens when the user has already granted this client and Google skips
    // the consent screen. `prompt=consent` above is what prevents it; if we get
    // here anyway, storing nothing is better than storing a token we can't renew.
    throw new GbpError(
      'Google did not return a refresh token. Remove Loomi from the account’s third-party access at myaccount.google.com and connect again.',
      'auth_expired',
    );
  }
  return { accessToken: parsed.data.access_token, refreshToken: parsed.data.refresh_token };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const cfg = requireConfig();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // invalid_grant means the person revoked access, changed their password, or
    // the grant expired. Nothing to retry — the account must reconnect.
    const expired = body?.error === 'invalid_grant';
    throw new GbpError(
      expired
        ? 'This account’s Google authorisation has expired or been revoked. Reconnect to restore the report.'
        : `Could not refresh Google access: ${body?.error_description || body?.error || res.status}`,
      expired ? 'auth_expired' : 'api_error',
    );
  }
  const token = body?.access_token;
  if (typeof token !== 'string') throw new GbpError('No access token returned.', 'api_error');
  return token;
}

async function apiGet<T = unknown>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } })?.error?.message || `HTTP ${res.status}`;
    throw new GbpError(msg, res.status === 401 || res.status === 403 ? 'auth_expired' : 'api_error');
  }
  return body as T;
}

export async function getUserEmail(accessToken: string): Promise<string | null> {
  try {
    const me = await apiGet<{ email?: string }>(USERINFO_URL, accessToken);
    return me.email ?? null;
  } catch {
    // Informational only — never fail a connect because we couldn't read the
    // account's email address.
    return null;
  }
}

// ── Location discovery ──

export interface GbpLocation {
  /** "locations/12345678901234567890" */
  name: string;
  title: string;
  address: string | null;
}

function formatAddress(a?: {
  addressLines?: string[];
  locality?: string;
  administrativeArea?: string;
  postalCode?: string;
}): string | null {
  if (!a) return null;
  const parts = [
    ...(a.addressLines ?? []),
    [a.locality, a.administrativeArea].filter(Boolean).join(', '),
    a.postalCode,
  ].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.length ? parts.join(', ') : null;
}

/**
 * Every location the grant can see, across every Business Profile account it
 * belongs to.
 *
 * Two hops: an identity belongs to N Business Profile *accounts* (personal,
 * agency, location groups), and each holds M *locations*. ODT made the caller
 * do both; folding them together here means the picker gets one flat list,
 * which is what it actually wants.
 */
export async function listAllLocations(accessToken: string): Promise<GbpLocation[]> {
  const accounts = await apiGet<{ accounts?: { name: string }[] }>(
    `${ACCOUNT_MGMT_URL}/accounts?pageSize=100`,
    accessToken,
  );

  const out: GbpLocation[] = [];
  for (const acct of accounts.accounts ?? []) {
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        readMask: 'name,title,storefrontAddress',
        pageSize: '100',
      });
      if (pageToken) params.set('pageToken', pageToken);

      const page = await apiGet<{
        locations?: {
          name: string;
          title?: string;
          storefrontAddress?: Parameters<typeof formatAddress>[0];
        }[];
        nextPageToken?: string;
      }>(`${BUSINESS_INFO_URL}/${acct.name}/locations?${params.toString()}`, accessToken);

      for (const loc of page.locations ?? []) {
        out.push({
          name: loc.name,
          title: loc.title || loc.name,
          address: formatAddress(loc.storefrontAddress),
        });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }

  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/** The Performance API wants a bare "locations/{id}" path. */
export function normalizeLocationId(locationId: string): string {
  const trimmed = locationId.trim();
  if (trimmed.startsWith('locations/')) return trimmed;
  // Tolerate "accounts/123/locations/456", which is what the older
  // account-management endpoints hand back.
  const idx = trimmed.indexOf('locations/');
  if (idx >= 0) return trimmed.slice(idx);
  return `locations/${trimmed}`;
}

// ── Performance metrics ──

function dateParams(prefix: string, iso: string): string[] {
  const [y, m, d] = iso.split('-').map(Number);
  return [`${prefix}.year=${y}`, `${prefix}.month=${m}`, `${prefix}.day=${d}`];
}

export async function fetchDailyMetrics(
  accessToken: string,
  locationId: string,
  startDate: string,
  endDate: string,
): Promise<unknown> {
  const params = [
    ...DAILY_METRICS.map((m) => `dailyMetrics=${m}`),
    ...dateParams('dailyRange.start_date', startDate),
    ...dateParams('dailyRange.end_date', endDate),
  ];
  const url = `${PERFORMANCE_URL}/${normalizeLocationId(locationId)}:fetchMultiDailyMetricsTimeSeries?${params.join('&')}`;
  return apiGet(url, accessToken);
}

export interface GbpKeyword {
  keyword: string;
  impressions: number;
}

/**
 * Search keywords are MONTHLY only — the API has no daily grain for them, so
 * they can't be aligned to an arbitrary report range. The caller passes the
 * month it wants and the UI says which month it is showing.
 */
export async function fetchSearchKeywords(
  accessToken: string,
  locationId: string,
  year: number,
  month: number,
  limit = 30,
): Promise<GbpKeyword[]> {
  const params = new URLSearchParams({
    'monthlyRange.start_month.year': String(year),
    'monthlyRange.start_month.month': String(month),
    'monthlyRange.end_month.year': String(year),
    'monthlyRange.end_month.month': String(month),
  });
  const url = `${PERFORMANCE_URL}/${normalizeLocationId(locationId)}/searchkeywords/impressions/monthly?${params.toString()}`;

  const data = await apiGet<{
    searchKeywordsCounts?: { searchKeyword?: string; insightsValue?: { value?: string | number } }[];
  }>(url, accessToken);

  return (data.searchKeywordsCounts ?? [])
    .map((k) => ({
      keyword: k.searchKeyword ?? '',
      // The API returns `value` as a STRING for large counts (int64 over the
      // wire), and omits it entirely below its privacy threshold.
      impressions: Number(k.insightsValue?.value ?? 0) || 0,
    }))
    .filter((k) => k.keyword)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}

// ── Parsing ──

export interface GbpDailyPoint {
  date: string;
  impressions: number;
  mapImpressions: number;
  searchImpressions: number;
  websiteClicks: number;
  callClicks: number;
  directionRequests: number;
}

export interface GbpSummary {
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
  /** Every action a customer took, over impressions. */
  totalActions: number;
}

export interface GbpParsed {
  summary: GbpSummary;
  daily: GbpDailyPoint[];
  devices: { label: string; value: number }[];
  platforms: { label: string; value: number }[];
}

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/**
 * Flatten `fetchMultiDailyMetricsTimeSeries` into a date series plus totals.
 *
 * The response nests three deep and the middle layer is inconsistent: some
 * responses wrap each metric in `dailyMetricTimeSeries`, others put the series
 * at the top level of `multiDailyMetricTimeSeries`. ODT handles both with a
 * fallback and so does this — dropping the fallback silently returns zeros for
 * whichever shape you didn't expect.
 *
 * A date absent from a metric's series means zero for that metric on that day,
 * not a gap: Google omits empty days rather than sending them.
 */
export function parseMetrics(raw: unknown): GbpParsed {
  const root = (raw ?? {}) as {
    multiDailyMetricTimeSeries?: {
      dailyMetricTimeSeries?: unknown[];
      dailyMetric?: string;
      timeSeries?: unknown;
    }[];
  };

  const totals: Record<string, number> = {};
  const byDate = new Map<string, Record<string, number>>();

  for (const outer of root.multiDailyMetricTimeSeries ?? []) {
    const seriesList = (outer.dailyMetricTimeSeries ?? [outer]) as {
      dailyMetric?: string;
      timeSeries?: { datedValues?: { date?: { year?: number; month?: number; day?: number }; value?: unknown }[] };
    }[];

    for (const series of seriesList) {
      const metric = series.dailyMetric ?? 'UNKNOWN';
      totals[metric] ??= 0;

      for (const dv of series.timeSeries?.datedValues ?? []) {
        const y = dv.date?.year ?? 0;
        const m = dv.date?.month ?? 0;
        const d = dv.date?.day ?? 0;
        if (!y || !m || !d) continue;
        const date = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

        const row = byDate.get(date) ?? {};
        row[metric] = (row[metric] ?? 0) + n(dv.value);
        byDate.set(date, row);
        totals[metric] += n(dv.value);
      }
    }
  }

  const t = (k: string) => totals[k] ?? 0;

  const mapImpressions =
    t('BUSINESS_IMPRESSIONS_DESKTOP_MAPS') + t('BUSINESS_IMPRESSIONS_MOBILE_MAPS');
  const searchImpressions =
    t('BUSINESS_IMPRESSIONS_DESKTOP_SEARCH') + t('BUSINESS_IMPRESSIONS_MOBILE_SEARCH');
  const desktopImpressions =
    t('BUSINESS_IMPRESSIONS_DESKTOP_MAPS') + t('BUSINESS_IMPRESSIONS_DESKTOP_SEARCH');
  const mobileImpressions =
    t('BUSINESS_IMPRESSIONS_MOBILE_MAPS') + t('BUSINESS_IMPRESSIONS_MOBILE_SEARCH');

  const summary: GbpSummary = {
    totalImpressions: mapImpressions + searchImpressions,
    mapImpressions,
    searchImpressions,
    desktopImpressions,
    mobileImpressions,
    websiteClicks: t('WEBSITE_CLICKS'),
    callClicks: t('CALL_CLICKS'),
    directionRequests: t('BUSINESS_DIRECTION_REQUESTS'),
    bookings: t('BUSINESS_BOOKINGS'),
    conversations: t('BUSINESS_CONVERSATIONS'),
    foodOrders: t('BUSINESS_FOOD_ORDERS'),
    totalActions:
      t('WEBSITE_CLICKS') +
      t('CALL_CLICKS') +
      t('BUSINESS_DIRECTION_REQUESTS') +
      t('BUSINESS_BOOKINGS') +
      t('BUSINESS_CONVERSATIONS') +
      t('BUSINESS_FOOD_ORDERS'),
  };

  const daily: GbpDailyPoint[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, r]) => {
      const g = (k: string) => r[k] ?? 0;
      const dayMaps = g('BUSINESS_IMPRESSIONS_DESKTOP_MAPS') + g('BUSINESS_IMPRESSIONS_MOBILE_MAPS');
      const daySearch =
        g('BUSINESS_IMPRESSIONS_DESKTOP_SEARCH') + g('BUSINESS_IMPRESSIONS_MOBILE_SEARCH');
      return {
        date,
        impressions: dayMaps + daySearch,
        mapImpressions: dayMaps,
        searchImpressions: daySearch,
        websiteClicks: g('WEBSITE_CLICKS'),
        callClicks: g('CALL_CLICKS'),
        directionRequests: g('BUSINESS_DIRECTION_REQUESTS'),
      };
    });

  return {
    summary,
    daily,
    devices: [
      { label: 'Mobile', value: mobileImpressions },
      { label: 'Desktop', value: desktopImpressions },
    ],
    platforms: [
      { label: 'Search', value: searchImpressions },
      { label: 'Maps', value: mapImpressions },
    ],
  };
}
