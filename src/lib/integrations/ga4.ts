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
import { VDP_PLATFORM_PATTERNS, DEFAULT_VDP_PLATFORM } from './ga4-platforms';

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
 * LEGACY env lookup: sub-account key → GA4 numeric property id, from the
 * `GA4_PROPERTY_MAP` JSON (`{"dealerKey":"123456789"}`). Digits only, `null`
 * when unmapped.
 *
 * The property now lives on `Account.ga4PropertyId`. Call
 * `resolveGa4Property()` in lib/integrations/account-mapping.ts instead — it
 * reads the column and falls back here. This stays only so environments that
 * have not run the backfill keep reporting, and goes away with the env var.
 */
export function resolveGa4PropertyFromEnv(accountKey: string): string | null {
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

// Moved to ga4-platforms.ts so client components (the Integrations card's
// platform dropdown) can read it without importing this module's `node:crypto`.
// Re-exported because server callers already import it from here.
export { VDP_PLATFORM_PATTERNS, DEFAULT_VDP_PLATFORM };

/**
 * LEGACY env lookup for the website-platform key (selects the VDP regex), from
 * `GA4_PLATFORM_MAP`. Defaults to `dealer_com` (the most common DDC platform)
 * when unmapped or unknown. Superseded by `Account.ga4Platform` — see
 * `resolveGa4PropertyFromEnv` above.
 */
export function resolveGa4PlatformFromEnv(accountKey: string): string {
  const raw = process.env.GA4_PLATFORM_MAP?.trim();
  if (!raw) return DEFAULT_VDP_PLATFORM;
  try {
    const map = JSON.parse(raw) as Record<string, string>;
    const v = map[accountKey];
    return v && VDP_PLATFORM_PATTERNS[v] ? v : DEFAULT_VDP_PLATFORM;
  } catch {
    return DEFAULT_VDP_PLATFORM;
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
  dimensionFilter?: Record<string, unknown>;
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

/**
 * Read a metric as a number. Despite the name this does NOT round — several
 * fractional metrics (bounce rate, average duration, key-event rate) come
 * through it, and truncating would zero every rate below 1. Prefer
 * `metricFloat` at those call sites; the two are deliberately identical, the
 * name is the documentation.
 */
const metricInt = (row: Ga4Row | undefined, i: number): number =>
  Number(row?.metricValues?.[i]?.value ?? 0);
/** Same read, named for the fractional metrics so intent is legible. */
const metricFloat = metricInt;
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
  /**
   * Key events — what GA4 renamed "conversions" to in 2024. Form submits,
   * click-to-call, VDP milestones: whatever the property has marked as one.
   *
   * Until this landed the website report could state no outcome at all, only
   * traffic — and had no number that tied back to the ad reports. A property
   * with nothing marked as a key event returns 0, which is honest: it means
   * nobody has told GA4 what counts as a result on that site.
   */
  keyEvents: number;
  /** Fraction 0..1 — share of sessions producing at least one key event. */
  keyEventRate: number;
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
      { name: 'keyEvents' },
      { name: 'sessionKeyEventRate' },
    ],
  });
  const row = rows[0];
  return {
    sessions: metricInt(row, 0),
    totalUsers: metricInt(row, 1),
    newUsers: metricInt(row, 2),
    pageViews: metricInt(row, 3),
    // bounceRate and the rate metrics are fractional — metricInt truncates, so
    // read them as floats or every rate below 100% reports as zero.
    bounceRate: metricFloat(row, 4),
    avgSessionDuration: metricFloat(row, 5),
    keyEvents: metricInt(row, 6),
    keyEventRate: metricFloat(row, 7),
  };
}

export interface Ga4Source {
  channel: string;
  sessions: number;
  users: number;
  keyEvents: number;
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
    metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'keyEvents' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
  });
  return rows.map((r) => ({
    channel: dimVal(r, 0) || '(unknown)',
    sessions: metricInt(r, 0),
    users: metricInt(r, 1),
    keyEvents: metricInt(r, 2),
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
    avgTime: metricFloat(r, 1),
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

export interface Ga4Device {
  device: string;
  sessions: number;
  users: number;
}

export async function getDeviceBreakdown(
  cfg: Ga4Config,
  propertyId: string,
  startDate: string,
  endDate: string,
): Promise<Ga4Device[]> {
  const rows = await runReport(cfg, propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'deviceCategory' }],
    metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
  });
  return rows.map((r) => ({
    device: dimVal(r, 0) || '(unknown)',
    sessions: metricInt(r, 0),
    users: metricInt(r, 1),
  }));
}

export interface Ga4SourceMedium {
  source: string;
  medium: string;
  sessions: number;
  users: number;
  newUsers: number;
  /** Fraction 0..1 (×100 for display). */
  bounceRate: number;
  /** Seconds. */
  avgDuration: number;
  pageViews: number;
}

export async function getSourceMedium(
  cfg: Ga4Config,
  propertyId: string,
  startDate: string,
  endDate: string,
  limit = 25,
): Promise<Ga4SourceMedium[]> {
  const rows = await runReport(cfg, propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'bounceRate' },
      { name: 'averageSessionDuration' },
      { name: 'screenPageViews' },
    ],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit,
  });
  return rows.map((r) => ({
    source: dimVal(r, 0) || '(direct)',
    medium: dimVal(r, 1) || '(none)',
    sessions: metricInt(r, 0),
    users: metricInt(r, 1),
    newUsers: metricInt(r, 2),
    bounceRate: metricFloat(r, 3),
    avgDuration: metricFloat(r, 4),
    pageViews: metricInt(r, 5),
  }));
}

export interface Ga4VdpPage {
  title: string;
  path: string;
  views: number;
  users: number;
  /** Seconds. */
  avgDuration: number;
}
export interface Ga4Vdp {
  totalViews: number;
  pages: Ga4VdpPage[];
}

/**
 * Top vehicle-detail pages. Filters `pagePath` by the platform's VDP regex
 * (PARTIAL_REGEXP) to count individual vehicle pages and exclude search/listing
 * pages. `customRegex` overrides the platform pattern when set.
 */
export async function getVdpViews(
  cfg: Ga4Config,
  propertyId: string,
  startDate: string,
  endDate: string,
  limit = 10,
  platform = 'dealer_com',
  customRegex = '',
): Promise<Ga4Vdp> {
  const regex = customRegex || VDP_PLATFORM_PATTERNS[platform] || VDP_PLATFORM_PATTERNS.dealer_com;
  const rows = await runReport(cfg, propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'pageTitle' }, { name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'totalUsers' }, { name: 'averageSessionDuration' }],
    dimensionFilter: {
      filter: {
        fieldName: 'pagePath',
        stringFilter: { matchType: 'PARTIAL_REGEXP', value: regex, caseSensitive: false },
      },
    },
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit,
  });
  let totalViews = 0;
  const pages = rows.map((r) => {
    const views = metricInt(r, 0);
    totalViews += views;
    return { title: dimVal(r, 0), path: dimVal(r, 1), views, users: metricInt(r, 1), avgDuration: metricFloat(r, 2) };
  });
  return { totalViews, pages };
}

// ── Admin API — property discovery ──

/** One GA4 property the service account can see. */
export interface Ga4PropertySummary {
  /** Numeric id, digits only — what `Account.ga4PropertyId` stores. */
  propertyId: string;
  /** Property display name, e.g. "Young Chevrolet - GA4". */
  displayName: string;
  /** Parent account display name, useful when property names collide. */
  accountName: string;
}

/**
 * Every GA4 property this service account has been granted access to.
 *
 * Admin API rather than the Data API, and read with the SAME credential and
 * scope (`analytics.readonly` covers both), so nothing new has to be
 * provisioned to use it.
 *
 * This is what makes mapping properties to sub-accounts a review step rather
 * than a hunt: the alternative is opening 38 GA4 properties by hand and copying
 * the id out of Admin → Property Settings.
 *
 * A property missing here means the service account was never granted access to
 * it — that is a Google-side permission to add, not a bug in the caller.
 */
export async function listGa4Properties(cfg: Ga4Config): Promise<Ga4PropertySummary[]> {
  const token = await getAccessToken(cfg);
  const out: Ga4PropertySummary[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL('https://analyticsadmin.googleapis.com/v1beta/accountSummaries');
    url.searchParams.set('pageSize', '200');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Ga4Error(
        `Admin API ${res.status}: ${(await res.text()).slice(0, 300)}`,
        'api_error',
        res.status,
      );
    }
    const body = (await res.json()) as {
      accountSummaries?: {
        displayName?: string;
        propertySummaries?: { property?: string; displayName?: string }[];
      }[];
      nextPageToken?: string;
    };

    for (const acct of body.accountSummaries ?? []) {
      for (const prop of acct.propertySummaries ?? []) {
        // `property` comes back as "properties/404123456".
        const id = (prop.property ?? '').replace(/[^0-9]/g, '');
        if (!id) continue;
        out.push({
          propertyId: id,
          displayName: prop.displayName ?? '(unnamed)',
          accountName: acct.displayName ?? '(unnamed account)',
        });
      }
    }
    pageToken = body.nextPageToken;
  } while (pageToken);

  return out;
}
