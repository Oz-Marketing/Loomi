/**
 * GA4 (Google Analytics Data API v1beta) reporting client.
 *
 * Port of Oz Dealer Tools' GoogleAnalytics library. Read-only website analytics
 * per GA4 property. We hit the Data API REST endpoint
 * (`properties/{id}:runReport`) with a service-account JWT → access-token
 * exchange (Node `crypto`, no Google SDK dependency). The metric/dimension
 * choices are copied one-for-one from the PHP.
 *
 * Credentials are agency-wide in env: one service account granted read access to
 * every client GA4 property (`GA4_SERVICE_ACCOUNT_JSON`). Each sub-account maps
 * to its GA4 property id. For now that mapping lives in env (`GA4_PROPERTY_MAP`,
 * see `resolveGa4Property`); it moves to `Account.ga4PropertyId` once the
 * migrate-deploy baseline lands (mirrors how google-ads stores
 * `Account.googleAdsCustomerId`).
 */

import crypto from 'node:crypto';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DATA_BASE = 'https://analyticsdata.googleapis.com/v1beta';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

export interface Ga4Config {
  clientEmail: string;
  /** PKCS#8 PEM private key from the service-account JSON. */
  privateKey: string;
}

/**
 * Reads the agency GA4 service account from env. Accepts the raw JSON string or
 * a base64-encoded blob (env-safe for the multiline private key). `null` when
 * absent or malformed.
 */
export function getGa4Config(): Ga4Config | null {
  const raw = process.env.GA4_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  let parsed: { client_email?: string; private_key?: string };
  try {
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const clientEmail = parsed.client_email?.trim();
  // Tolerate keys stored with literal "\n" escapes (common in CI/secret stores).
  const privateKey =
    typeof parsed.private_key === 'string' ? parsed.private_key.replace(/\\n/g, '\n') : undefined;
  if (!clientEmail || !privateKey) return null;
  return { clientEmail, privateKey };
}

export function isGa4Configured(): boolean {
  return getGa4Config() !== null;
}

/**
 * Resolve a sub-account key → GA4 numeric property id. v1 reads a JSON map from
 * `GA4_PROPERTY_MAP` (`{"dealerKey":"123456789"}`). Returns digits only, or
 * `null` when unmapped. Swap this one body for `Account.ga4PropertyId` post
 * migrate-deploy cutover.
 */
export function resolveGa4Property(accountKey: string): string | null {
  const raw = process.env.GA4_PROPERTY_MAP?.trim();
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, string | number>;
    const value = map[accountKey];
    if (value == null) return null;
    const digits = String(value).replace(/[^0-9]/g, '');
    return digits || null;
  } catch {
    return null;
  }
}

export type Ga4ErrorCode = 'not_configured' | 'no_property' | 'api_error';

export class Ga4Error extends Error {
  code: Ga4ErrorCode;
  httpStatus?: number;
  constructor(message: string, code: Ga4ErrorCode, httpStatus?: number) {
    super(message);
    this.name = 'Ga4Error';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// ── Service-account auth (JWT → access token, cached in-memory) ──

let tokenCache: { token: string; expiresAt: number } | null = null;

/** Date.now() isolated so the rest of the module stays pure/testable. */
function nowMs(): number {
  return Date.now();
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getAccessToken(cfg: Ga4Config): Promise<string> {
  // 60s safety margin so we never use a token about to expire mid-request.
  if (tokenCache && tokenCache.expiresAt - 60_000 > nowMs()) return tokenCache.token;

  const iat = Math.floor(nowMs() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(
    JSON.stringify({ iss: cfg.clientEmail, scope: SCOPE, aud: OAUTH_TOKEN_URL, iat, exp: iat + 3600 }),
  );
  const signingInput = `${header}.${claim}`;
  let assertion: string;
  try {
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingInput);
    assertion = `${signingInput}.${base64url(signer.sign(cfg.privateKey))}`;
  } catch (err) {
    throw new Ga4Error(
      `Could not sign the GA4 service-account JWT: ${err instanceof Error ? err.message : 'crypto error'}`,
      'api_error',
    );
  }

  let res: Response;
  try {
    res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
  } catch (err) {
    throw new Ga4Error(
      `Could not reach Google OAuth: ${err instanceof Error ? err.message : 'network error'}`,
      'api_error',
    );
  }
  const json = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; error_description?: string }
    | null;
  if (!res.ok || !json?.access_token) {
    throw new Ga4Error(
      `Google OAuth failed: ${json?.error_description || `HTTP ${res.status}`}`,
      'api_error',
      res.status,
    );
  }
  tokenCache = { token: json.access_token, expiresAt: nowMs() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

// ── runReport ──

interface RunReportBody {
  dateRanges: { startDate: string; endDate: string }[];
  dimensions?: { name: string }[];
  metrics: { name: string }[];
  orderBys?: Record<string, unknown>[];
  limit?: number;
}
interface Ga4Row {
  dimensionValues?: { value: string }[];
  metricValues?: { value: string }[];
}
interface RunReportResponse {
  rows?: Ga4Row[];
  error?: { message?: string };
}

/** POST a runReport request against a property; returns its rows (possibly empty). */
async function runReport(cfg: Ga4Config, propertyId: string, body: RunReportBody): Promise<Ga4Row[]> {
  const token = await getAccessToken(cfg);
  const pid = propertyId.replace(/[^0-9]/g, '');
  let res: Response;
  try {
    res = await fetch(`${DATA_BASE}/properties/${pid}:runReport`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Ga4Error(
      `Could not reach the GA4 Data API: ${err instanceof Error ? err.message : 'network error'}`,
      'api_error',
    );
  }
  const json = (await res.json().catch(() => null)) as RunReportResponse | null;
  if (!res.ok) {
    throw new Ga4Error(`GA4: ${json?.error?.message || `HTTP ${res.status}`}`, 'api_error', res.status);
  }
  return json?.rows ?? [];
}

const metricInt = (row: Ga4Row | undefined, i: number): number => Number(row?.metricValues?.[i]?.value ?? 0);
const dimVal = (row: Ga4Row, i: number): string => row.dimensionValues?.[i]?.value ?? '';

// ── Reports (metrics/dimensions mirror GoogleAnalytics.php) ──

export interface Ga4Overview {
  sessions: number;
  totalUsers: number;
  newUsers: number;
  pageViews: number;
  /** Fraction 0..1 as GA4 returns it (multiply by 100 for display). */
  bounceRate: number;
  /** Seconds. */
  avgSessionDuration: number;
}

export async function getTrafficOverview(
  cfg: Ga4Config,
  propertyId: string,
  startDate: string,
  endDate: string,
): Promise<Ga4Overview> {
  const rows = await runReport(cfg, propertyId, {
    dateRanges: [{ startDate, endDate }],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'screenPageViews' },
      { name: 'bounceRate' },
      { name: 'averageSessionDuration' },
    ],
  });
  const row = rows[0];
  return {
    sessions: metricInt(row, 0),
    totalUsers: metricInt(row, 1),
    newUsers: metricInt(row, 2),
    pageViews: metricInt(row, 3),
    bounceRate: metricInt(row, 4),
    avgSessionDuration: metricInt(row, 5),
  };
}

export interface Ga4Source {
  channel: string;
  sessions: number;
  users: number;
}

export async function getTrafficSources(
  cfg: Ga4Config,
  propertyId: string,
  startDate: string,
  endDate: string,
): Promise<Ga4Source[]> {
  const rows = await runReport(cfg, propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
  });
  return rows.map((r) => ({
    channel: dimVal(r, 0) || '(unknown)',
    sessions: metricInt(r, 0),
    users: metricInt(r, 1),
  }));
}

export interface Ga4Page {
  title: string;
  path: string;
  views: number;
  /** Seconds. */
  avgTime: number;
}

export async function getTopPages(
  cfg: Ga4Config,
  propertyId: string,
  startDate: string,
  endDate: string,
  limit = 10,
): Promise<Ga4Page[]> {
  const rows = await runReport(cfg, propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'pageTitle' }, { name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'averageSessionDuration' }],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit,
  });
  return rows.map((r) => ({
    title: dimVal(r, 0),
    path: dimVal(r, 1),
    views: metricInt(r, 0),
    avgTime: metricInt(r, 1),
  }));
}

export interface Ga4TrendPoint {
  /** ISO YYYY-MM-DD (GA4 returns YYYYMMDD; normalised here). */
  date: string;
  sessions: number;
  users: number;
}

export async function getTrafficTrend(
  cfg: Ga4Config,
  propertyId: string,
  startDate: string,
  endDate: string,
): Promise<Ga4TrendPoint[]> {
  const rows = await runReport(cfg, propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
    orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
  });
  return rows.map((r) => {
    const raw = dimVal(r, 0);
    const date = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
    return { date, sessions: metricInt(r, 0), users: metricInt(r, 1) };
  });
}
