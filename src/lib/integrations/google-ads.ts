/**
 * Google Ads reporting client — GAQL over the REST searchStream endpoint.
 *
 * Port of Oz Dealer Tools' GoogleAds library. Read-only reporting per customer:
 * the nine GAQL queries are copied near-verbatim from the PHP; we hit Google's
 * REST API (same GAQL, no gRPC dependency) with an OAuth refresh-token → access-
 * token exchange. Money fields come back in micros (÷ 1,000,000) and CTR/share
 * as fractions (× 100), handled here as the PHP did. Margin markup lives in
 * src/lib/reporting/margins.ts (cost / avg_cpc / cost_per_conversion).
 *
 * Credentials are agency-wide in env (developer token + OAuth client + refresh
 * token, optional MCC login-customer-id). Each sub-account stores only its
 * customer id (Account.googleAdsCustomerId).
 */

import { prisma } from '@/lib/prisma';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ADS_BASE = 'https://googleads.googleapis.com';

export interface GoogleAdsConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** MCC/manager account id (digits), or null for direct accounts. */
  loginCustomerId: string | null;
  apiVersion: string;
}

/** Reads the agency Google Ads credentials from env. null when incomplete. */
export function getGoogleAdsConfig(): GoogleAdsConfig | null {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim();
  if (!developerToken || !clientId || !clientSecret || !refreshToken) return null;
  return {
    developerToken,
    clientId,
    clientSecret,
    refreshToken,
    loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, '').trim() || null,
    apiVersion: process.env.GOOGLE_ADS_API_VERSION?.trim() || 'v20',
  };
}

export function isGoogleAdsConfigured(): boolean {
  return getGoogleAdsConfig() !== null;
}

export type GoogleAdsErrorCode = 'not_configured' | 'no_customer' | 'api_error';

export class GoogleAdsError extends Error {
  code: GoogleAdsErrorCode;
  httpStatus?: number;
  constructor(message: string, code: GoogleAdsErrorCode, httpStatus?: number) {
    super(message);
    this.name = 'GoogleAdsError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// ── OAuth (refresh token → access token, cached in-memory) ──

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(cfg: GoogleAdsConfig): Promise<string> {
  // 60s safety margin so we never use a token about to expire mid-request.
  if (tokenCache && tokenCache.expiresAt - 60_000 > nowMs()) return tokenCache.token;

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: cfg.refreshToken,
    grant_type: 'refresh_token',
  });
  let res: Response;
  try {
    res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    });
  } catch (err) {
    throw new GoogleAdsError(
      `Could not reach Google OAuth: ${err instanceof Error ? err.message : 'network error'}`,
      'api_error',
    );
  }
  const json = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error_description?: string } | null;
  if (!res.ok || !json?.access_token) {
    throw new GoogleAdsError(
      `Google OAuth failed: ${json?.error_description || `HTTP ${res.status}`}`,
      'api_error',
      res.status,
    );
  }
  tokenCache = { token: json.access_token, expiresAt: nowMs() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

/** Date.now() isolated so the rest of the module stays pure/testable. */
function nowMs(): number {
  return Date.now();
}

// ── GAQL search ──

const stripDashes = (id: string) => id.replace(/-/g, '');

interface SearchStreamBatch {
  results?: GoogleRow[];
}

/** Run a GAQL query against a customer via searchStream; returns all rows. */
export async function gaql(cfg: GoogleAdsConfig, customerId: string, query: string): Promise<GoogleRow[]> {
  const token = await getAccessToken(cfg);
  const cid = stripDashes(customerId);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'developer-token': cfg.developerToken,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (cfg.loginCustomerId) headers['login-customer-id'] = cfg.loginCustomerId;

  let res: Response;
  try {
    res = await fetch(`${ADS_BASE}/${cfg.apiVersion}/customers/${cid}/googleAds:searchStream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    });
  } catch (err) {
    throw new GoogleAdsError(
      `Could not reach the Google Ads API: ${err instanceof Error ? err.message : 'network error'}`,
      'api_error',
    );
  }

  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    // searchStream errors come back as either { error: {...} } or [{ error: {...} }].
    // The human-readable reason is usually buried in error.details[].errors[].message
    // (Google Ads' specific failure), with error.message as the generic fallback.
    type GAdsError = {
      message?: string;
      details?: Array<{ errors?: Array<{ message?: string }> }>;
    };
    const container = Array.isArray(json)
      ? (json.find((b) => b && typeof b === 'object' && 'error' in b) as { error?: GAdsError } | undefined)
      : (json as { error?: GAdsError } | null);
    const errObj = container?.error;
    const detailMsg = errObj?.details?.[0]?.errors?.[0]?.message;
    const msg = detailMsg || errObj?.message || `HTTP ${res.status}`;
    // Log the raw payload so prod always has the full reason even if the shape shifts.
    // eslint-disable-next-line no-console
    console.error('[google-ads] GAQL error', res.status, JSON.stringify(json)?.slice(0, 1000));
    throw new GoogleAdsError(`Google Ads: ${msg}`, 'api_error', res.status);
  }
  // searchStream returns a JSON array of batches, each with `results`.
  const batches = (Array.isArray(json) ? json : []) as SearchStreamBatch[];
  return batches.flatMap((b) => b.results ?? []);
}

// ── Row shapes (proto JSON: int64 fields arrive as strings, enums as names) ──

interface GoogleMetrics {
  impressions?: string;
  clicks?: string;
  ctr?: number;
  averageCpc?: string;
  costMicros?: string;
  conversions?: number;
  conversionsValue?: number;
  costPerConversion?: string;
  allConversions?: number;
  allConversionsValue?: number;
  searchImpressionShare?: number;
  searchTopImpressionShare?: number;
  searchAbsoluteTopImpressionShare?: number;
  searchBudgetLostImpressionShare?: number;
  searchRankLostImpressionShare?: number;
}
interface GoogleRow {
  // §8 pacer import also reads advertisingChannelType + start/end dates and the
  // budget's total_amount_micros + resource_name (shared-budget dedup).
  campaign?: {
    id?: string;
    name?: string;
    status?: string;
    advertisingChannelType?: string;
    startDate?: string;
    endDate?: string;
  };
  campaignBudget?: { amountMicros?: string; totalAmountMicros?: string; resourceName?: string };
  adGroup?: { id?: string; name?: string; status?: string; type?: string };
  adGroupCriterion?: {
    keyword?: { text?: string; matchType?: string };
    qualityInfo?: { qualityScore?: number };
    status?: string;
  };
  searchTermView?: { searchTerm?: string };
  geographicView?: { locationType?: string; countryCriterionId?: string };
  geoTargetConstant?: { resourceName?: string; name?: string };
  conversionAction?: { resourceName?: string; type?: string; category?: string };
  segments?: {
    date?: string;
    device?: string;
    conversionAction?: string;
    conversionActionCategory?: string;
    geoTargetCity?: string;
    geoTargetRegion?: string;
    geoTargetMetro?: string;
  };
  metrics?: GoogleMetrics;
}

// ── Conversions / numeric helpers (exported for unit tests) ──

const intOf = (v: string | number | undefined) => Math.trunc(Number(v ?? 0)) || 0;
const floatOf = (v: string | number | undefined) => Number(v ?? 0) || 0;
/** Micros → currency units. Google money fields are in millionths. */
export const microsToUnits = (v: string | number | undefined) => floatOf(v) / 1_000_000;

const DEVICE_LABELS: Record<string, string> = {
  UNSPECIFIED: 'Unspecified',
  UNKNOWN: 'Unknown',
  MOBILE: 'Mobile',
  TABLET: 'Tablet',
  DESKTOP: 'Desktop',
  CONNECTED_TV: 'Connected TV',
  OTHER: 'Other',
};

const MATCH_TYPE_LABELS: Record<string, string> = {
  EXACT: 'Exact',
  PHRASE: 'Phrase',
  BROAD: 'Broad',
};

/** Conversion-action TYPE enum names that mean "offline upload" (Oz parity). */
const OFFLINE_UPLOAD_TYPES = new Set(['UPLOAD_CALLS', 'UPLOAD_CLICKS', 'SALESFORCE']);
/** Category enum names that mean a lead event. */
const LEAD_CATEGORIES = new Set([
  'LEAD',
  'PHONE_CALL_LEAD',
  'IMPORTED_LEAD',
  'SUBMIT_LEAD_FORM',
  'BOOK_APPOINTMENT',
  'REQUEST_QUOTE',
  'QUALIFIED_LEAD',
]);
/** Category enum names that mean a purchase (incl. CONVERTED_LEAD). */
const PURCHASE_CATEGORIES = new Set(['PURCHASE', 'STORE_SALE', 'CONVERTED_LEAD']);

/**
 * Classify a conversion action (type + category enum names) into an offline
 * bucket, or null when it isn't an offline upload / doesn't map cleanly.
 * Port of GoogleAds::classifyOfflineConversion (enum-name form for REST).
 */
export function classifyOfflineConversion(
  type: string | undefined,
  category: string | undefined,
): 'offline_lead' | 'offline_purchase' | null {
  if (!type || !OFFLINE_UPLOAD_TYPES.has(type)) return null;
  if (category && PURCHASE_CATEGORIES.has(category)) return 'offline_purchase';
  if (category && LEAD_CATEGORIES.has(category)) return 'offline_lead';
  return null;
}

export interface OfflineTotals {
  offline_leads: number;
  offline_purchases: number;
  offline_purchase_value: number;
}

// ── Report metric shapes ──

export interface GoogleMetricsRow extends OfflineTotals {
  impressions: number;
  clicks: number;
  ctr: number;
  avg_cpc: number;
  cost: number;
  conversions: number;
  conversion_value: number;
  cost_per_conversion: number;
}
export interface GoogleCampaignRow extends GoogleMetricsRow {
  id: string;
  name: string;
  status: string;
  daily_budget: number;
}
export interface GoogleDeviceRow {
  device: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cost: number;
  conversions: number;
}
export interface GoogleDailyRow {
  date: string;
  label: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
}
export interface GoogleSearchTermRow {
  term: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cost: number;
  conversions: number;
}
export interface GoogleKeywordRow {
  keyword: string;
  match_type: string;
  quality_score: number | null;
  campaign: string;
  ad_group: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avg_cpc: number;
  cost: number;
  conversions: number;
  cost_per_conversion: number;
}
export interface GoogleLocationRow {
  city: string;
  region: string;
  location_type: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cost: number;
  conversions: number;
}
export interface GoogleAuctionRow {
  campaign_id: string;
  campaign_name: string;
  impression_share: number | null;
  top_impression_share: number | null;
  abs_top_impression_share: number | null;
  budget_lost_is: number | null;
  rank_lost_is: number | null;
  impressions: number;
  clicks: number;
  cost: number;
}
export interface GoogleAdGroupRow {
  id: string;
  name: string;
  status: string;
  type: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avg_cpc: number;
  cost: number;
  conversions: number;
  cost_per_conversion: number;
}

const EMPTY_OFFLINE: OfflineTotals = { offline_leads: 0, offline_purchases: 0, offline_purchase_value: 0 };

export const EMPTY_GOOGLE_METRICS: GoogleMetricsRow = {
  impressions: 0,
  clicks: 0,
  ctr: 0,
  avg_cpc: 0,
  cost: 0,
  conversions: 0,
  conversion_value: 0,
  cost_per_conversion: 0,
  ...EMPTY_OFFLINE,
};

const pct = (v: number | undefined) => (v != null ? v * 100 : null);

/** Resolves the agency creds + this account's Google customer id for queries. */
export async function getGoogleCustomer(
  accountKey: string,
): Promise<{ cfg: GoogleAdsConfig; customerId: string }> {
  const cfg = getGoogleAdsConfig();
  if (!cfg) {
    throw new GoogleAdsError(
      'Google Ads is not connected (set GOOGLE_ADS_DEVELOPER_TOKEN + OAuth env).',
      'not_configured',
    );
  }
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { googleAdsCustomerId: true },
  });
  const customerId = account?.googleAdsCustomerId?.trim();
  if (!customerId) {
    throw new GoogleAdsError(
      "No Google Ads customer is linked. Add it in the account's settings.",
      'no_customer',
    );
  }
  return { cfg, customerId };
}

// ════════════════════════════════════════════════════════════════════
//  The nine reporting queries (+ ad-group drilldown), ported from Oz.
// ════════════════════════════════════════════════════════════════════

/** Account-level totals (FROM customer) + offline-conversion enrichment. */
export async function getAccountMetrics(
  cfg: GoogleAdsConfig,
  customerId: string,
  startDate: string,
  endDate: string,
): Promise<GoogleMetricsRow> {
  const rows = await gaql(
    cfg,
    customerId,
    `SELECT metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc,
            metrics.cost_micros, metrics.conversions, metrics.conversions_value,
            metrics.cost_per_conversion
     FROM customer
     WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
  );
  const m = rows[0]?.metrics;
  if (!m) return { ...EMPTY_GOOGLE_METRICS };
  const offline = await getOfflineConversionTotals(cfg, customerId, startDate, endDate).catch(() => ({ ...EMPTY_OFFLINE }));
  return {
    impressions: intOf(m.impressions),
    clicks: intOf(m.clicks),
    ctr: floatOf(m.ctr) * 100,
    avg_cpc: microsToUnits(m.averageCpc),
    cost: microsToUnits(m.costMicros),
    conversions: floatOf(m.conversions),
    conversion_value: floatOf(m.conversionsValue),
    cost_per_conversion: m.costPerConversion != null ? microsToUnits(m.costPerConversion) : 0,
    ...offline,
  };
}

/** Per-campaign performance (FROM campaign), with batched offline breakdown. */
export async function getCampaignPerformance(
  cfg: GoogleAdsConfig,
  customerId: string,
  startDate: string,
  endDate: string,
): Promise<GoogleCampaignRow[]> {
  const rows = await gaql(
    cfg,
    customerId,
    `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros,
            metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc,
            metrics.cost_micros, metrics.conversions, metrics.conversions_value,
            metrics.cost_per_conversion
     FROM campaign
     WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
       AND campaign.status != 'REMOVED'
     ORDER BY metrics.impressions DESC`,
  );
  const campaigns: GoogleCampaignRow[] = rows.map((r) => {
    const m = r.metrics ?? {};
    return {
      id: String(r.campaign?.id ?? ''),
      name: r.campaign?.name ?? 'Unknown',
      status: r.campaign?.status ?? '',
      daily_budget: microsToUnits(r.campaignBudget?.amountMicros),
      impressions: intOf(m.impressions),
      clicks: intOf(m.clicks),
      ctr: floatOf(m.ctr) * 100,
      avg_cpc: microsToUnits(m.averageCpc),
      cost: microsToUnits(m.costMicros),
      conversions: floatOf(m.conversions),
      conversion_value: floatOf(m.conversionsValue),
      cost_per_conversion: m.costPerConversion != null ? microsToUnits(m.costPerConversion) : 0,
      ...EMPTY_OFFLINE,
    };
  });

  // Join in offline conversion breakdown per campaign (best-effort).
  const byCampaign = await getOfflineConversionTotalsByCampaign(cfg, customerId, startDate, endDate).catch(
    () => new Map<string, OfflineTotals>(),
  );
  for (const c of campaigns) {
    const o = byCampaign.get(c.id);
    if (o) {
      c.offline_leads = o.offline_leads;
      c.offline_purchases = o.offline_purchases;
      c.offline_purchase_value = o.offline_purchase_value;
    }
  }
  return campaigns;
}

/** Device breakdown (FROM customer, segments.device). */
export async function getDevicePerformance(
  cfg: GoogleAdsConfig,
  customerId: string,
  startDate: string,
  endDate: string,
): Promise<GoogleDeviceRow[]> {
  const rows = await gaql(
    cfg,
    customerId,
    `SELECT segments.device, metrics.impressions, metrics.clicks, metrics.ctr,
            metrics.cost_micros, metrics.conversions
     FROM customer
     WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
  );
  return rows.map((r) => {
    const m = r.metrics ?? {};
    return {
      device: DEVICE_LABELS[r.segments?.device ?? ''] ?? 'Unknown',
      impressions: intOf(m.impressions),
      clicks: intOf(m.clicks),
      ctr: floatOf(m.ctr) * 100,
      cost: microsToUnits(m.costMicros),
      conversions: floatOf(m.conversions),
    };
  });
}

/** Daily trend (FROM customer, segments.date). */
export async function getDailyPerformance(
  cfg: GoogleAdsConfig,
  customerId: string,
  startDate: string,
  endDate: string,
): Promise<GoogleDailyRow[]> {
  const rows = await gaql(
    cfg,
    customerId,
    `SELECT segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
     FROM customer
     WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
     ORDER BY segments.date ASC`,
  );
  return rows.map((r) => {
    const m = r.metrics ?? {};
    const date = r.segments?.date ?? '';
    return {
      date,
      label: date
        ? new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' })
        : '',
      impressions: intOf(m.impressions),
      clicks: intOf(m.clicks),
      cost: microsToUnits(m.costMicros),
      conversions: floatOf(m.conversions),
    };
  });
}

/** Top search terms by clicks (FROM search_term_view). */
export async function getTopSearchTerms(
  cfg: GoogleAdsConfig,
  customerId: string,
  startDate: string,
  endDate: string,
  limit = 20,
): Promise<GoogleSearchTermRow[]> {
  const rows = await gaql(
    cfg,
    customerId,
    `SELECT search_term_view.search_term, metrics.impressions, metrics.clicks,
            metrics.ctr, metrics.cost_micros, metrics.conversions
     FROM search_term_view
     WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
     ORDER BY metrics.clicks DESC
     LIMIT ${limit}`,
  );
  return rows.map((r) => {
    const m = r.metrics ?? {};
    return {
      term: r.searchTermView?.searchTerm ?? '',
      impressions: intOf(m.impressions),
      clicks: intOf(m.clicks),
      ctr: floatOf(m.ctr) * 100,
      cost: microsToUnits(m.costMicros),
      conversions: floatOf(m.conversions),
    };
  });
}

/** Keyword performance (FROM keyword_view). */
export async function getKeywordPerformance(
  cfg: GoogleAdsConfig,
  customerId: string,
  startDate: string,
  endDate: string,
  limit = 50,
): Promise<GoogleKeywordRow[]> {
  const rows = await gaql(
    cfg,
    customerId,
    `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
            ad_group_criterion.quality_info.quality_score, ad_group.name, campaign.name,
            ad_group_criterion.status, metrics.impressions, metrics.clicks, metrics.ctr,
            metrics.average_cpc, metrics.cost_micros, metrics.conversions, metrics.cost_per_conversion
     FROM keyword_view
     WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
       AND campaign.status != 'REMOVED' AND ad_group.status != 'REMOVED'
     ORDER BY metrics.impressions DESC
     LIMIT ${limit}`,
  );
  return rows.map((r) => {
    const m = r.metrics ?? {};
    const kw = r.adGroupCriterion?.keyword;
    return {
      keyword: kw?.text ?? '',
      match_type: MATCH_TYPE_LABELS[kw?.matchType ?? ''] ?? 'Unknown',
      quality_score: r.adGroupCriterion?.qualityInfo?.qualityScore ?? null,
      campaign: r.campaign?.name ?? '',
      ad_group: r.adGroup?.name ?? '',
      impressions: intOf(m.impressions),
      clicks: intOf(m.clicks),
      ctr: floatOf(m.ctr) * 100,
      avg_cpc: microsToUnits(m.averageCpc),
      cost: microsToUnits(m.costMicros),
      conversions: floatOf(m.conversions),
      cost_per_conversion: m.costPerConversion != null ? microsToUnits(m.costPerConversion) : 0,
    };
  });
}

/** Location performance (FROM geographic_view) with geo-name resolution. */
export async function getLocationPerformance(
  cfg: GoogleAdsConfig,
  customerId: string,
  startDate: string,
  endDate: string,
  limit = 30,
): Promise<GoogleLocationRow[]> {
  const LOCATION_TYPES: Record<string, string> = {
    LOCATION_OF_PRESENCE: 'Location of Presence',
    AREA_OF_INTEREST: 'Area of Interest',
  };
  const rows = await gaql(
    cfg,
    customerId,
    `SELECT geographic_view.country_criterion_id, geographic_view.location_type,
            segments.geo_target_city, segments.geo_target_region, segments.geo_target_metro,
            metrics.impressions, metrics.clicks, metrics.ctr, metrics.cost_micros, metrics.conversions
     FROM geographic_view
     WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
     ORDER BY metrics.clicks DESC
     LIMIT ${limit}`,
  );

  const resourceNames = new Set<string>();
  for (const r of rows) {
    if (r.segments?.geoTargetCity) resourceNames.add(r.segments.geoTargetCity);
    if (r.segments?.geoTargetRegion) resourceNames.add(r.segments.geoTargetRegion);
  }
  const names = await resolveGeoTargetNames(cfg, customerId, [...resourceNames]).catch(
    () => new Map<string, string>(),
  );
  const geoId = (rn: string | undefined) => (rn ? rn.split('/').pop() || '—' : '—');

  return rows.map((r) => {
    const m = r.metrics ?? {};
    const city = r.segments?.geoTargetCity;
    const region = r.segments?.geoTargetRegion;
    return {
      city: (city && names.get(city)) || geoId(city),
      region: (region && names.get(region)) || geoId(region),
      location_type: LOCATION_TYPES[r.geographicView?.locationType ?? ''] ?? 'Unknown',
      impressions: intOf(m.impressions),
      clicks: intOf(m.clicks),
      ctr: floatOf(m.ctr) * 100,
      cost: microsToUnits(m.costMicros),
      conversions: floatOf(m.conversions),
    };
  });
}

/** Resolve geoTargetConstants/* resource names → human names (best-effort). */
async function resolveGeoTargetNames(
  cfg: GoogleAdsConfig,
  customerId: string,
  resourceNames: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const clean = resourceNames.filter(Boolean);
  if (clean.length === 0) return names;
  const inClause = clean.map((r) => r.replace(/'/g, "")).join("', '");
  const rows = await gaql(
    cfg,
    customerId,
    `SELECT geo_target_constant.resource_name, geo_target_constant.name
     FROM geo_target_constant
     WHERE geo_target_constant.resource_name IN ('${inClause}')`,
  );
  for (const r of rows) {
    const rn = r.geoTargetConstant?.resourceName;
    if (rn) names.set(rn, r.geoTargetConstant?.name ?? rn);
  }
  return names;
}

/** Campaign-level impression-share / competitive metrics (auction insights). */
export async function getAuctionInsights(
  cfg: GoogleAdsConfig,
  customerId: string,
  startDate: string,
  endDate: string,
): Promise<GoogleAuctionRow[]> {
  const rows = await gaql(
    cfg,
    customerId,
    `SELECT campaign.id, campaign.name, metrics.search_impression_share,
            metrics.search_top_impression_share, metrics.search_absolute_top_impression_share,
            metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share,
            metrics.impressions, metrics.clicks, metrics.cost_micros
     FROM campaign
     WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
       AND campaign.status = 'ENABLED' AND metrics.impressions > 0
     ORDER BY metrics.impressions DESC`,
  );
  return rows.map((r) => {
    const m = r.metrics ?? {};
    return {
      campaign_id: String(r.campaign?.id ?? ''),
      campaign_name: r.campaign?.name ?? '',
      impression_share: pct(m.searchImpressionShare),
      top_impression_share: pct(m.searchTopImpressionShare),
      abs_top_impression_share: pct(m.searchAbsoluteTopImpressionShare),
      budget_lost_is: pct(m.searchBudgetLostImpressionShare),
      rank_lost_is: pct(m.searchRankLostImpressionShare),
      impressions: intOf(m.impressions),
      clicks: intOf(m.clicks),
      cost: microsToUnits(m.costMicros),
    };
  });
}

const AD_GROUP_TYPES: Record<string, string> = {
  SEARCH_STANDARD: 'Search Standard',
  DISPLAY_STANDARD: 'Display Standard',
  SHOPPING_PRODUCT_ADS: 'Shopping Product Ads',
  HOTEL_ADS: 'Hotel Ads',
  SHOPPING_SMART_ADS: 'Shopping Smart Ads',
  VIDEO_BUMPER: 'Video Bumper',
  VIDEO_TRUE_VIEW_IN_STREAM: 'Video TrueView In-Stream',
  VIDEO_TRUE_VIEW_IN_DISPLAY: 'Video TrueView In-Display',
  VIDEO_NON_SKIPPABLE_IN_STREAM: 'Video Non-Skippable In-Stream',
  VIDEO_OUTSTREAM: 'Video Outstream',
  SEARCH_DYNAMIC_ADS: 'Search Dynamic Ads',
  VIDEO_RESPONSIVE: 'Video Responsive',
  VIDEO_EFFICIENT_REACH: 'Video Efficient Reach',
  SMART_CAMPAIGN_ADS: 'Smart Campaign Ads',
  TRAVEL_ADS: 'Travel Ads',
};

/** Ad-group drilldown for one campaign (FROM ad_group). */
export async function getAdGroupPerformance(
  cfg: GoogleAdsConfig,
  customerId: string,
  campaignId: string,
  startDate: string,
  endDate: string,
): Promise<GoogleAdGroupRow[]> {
  const safeCampaignId = stripDashes(String(campaignId)).replace(/\D/g, '');
  const rows = await gaql(
    cfg,
    customerId,
    `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type,
            metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc,
            metrics.cost_micros, metrics.conversions, metrics.cost_per_conversion
     FROM ad_group
     WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
       AND campaign.id = ${safeCampaignId}
       AND ad_group.status != 'REMOVED'
     ORDER BY metrics.impressions DESC`,
  );
  return rows.map((r) => {
    const m = r.metrics ?? {};
    return {
      id: String(r.adGroup?.id ?? ''),
      name: r.adGroup?.name ?? '',
      status: r.adGroup?.status ?? '',
      type: AD_GROUP_TYPES[r.adGroup?.type ?? ''] ?? 'Other',
      impressions: intOf(m.impressions),
      clicks: intOf(m.clicks),
      ctr: floatOf(m.ctr) * 100,
      avg_cpc: microsToUnits(m.averageCpc),
      cost: microsToUnits(m.costMicros),
      conversions: floatOf(m.conversions),
      cost_per_conversion: m.costPerConversion != null ? microsToUnits(m.costPerConversion) : 0,
    };
  });
}

// ── Offline conversion enrichment ──

/** Account-wide offline totals (FROM conversion_action — type+category direct). */
export async function getOfflineConversionTotals(
  cfg: GoogleAdsConfig,
  customerId: string,
  startDate: string,
  endDate: string,
): Promise<OfflineTotals> {
  const rows = await gaql(
    cfg,
    customerId,
    `SELECT conversion_action.type, conversion_action.category,
            metrics.all_conversions, metrics.all_conversions_value
     FROM conversion_action
     WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
       AND conversion_action.status != 'REMOVED'`,
  );
  let leads = 0;
  let purchases = 0;
  let purchaseValue = 0;
  for (const r of rows) {
    const bucket = classifyOfflineConversion(r.conversionAction?.type, r.conversionAction?.category);
    const count = floatOf(r.metrics?.allConversions);
    const value = floatOf(r.metrics?.allConversionsValue);
    if (bucket === 'offline_lead') leads += count;
    else if (bucket === 'offline_purchase') {
      purchases += count;
      purchaseValue += value;
    }
  }
  return {
    offline_leads: Math.round(leads),
    offline_purchases: Math.round(purchases),
    offline_purchase_value: purchaseValue,
  };
}

/** Per-campaign offline totals (FROM campaign, joined to a type map). */
export async function getOfflineConversionTotalsByCampaign(
  cfg: GoogleAdsConfig,
  customerId: string,
  startDate: string,
  endDate: string,
): Promise<Map<string, OfflineTotals>> {
  const typeMap = await getConversionActionTypeMap(cfg, customerId);
  const rows = await gaql(
    cfg,
    customerId,
    `SELECT campaign.id, segments.conversion_action, segments.conversion_action_category,
            metrics.all_conversions, metrics.all_conversions_value
     FROM campaign
     WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
       AND campaign.status != 'REMOVED'`,
  );
  const byCampaign = new Map<string, OfflineTotals>();
  for (const r of rows) {
    const campaignId = String(r.campaign?.id ?? '');
    const type = typeMap.get(r.segments?.conversionAction ?? '');
    const bucket = classifyOfflineConversion(type, r.segments?.conversionActionCategory);
    if (!bucket || !campaignId) continue;
    const count = floatOf(r.metrics?.allConversions);
    const value = floatOf(r.metrics?.allConversionsValue);
    const totals = byCampaign.get(campaignId) ?? { ...EMPTY_OFFLINE };
    if (bucket === 'offline_lead') totals.offline_leads += count;
    else {
      totals.offline_purchases += count;
      totals.offline_purchase_value += value;
    }
    byCampaign.set(campaignId, totals);
  }
  for (const t of byCampaign.values()) {
    t.offline_leads = Math.round(t.offline_leads);
    t.offline_purchases = Math.round(t.offline_purchases);
  }
  return byCampaign;
}

/** conversion_action resource_name → type enum-name map (for the campaign join). */
async function getConversionActionTypeMap(
  cfg: GoogleAdsConfig,
  customerId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const rows = await gaql(
      cfg,
      customerId,
      `SELECT conversion_action.resource_name, conversion_action.type
       FROM conversion_action
       WHERE conversion_action.status != 'REMOVED'`,
    );
    for (const r of rows) {
      const rn = r.conversionAction?.resourceName;
      if (rn) map.set(rn, r.conversionAction?.type ?? '');
    }
  } catch {
    // best-effort — empty map means no per-campaign offline split
  }
  return map;
}
