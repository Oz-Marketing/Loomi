/**
 * Facebook (Meta) Marketing API client + Ad Pacer spend sync.
 *
 * Phase 1 is read-only: we pull per-ad-set spend (and, when available,
 * daily/lifetime budget + delivery status) and write it onto the matching
 * MetaAdsPacerAd rows. We map at the ad-set level because that's where ABO
 * budgets live (campaigns hold CBO budgets; individual ads have none). A pacer
 * row "links" to an ad set either by a stored `metaObjectId` or, on first
 * sync, by an exact (case-insensitive) name match. Once linked, Facebook owns
 * that row's `pacerActual`.
 *
 * Credentials are a single agency-wide System User token in env
 * (META_SYSTEM_USER_TOKEN). Each sub-account stores only its ad-account id
 * (Account.metaAdAccountId, e.g. "act_123"). We never write to Facebook here.
 */

import { createHmac, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  zonedTodayIso,
} from '@/lib/timezone';
import {
  dailySpendSyncWindow,
  writeDailySpendSeries,
  type DailySpendWriteRow,
} from '@/lib/meta-ads-pacer';

const GRAPH_BASE = 'https://graph.facebook.com';

/** Pinned Graph API version; override with META_API_VERSION if needed. */
export function metaApiVersion(): string {
  return process.env.META_API_VERSION?.trim() || 'v21.0';
}

export interface MetaConfig {
  token: string;
  /** App secret enables appsecret_proof — strongly recommended, optional. */
  appSecret: string | null;
}

/** Reads the agency System User token from env. null when not configured. */
export function getMetaConfig(): MetaConfig | null {
  const token = process.env.META_SYSTEM_USER_TOKEN?.trim();
  if (!token) return null;
  return { token, appSecret: process.env.META_APP_SECRET?.trim() || null };
}

export function isMetaConfigured(): boolean {
  return getMetaConfig() !== null;
}

/** HMAC-SHA256 of the token keyed by the app secret (Meta's appsecret_proof). */
function appSecretProof(token: string, appSecret: string): string {
  return createHmac('sha256', appSecret).update(token).digest('hex');
}

export type MetaSyncErrorCode =
  | 'not_configured'
  | 'no_ad_account'
  | 'graph_error';

export class MetaSyncError extends Error {
  code: MetaSyncErrorCode;
  /** Underlying HTTP status from the Graph API, when relevant. */
  httpStatus?: number;
  constructor(message: string, code: MetaSyncErrorCode, httpStatus?: number) {
    super(message);
    this.name = 'MetaSyncError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; type?: string };
}

/**
 * Build the network-failure message for a MetaSyncError, with the agency token
 * scrubbed. The token rides in the request URL (GET) / body (POST), and some
 * undici fetch failures echo the full URL into `err.message` — which the
 * reporting routes return to the client verbatim (`{ error: err.message }`).
 * Strip `access_token` / `appsecret_proof` so a secret can never surface there.
 */
function graphNetworkError(err: unknown): string {
  const raw = err instanceof Error ? err.message : 'network error';
  const scrubbed = raw.replace(/(access_token|appsecret_proof)=[^&\s'")]+/gi, '$1=***');
  return `Could not reach the Facebook Graph API: ${scrubbed}`;
}

async function metaGraphFetch<T>(
  cfg: MetaConfig,
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const url = new URL(`${GRAPH_BASE}/${metaApiVersion()}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set('access_token', cfg.token);
  if (cfg.appSecret) {
    url.searchParams.set(
      'appsecret_proof',
      appSecretProof(cfg.token, cfg.appSecret),
    );
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new MetaSyncError(graphNetworkError(err), 'graph_error');
  }

  const json = (await res.json().catch(() => null)) as (T & GraphErrorBody) | null;
  if (!res.ok || (json && json.error)) {
    const msg = json?.error?.message || `Graph API HTTP ${res.status}`;
    throw new MetaSyncError(`Facebook: ${msg}`, 'graph_error', res.status);
  }
  return json as T;
}

interface Paged<T> {
  data?: T[];
  paging?: { next?: string; cursors?: { after?: string } };
}

/** Follows cursor paging to collect every row. Capped to avoid runaways. */
async function metaGraphFetchAll<T>(
  cfg: MetaConfig,
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  for (let i = 0; i < 50; i++) {
    const page = await metaGraphFetch<Paged<T>>(cfg, path, {
      ...params,
      limit: 200,
      after,
    });
    if (Array.isArray(page.data)) out.push(...page.data);
    after = page.paging?.cursors?.after;
    if (!after || !page.paging?.next) break;
  }
  return out;
}

/**
 * The one write path: POST to a Graph node (params form-encoded in the body,
 * token + appsecret_proof appended). Requires the token to carry
 * `ads_management` — a read-only `ads_read` token returns a permissions error
 * here, which we surface verbatim.
 */
async function metaGraphPost(
  cfg: MetaConfig,
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<void> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) body.set(key, String(value));
  }
  body.set('access_token', cfg.token);
  if (cfg.appSecret) {
    body.set('appsecret_proof', appSecretProof(cfg.token, cfg.appSecret));
  }

  let res: Response;
  try {
    res = await fetch(`${GRAPH_BASE}/${metaApiVersion()}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });
  } catch (err) {
    throw new MetaSyncError(graphNetworkError(err), 'graph_error');
  }

  const json = (await res.json().catch(() => null)) as GraphErrorBody | null;
  if (!res.ok || (json && json.error)) {
    const msg = json?.error?.message || `Graph API HTTP ${res.status}`;
    throw new MetaSyncError(`Facebook: ${msg}`, 'graph_error', res.status);
  }
}

/**
 * Write a new daily budget (dollars) to an ABO ad set. Meta stores budgets in
 * minor units, so we round to cents. Throws (MetaSyncError) on an invalid
 * amount, a CBO ad set (budget lives on the campaign), or a token without
 * `ads_management`.
 */
export async function pushAdSetDailyBudget(
  cfg: MetaConfig,
  adSetId: string,
  dailyBudgetDollars: number,
): Promise<void> {
  const cents = Math.round(dailyBudgetDollars * 100);
  if (!Number.isFinite(cents) || cents <= 0) {
    throw new MetaSyncError(
      'Daily budget must be a positive amount.',
      'graph_error',
    );
  }
  await metaGraphPost(cfg, adSetId, { daily_budget: cents });
}

export interface MetaAdSet {
  id: string;
  name: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string; // minor units (cents) as a string
  lifetime_budget?: string; // minor units (cents) as a string
  start_time?: string;
  end_time?: string; // ad sets expose `end_time` (campaigns use `stop_time`)
  /** Parent campaign — surfaced so the picker can disambiguate ad sets. */
  campaign?: { id?: string; name?: string };
}

/**
 * Ad sets are the level we pace against: in ABO accounts the daily/lifetime
 * budget lives here (not on the campaign, and never on the individual ad).
 * `campaign{...}` is pulled for picker context. For CBO accounts the ad set's
 * budget fields come back null — spend still syncs; the target stays manual.
 */
export async function fetchAdSets(
  cfg: MetaConfig,
  adAccountId: string,
): Promise<MetaAdSet[]> {
  return metaGraphFetchAll<MetaAdSet>(cfg, `${adAccountId}/adsets`, {
    fields:
      'id,name,status,effective_status,daily_budget,lifetime_budget,start_time,end_time,campaign{id,name}',
  });
}

interface MetaInsightRow {
  adset_id?: string;
  spend?: string;
}

/**
 * Returns adSetId → total spend ($) over [since, until], aggregated across the
 * whole window (time_increment=all_days).
 */
export async function fetchAdSetSpend(
  cfg: MetaConfig,
  adAccountId: string,
  since: string,
  until: string,
): Promise<Map<string, number>> {
  const rows = await metaGraphFetchAll<MetaInsightRow>(
    cfg,
    `${adAccountId}/insights`,
    {
      level: 'adset',
      fields: 'adset_id,spend',
      time_range: JSON.stringify({ since, until }),
      time_increment: 'all_days',
    },
  );
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.adset_id) continue;
    const spend = Number(row.spend ?? 0);
    if (!Number.isFinite(spend)) continue;
    map.set(row.adset_id, (map.get(row.adset_id) ?? 0) + spend);
  }
  return map;
}

/**
 * Returns adSetId → full-run spend ($): the ad set's all-time spend across its
 * entire flight (date_preset=maximum), not just the current month. Lets the
 * pacer surface a multi-month ad's total even when you're viewing one month.
 */
export async function fetchAdSetRunSpend(
  cfg: MetaConfig,
  adAccountId: string,
): Promise<Map<string, number>> {
  const rows = await metaGraphFetchAll<MetaInsightRow>(
    cfg,
    `${adAccountId}/insights`,
    {
      level: 'adset',
      fields: 'adset_id,spend',
      date_preset: 'maximum',
      time_increment: 'all_days',
    },
  );
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.adset_id) continue;
    const spend = Number(row.spend ?? 0);
    if (!Number.isFinite(spend)) continue;
    map.set(row.adset_id, (map.get(row.adset_id) ?? 0) + spend);
  }
  return map;
}

interface MetaAdSetDailyInsightRow {
  adset_id?: string;
  spend?: string;
  date_start?: string; // YYYY-MM-DD, the day bucket
}

/**
 * Returns adSetId → per-day spend rows over [since, until]
 * (time_increment=1). Feeds the pacing-health engine's rolling 7-day window
 * and the empirical overage-allowance derivation — synced into
 * MetaAdsPacerDailySpend rather than recomputed on every card render.
 */
export async function fetchAdSetDailySpend(
  cfg: MetaConfig,
  adAccountId: string,
  since: string,
  until: string,
): Promise<Map<string, { date: string; spend: number }[]>> {
  const rows = await metaGraphFetchAll<MetaAdSetDailyInsightRow>(
    cfg,
    `${adAccountId}/insights`,
    {
      level: 'adset',
      fields: 'adset_id,spend',
      time_range: JSON.stringify({ since, until }),
      time_increment: 1,
    },
  );
  const map = new Map<string, { date: string; spend: number }[]>();
  for (const row of rows) {
    if (!row.adset_id || !row.date_start) continue;
    const spend = Number(row.spend ?? 0);
    if (!Number.isFinite(spend)) continue;
    const list = map.get(row.adset_id) ?? [];
    list.push({ date: row.date_start, spend });
    map.set(row.adset_id, list);
  }
  return map;
}

interface MetaMonthlyRow {
  spend?: string;
  date_start?: string; // YYYY-MM-DD, the month bucket's start
}

/**
 * Account-total spend per calendar month over [since, until] (one Graph call,
 * time_increment=monthly). Returns YYYY-MM → total spend ($). Used to backfill
 * actual spend for months before the pacer existed so year reconciliation has
 * complete data. Account-level only — not split by ad set or Base/Added bucket.
 * Pass `since` as a month-start (YYYY-MM-01) so buckets align to calendar months.
 */
export async function fetchAccountMonthlySpend(
  cfg: MetaConfig,
  adAccountId: string,
  since: string,
  until: string,
): Promise<Map<string, number>> {
  const rows = await metaGraphFetchAll<MetaMonthlyRow>(
    cfg,
    `${adAccountId}/insights`,
    {
      fields: 'spend',
      time_range: JSON.stringify({ since, until }),
      time_increment: 'monthly',
    },
  );
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.date_start) continue;
    const month = row.date_start.slice(0, 7); // YYYY-MM
    const spend = Number(row.spend ?? 0);
    if (!Number.isFinite(spend)) continue;
    map.set(month, (map.get(month) ?? 0) + spend);
  }
  return map;
}

interface MetaAdAccountMeta {
  timezone_name?: string;
}

/**
 * Convert a Meta timestamp (e.g. "2026-05-15T08:00:00-0400", offset baked in)
 * to its YYYY-MM-DD calendar date in the ad account's timezone. null for a
 * missing/unparseable value.
 */
function metaScheduleDate(
  ts: string | undefined,
  timeZone: string,
): string | null {
  if (!ts) return null;
  const ms = new Date(ts).getTime();
  if (!Number.isFinite(ms)) return null;
  return zonedTodayIso(ms, timeZone);
}

/**
 * The ad account's configured IANA timezone (e.g. "America/New_York"). This
 * is the zone Meta resets the daily budget in, so the Pacer measures
 * time-left against it. null when Meta doesn't return a recognizable zone.
 */
export async function fetchAdAccountTimezone(
  cfg: MetaConfig,
  adAccountId: string,
): Promise<string | null> {
  const acct = await metaGraphFetch<MetaAdAccountMeta>(cfg, adAccountId, {
    fields: 'timezone_name',
  });
  const tz = acct.timezone_name?.trim();
  return tz && isValidTimeZone(tz) ? tz : null;
}

/** First/last day of a YYYY-MM period, with `until` clamped to today. */
function periodWindow(
  period: string,
  todayIso: string,
): { since: string; until: string; future: boolean } {
  const [year, month] = period.split('-').map(Number);
  const since = `${period}-01`;
  // Day 0 of the next month = last day of this month (UTC, date-only math).
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEnd = `${period}-${String(lastDay).padStart(2, '0')}`;
  const until = todayIso < monthEnd ? todayIso : monthEnd;
  // Period hasn't started yet — no spend to pull.
  return { since, until, future: todayIso < since };
}

/**
 * Resolves the agency token + this account's Facebook ad-account id, ready
 * for Graph calls. Throws a MetaSyncError the caller can map to a status.
 * A bare numeric id ("1234567890") is normalized to "act_1234567890".
 */
export async function getAdAccountConfig(
  accountKey: string,
): Promise<{ cfg: MetaConfig; adAccountId: string }> {
  const cfg = getMetaConfig();
  if (!cfg) {
    throw new MetaSyncError(
      'Facebook is not connected (set META_SYSTEM_USER_TOKEN).',
      'not_configured',
    );
  }
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { metaAdAccountId: true },
  });
  const raw = account?.metaAdAccountId?.trim();
  if (!raw) {
    throw new MetaSyncError(
      "No Facebook ad account is linked. Add it in the account's settings.",
      'no_ad_account',
    );
  }
  const adAccountId = /^\d+$/.test(raw) ? `act_${raw}` : raw;
  return { cfg, adAccountId };
}

// ════════════════════════════════════════════════════════════════════
//  Reporting fetchers (Ads report — /reporting/ads)
//
//  Read-only Insights pulls that mirror Oz Dealer Tools' FacebookAds
//  library. Each returns RAW platform numbers (no margin applied — the
//  route layer grosses these up via src/lib/reporting/margins.ts so the
//  markup math lives in one tested place). Shapes match the PHP arrays so
//  numeric parity with the old report is verifiable field-by-field.
// ════════════════════════════════════════════════════════════════════

/** One entry in an Insights `actions` / `cost_per_action_type` / `action_values` array. */
interface InsightAction {
  action_type?: string;
  value?: string;
}

/** Raw Insights row as returned by the Graph API (all metrics are strings). */
interface RawInsightRow {
  date_start?: string;
  campaign_id?: string;
  campaign_name?: string;
  device_platform?: string;
  age?: string;
  gender?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  spend?: string;
  actions?: InsightAction[];
  cost_per_action_type?: InsightAction[];
  action_values?: InsightAction[];
}

/** "Primary" online conversion action types (Oz parity). */
const PRIMARY_ONLINE_ACTIONS = [
  'purchase',
  'lead',
  'complete_registration',
  'submit_application',
];

export interface ConversionSummary {
  conversions: number;
  offline_leads: number;
  offline_purchases: number;
  offline_purchase_value: number;
}

/**
 * Classify a Facebook action_type to an offline bucket, or null when it's an
 * online/irrelevant type. Offline events carry the `offline_conversion.`
 * prefix; within that we bucket by the lead/purchase substring. (Oz parity —
 * see FacebookAds::classifyOfflineActionType.)
 */
function classifyOfflineActionType(
  actionType: string,
): 'offline_lead' | 'offline_purchase' | null {
  if (!actionType.startsWith('offline_conversion.')) return null;
  if (actionType.includes('purchase')) return 'offline_purchase';
  if (actionType.includes('lead')) return 'offline_lead';
  return null;
}

/**
 * Summarize an Insights `actions` (+ `action_values`) array into a total
 * conversions count plus offline buckets. Offline events count on top of the
 * online total (they're real outcomes). Port of FacebookAds::summarizeConversions.
 */
function summarizeConversions(
  actions: InsightAction[] = [],
  actionValues: InsightAction[] = [],
): ConversionSummary {
  let conversions = 0;
  let offlineLeads = 0;
  let offlinePurchases = 0;
  let offlinePurchaseValue = 0;

  for (const action of actions) {
    const type = action.action_type ?? '';
    const value = Math.trunc(Number(action.value ?? 0)) || 0;

    if (PRIMARY_ONLINE_ACTIONS.includes(type)) {
      conversions += value;
      continue;
    }
    const bucket = classifyOfflineActionType(type);
    if (bucket === 'offline_lead') {
      offlineLeads += value;
      conversions += value;
    } else if (bucket === 'offline_purchase') {
      offlinePurchases += value;
      conversions += value;
    }
  }

  // Offline purchase revenue lives in the parallel action_values array.
  for (const av of actionValues) {
    if (classifyOfflineActionType(av.action_type ?? '') === 'offline_purchase') {
      offlinePurchaseValue += Number(av.value ?? 0) || 0;
    }
  }

  return {
    conversions,
    offline_leads: offlineLeads,
    offline_purchases: offlinePurchases,
    offline_purchase_value: offlinePurchaseValue,
  };
}

/** First cost_per_action_type whose type is a primary online conversion. */
function costPerConversion(rows: InsightAction[] = []): number {
  for (const row of rows) {
    if (PRIMARY_ONLINE_ACTIONS.includes(row.action_type ?? '')) {
      return Number(row.value ?? 0) || 0;
    }
  }
  return 0;
}

const intOf = (v: string | undefined) => Math.trunc(Number(v ?? 0)) || 0;
const floatOf = (v: string | undefined) => Number(v ?? 0) || 0;

/** Run an Insights query against the ad account, following paging. */
function metaInsights(
  cfg: MetaConfig,
  adAccountId: string,
  params: Record<string, string | number | undefined>,
): Promise<RawInsightRow[]> {
  return metaGraphFetchAll<RawInsightRow>(cfg, `${adAccountId}/insights`, params);
}

export interface MetaReportMetrics extends ConversionSummary {
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  spend: number;
  cpm: number;
  cost_per_conversion: number;
}

export interface MetaCampaignRow extends ConversionSummary {
  id: string;
  name: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  spend: number;
  cost_per_conversion: number;
}

export interface MetaDeviceRow {
  device: string;
  impressions: number;
  clicks: number;
  ctr: number;
  spend: number;
}

export interface MetaDailyRow extends ConversionSummary {
  date: string;
  label: string;
  impressions: number;
  clicks: number;
  spend: number;
}

export interface MetaDemographicRow {
  age: string;
  gender: string;
  impressions: number;
  clicks: number;
  spend: number;
}

const EMPTY_ACCOUNT_METRICS: MetaReportMetrics = {
  impressions: 0,
  clicks: 0,
  ctr: 0,
  cpc: 0,
  spend: 0,
  cpm: 0,
  conversions: 0,
  cost_per_conversion: 0,
  offline_leads: 0,
  offline_purchases: 0,
  offline_purchase_value: 0,
};

/** Account-level totals over [since, until]. */
export async function getAccountMetrics(
  cfg: MetaConfig,
  adAccountId: string,
  since: string,
  until: string,
): Promise<MetaReportMetrics> {
  const rows = await metaInsights(cfg, adAccountId, {
    level: 'account',
    fields:
      'impressions,clicks,ctr,cpc,spend,cpm,actions,cost_per_action_type,action_values',
    time_range: JSON.stringify({ since, until }),
  });
  const data = rows[0];
  if (!data) return { ...EMPTY_ACCOUNT_METRICS };

  return {
    impressions: intOf(data.impressions),
    clicks: intOf(data.clicks),
    ctr: floatOf(data.ctr),
    cpc: floatOf(data.cpc),
    spend: floatOf(data.spend),
    cpm: floatOf(data.cpm),
    cost_per_conversion: costPerConversion(data.cost_per_action_type),
    ...summarizeConversions(data.actions, data.action_values),
  };
}

/** Per-campaign performance over [since, until]. */
export async function getCampaignPerformance(
  cfg: MetaConfig,
  adAccountId: string,
  since: string,
  until: string,
): Promise<MetaCampaignRow[]> {
  const rows = await metaInsights(cfg, adAccountId, {
    level: 'campaign',
    fields:
      'campaign_id,campaign_name,impressions,clicks,ctr,cpc,spend,actions,cost_per_action_type,action_values',
    time_range: JSON.stringify({ since, until }),
  });
  return rows.map((data) => ({
    id: data.campaign_id ?? '',
    name: data.campaign_name ?? 'Unknown',
    impressions: intOf(data.impressions),
    clicks: intOf(data.clicks),
    ctr: floatOf(data.ctr),
    cpc: floatOf(data.cpc),
    spend: floatOf(data.spend),
    cost_per_conversion: costPerConversion(data.cost_per_action_type),
    ...summarizeConversions(data.actions, data.action_values),
  }));
}

/** Device-platform breakdown over [since, until]. */
export async function getDevicePerformance(
  cfg: MetaConfig,
  adAccountId: string,
  since: string,
  until: string,
): Promise<MetaDeviceRow[]> {
  const rows = await metaInsights(cfg, adAccountId, {
    level: 'account',
    fields: 'impressions,clicks,ctr,spend',
    breakdowns: 'device_platform',
    time_range: JSON.stringify({ since, until }),
  });
  return rows.map((data) => {
    const device = data.device_platform ?? 'Unknown';
    return {
      device: device.charAt(0).toUpperCase() + device.slice(1),
      impressions: intOf(data.impressions),
      clicks: intOf(data.clicks),
      ctr: floatOf(data.ctr),
      spend: floatOf(data.spend),
    };
  });
}

/** Daily trend over [since, until] (time_increment=1). */
export async function getDailyPerformance(
  cfg: MetaConfig,
  adAccountId: string,
  since: string,
  until: string,
): Promise<MetaDailyRow[]> {
  const rows = await metaInsights(cfg, adAccountId, {
    level: 'account',
    fields: 'impressions,clicks,spend,actions,action_values',
    time_range: JSON.stringify({ since, until }),
    time_increment: 1,
  });
  return rows.map((data) => {
    const date = data.date_start ?? '';
    // "May 15" — matches the PHP date('M d', …) bucket label (zero-padded day).
    const label = date
      ? new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
          month: 'short',
          day: '2-digit',
          timeZone: 'UTC',
        })
      : '';
    return {
      date,
      label,
      impressions: intOf(data.impressions),
      clicks: intOf(data.clicks),
      spend: floatOf(data.spend),
      ...summarizeConversions(data.actions, data.action_values),
    };
  });
}

/** Age × gender breakdown over [since, until]. */
export async function getDemographics(
  cfg: MetaConfig,
  adAccountId: string,
  since: string,
  until: string,
): Promise<MetaDemographicRow[]> {
  const rows = await metaInsights(cfg, adAccountId, {
    level: 'account',
    fields: 'impressions,clicks,spend',
    breakdowns: 'age,gender',
    time_range: JSON.stringify({ since, until }),
  });
  return rows.map((data) => ({
    age: data.age ?? 'Unknown',
    gender: data.gender ?? 'Unknown',
    impressions: intOf(data.impressions),
    clicks: intOf(data.clicks),
    spend: floatOf(data.spend),
  }));
}

export interface MetaCreative {
  ad_id: string;
  ad_name: string;
  thumbnail_url: string;
  full_url: string;
}

/** ?ids=… batch response shape for ad → creative thumbnail lookups. */
interface CreativeBatchEntry {
  error?: unknown;
  creative?: { id?: string; thumbnail_url?: string };
  image_url?: string;
  effective_image_url?: string;
}

/**
 * Ad creative thumbnails grouped by campaign id, for ads that delivered in
 * [since, until]. Best-effort and non-fatal: any failure returns {} so the
 * report still renders (Oz parity — getCampaignCreatives). Two extra ?ids=…
 * passes upgrade thumbnails to full-size creative images where available.
 */
export async function getCampaignCreatives(
  cfg: MetaConfig,
  adAccountId: string,
  since: string,
  until: string,
): Promise<Record<string, MetaCreative[]>> {
  interface AdInsightRow extends RawInsightRow {
    ad_id?: string;
    ad_name?: string;
  }
  let rows: AdInsightRow[];
  try {
    rows = (await metaInsights(cfg, adAccountId, {
      level: 'ad',
      fields: 'campaign_id,ad_id,ad_name,impressions',
      time_range: JSON.stringify({ since, until }),
      filtering: JSON.stringify([
        { field: 'impressions', operator: 'GREATER_THAN', value: '0' },
      ]),
    })) as AdInsightRow[];
  } catch {
    return {};
  }

  // Collect the best (highest-impression) row per ad, grouped by campaign.
  interface AdInfo {
    ad_id: string;
    ad_name: string;
    impressions: number;
    campaign_id: string;
  }
  const adById = new Map<string, AdInfo>();
  for (const r of rows) {
    const cid = r.campaign_id ?? '';
    const aid = r.ad_id ?? '';
    if (!cid || !aid) continue;
    adById.set(aid, {
      ad_id: aid,
      ad_name: r.ad_name ?? '',
      impressions: intOf(r.impressions),
      campaign_id: cid,
    });
  }
  if (adById.size === 0) return {};

  // Pass 1: ad → creative{ id, thumbnail_url }, batched 50 at a time.
  const thumbs = new Map<string, { thumb: string; full: string; creativeId?: string }>();
  const adIds = [...adById.keys()];
  for (let i = 0; i < adIds.length; i += 50) {
    const chunk = adIds.slice(i, i + 50);
    let batch: Record<string, CreativeBatchEntry>;
    try {
      batch = await metaGraphFetch<Record<string, CreativeBatchEntry>>(cfg, '', {
        ids: chunk.join(','),
        fields: 'id,creative{id,thumbnail_url}',
      });
    } catch {
      continue;
    }
    for (const [adId, adData] of Object.entries(batch)) {
      if (!adData || adData.error) continue;
      const thumb = adData.creative?.thumbnail_url;
      if (adId && thumb) {
        thumbs.set(adId, { thumb, full: thumb, creativeId: adData.creative?.id });
      }
    }
  }

  // Pass 2: upgrade thumbnails to full-size creative images.
  const creativeToAd = new Map<string, string>();
  for (const [adId, info] of thumbs) {
    if (info.creativeId) creativeToAd.set(info.creativeId, adId);
  }
  const creativeIds = [...creativeToAd.keys()];
  for (let i = 0; i < creativeIds.length; i += 50) {
    const chunk = creativeIds.slice(i, i + 50);
    let batch: Record<string, CreativeBatchEntry>;
    try {
      batch = await metaGraphFetch<Record<string, CreativeBatchEntry>>(cfg, '', {
        ids: chunk.join(','),
        fields: 'id,image_url,effective_image_url',
      });
    } catch {
      continue;
    }
    for (const [crId, crData] of Object.entries(batch)) {
      if (!crData || crData.error) continue;
      const full = crData.effective_image_url ?? crData.image_url;
      const adId = creativeToAd.get(crId);
      if (full && adId && thumbs.has(adId)) {
        thumbs.get(adId)!.full = full;
      }
    }
  }

  // Group into campaigns, ordered by impressions desc, dropping ads with no thumb.
  const byCampaign = new Map<string, AdInfo[]>();
  for (const info of adById.values()) {
    if (!thumbs.has(info.ad_id)) continue;
    const list = byCampaign.get(info.campaign_id) ?? [];
    list.push(info);
    byCampaign.set(info.campaign_id, list);
  }

  const result: Record<string, MetaCreative[]> = {};
  for (const [cid, ads] of byCampaign) {
    ads.sort((a, b) => b.impressions - a.impressions);
    result[cid] = ads.map((ad) => {
      const t = thumbs.get(ad.ad_id)!;
      return {
        ad_id: ad.ad_id,
        ad_name: ad.ad_name,
        thumbnail_url: t.thumb,
        full_url: t.full,
      };
    });
  }
  return result;
}

export interface MetaSyncAdResult {
  adId: string;
  name: string;
  matched: boolean;
  adSetId: string | null;
  adSetName: string | null;
  spend: number | null;
}

export interface MetaSyncResult {
  ok: true;
  adAccountId: string;
  since: string;
  until: string;
  total: number;
  matched: number;
  results: MetaSyncAdResult[];
}

/**
 * Pull spend for every linkable ad in `period` and write it onto the rows.
 * `todayIso` is passed in (yyyy-MM-dd) so the caller controls "now".
 */
export async function syncPeriodFromMeta(
  accountKey: string,
  period: string,
  todayIso: string,
): Promise<MetaSyncResult> {
  const { cfg, adAccountId } = await getAdAccountConfig(accountKey);

  const plan = await prisma.metaAdsPacerPlan.findUnique({
    where: { accountKey },
    select: { id: true },
  });
  const ads = plan
    ? await prisma.metaAdsPacerAd.findMany({
        where: { planId: plan.id, period },
        select: { id: true, name: true, budgetType: true, metaObjectId: true },
      })
    : [];

  const { since, until, future } = periodWindow(period, todayIso);
  if (ads.length === 0) {
    return { ok: true, adAccountId, since, until, total: 0, matched: 0, results: [] };
  }

  const adSets = await fetchAdSets(cfg, adAccountId);
  const spendMap = future
    ? new Map<string, number>()
    : await fetchAdSetSpend(cfg, adAccountId, since, until);
  // Full-run (all-time) spend per ad set, so multi-month ads can show their
  // total alongside the current month. Best-effort: a failure here must not
  // abort the month sync, so fall back to an empty map.
  const runSpendMap = future
    ? new Map<string, number>()
    : await fetchAdSetRunSpend(cfg, adAccountId).catch(() => new Map<string, number>());

  // Cache the ad account's timezone for the Pacer's time-left math, and use it
  // to bucket Meta's start_time / end_time into account-TZ calendar dates
  // below. Best effort: a failure here must not abort an otherwise-good sync.
  let accountTz = DEFAULT_TIME_ZONE;
  try {
    const tz = await fetchAdAccountTimezone(cfg, adAccountId);
    if (tz) {
      accountTz = tz;
      await prisma.account.update({
        where: { key: accountKey },
        data: { metaTimezone: tz },
      });
    }
  } catch {
    // Ignore — pacing falls back to the stored timezone / default.
  }

  const byId = new Map(adSets.map((s) => [s.id, s]));
  const byName = new Map(
    adSets.map((s) => [s.name.trim().toLowerCase(), s]),
  );

  const results: MetaSyncAdResult[] = [];
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  // Real wall-clock moment of the pull (drives the "synced Xh ago" badge);
  // `todayIso` only bounds the spend window, above.
  const syncedAt = new Date();

  for (const ad of ads) {
    // ID-first: a linked row resolves by its stored ad-set id ONLY — it never
    // falls back to a name match, so a deleted/renamed ad set leaves it
    // unmatched rather than silently re-binding to a different same-named ad
    // set. The case-insensitive name match is reserved for never-linked rows
    // (first sync of a hand-created ad).
    const adSet = ad.metaObjectId
      ? byId.get(ad.metaObjectId)
      : ad.name?.trim()
        ? byName.get(ad.name.trim().toLowerCase())
        : undefined;

    if (!adSet) {
      results.push({
        adId: ad.id,
        name: ad.name,
        matched: false,
        adSetId: null,
        adSetName: null,
        spend: null,
      });
      continue;
    }

    const spend = spendMap.get(adSet.id) ?? 0;
    const runSpend = runSpendMap.get(adSet.id);
    const data: Prisma.MetaAdsPacerAdUpdateInput = {
      metaObjectType: 'adset',
      metaObjectId: adSet.id,
      metaEffectiveStatus: adSet.effective_status ?? adSet.status ?? null,
      pacerActual: spend.toFixed(2),
      // Full-run total (all-time) — informational; null if the run-spend pull
      // failed or returned nothing for this ad set.
      pacerRunSpend: runSpend != null ? runSpend.toFixed(2) : null,
      pacerSyncedAt: syncedAt,
      // Actual run schedule, as account-TZ calendar dates. end_time is often
      // absent (open-ended ad sets) → null, which the pacer treats as "runs to
      // month end." The pacer clamps these to the pacing month.
      metaStartDate: metaScheduleDate(adSet.start_time, accountTz),
      metaEndDate: metaScheduleDate(adSet.end_time, accountTz),
    };

    // Pull the live Daily rate so the pacer reflects Meta (and Push-to-Meta can
    // edit it). ABO ad sets expose it; CBO ad sets are null (budget on the
    // campaign), so it stays manual.
    //
    // We deliberately NEVER write `allocation` — that's the team's PLANNED
    // target spend, not an actual/Meta number, and must stay untouched by sync.
    // This previously clobbered Lifetime ads with Meta's lifetime_budget, which
    // for a multi-month run spans the whole flight and overwrote the per-month
    // planned figure (and reverted manual corrections on the next sync).
    if (ad.budgetType !== 'Lifetime' && adSet.daily_budget != null) {
      const dollars = Number(adSet.daily_budget) / 100;
      if (Number.isFinite(dollars)) data.pacerDailyBudget = dollars.toFixed(2);
    }

    // Persist the ad set's lifetime budget (the settlement baseline) when Meta
    // reports one. Unlike daily_budget this is safe to store on its own field —
    // it never touches `allocation` (the planned per-month slice).
    if (adSet.lifetime_budget != null) {
      const dollars = Number(adSet.lifetime_budget) / 100;
      if (Number.isFinite(dollars)) data.metaLifetimeBudget = dollars.toFixed(2);
    }

    ops.push(prisma.metaAdsPacerAd.update({ where: { id: ad.id }, data }));
    results.push({
      adId: ad.id,
      name: ad.name,
      matched: true,
      adSetId: adSet.id,
      adSetName: adSet.name,
      spend,
    });
  }

  if (ops.length > 0) await prisma.$transaction(ops);

  // Daily spend series (pacing-health engine): per-day spend for every linked
  // ad set — 90-day backfill on the first sync, a short trailing window after.
  // Best-effort: a failure here must not abort an otherwise-good month sync.
  if (plan && !future) {
    try {
      const linkedIds = new Set(
        results.filter((r) => r.matched && r.adSetId).map((r) => r.adSetId as string),
      );
      if (linkedIds.size > 0) {
        const window = await dailySpendSyncWindow(plan.id, 'meta', todayIso);
        const daily = await fetchAdSetDailySpend(
          cfg,
          adAccountId,
          window.since,
          window.until,
        );
        // Budget-in-effect: the CURRENT daily budget — exact for today's row.
        // Past days that were already synced keep their stored budget
        // (writeDailySpendSeries → reconcileSeriesBudgets), so a raise doesn't
        // rewrite pre-change history; only the first backfill approximates
        // history with the current budget. Feeds the overage derivation and the
        // pacing-health "ramping" annotation / budget-change divider.
        const budgetByAdSet = new Map(
          adSets.map((s) => {
            const dollars = s.daily_budget != null ? Number(s.daily_budget) / 100 : NaN;
            return [s.id, Number.isFinite(dollars) ? dollars : null] as const;
          }),
        );
        const rows: DailySpendWriteRow[] = [];
        for (const [adSetId, points] of daily) {
          if (!linkedIds.has(adSetId)) continue;
          const dailyBudget = budgetByAdSet.get(adSetId) ?? null;
          for (const p of points) {
            rows.push({ objectId: adSetId, date: p.date, spend: p.spend, dailyBudget });
          }
        }
        if (rows.length > 0) await writeDailySpendSeries(plan.id, 'meta', window, rows);
      }
    } catch {
      // Series sync is additive — the cards fall back to "needs series".
    }
  }

  return {
    ok: true,
    adAccountId,
    since,
    until,
    total: ads.length,
    matched: results.filter((r) => r.matched).length,
    results,
  };
}

// ════════════════════════════════════════════════════════════════════
//  Bulk import (onboarding) — discover an account's existing ad sets and
//  adopt the chosen ones as pacer rows, born already linked + synced. The
//  inverse of the manual "create row, then hunt for its match" flow.
//  Still read-only against Meta: we only ever write local pacer rows here.
// ════════════════════════════════════════════════════════════════════

/**
 * Map a Meta ad-set effective status onto the pacer's planner status vocabulary
 * (src/app/tools/meta/_lib/constants.ts → AD_STATUSES), so an imported ad lands
 * in the board column that matches its real delivery state in Meta.
 */
export function metaStatusToAdStatus(
  effectiveStatus: string | null | undefined,
): string {
  switch ((effectiveStatus ?? '').toUpperCase()) {
    case 'ACTIVE':
      return 'Live';
    case 'PAUSED':
    case 'ADSET_PAUSED':
    case 'CAMPAIGN_PAUSED':
      return 'Off';
    case 'PENDING_REVIEW':
    case 'IN_PROCESS':
    case 'PENDING_BILLING_INFO':
    case 'PREAPPROVED':
      return 'Scheduled';
    case 'DISAPPROVED':
    case 'WITH_ISSUES':
      return 'Stuck';
    case 'ARCHIVED':
      return 'Completed Run';
    case 'DELETED':
      return 'Off';
    default:
      return 'Working on it';
  }
}

/** Daily/lifetime cents (string) → positive dollars, or null. */
function metaBudgetDollars(cents: string | null | undefined): number | null {
  if (cents == null) return null;
  const n = Number(cents) / 100;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface DiscoveredAdSet {
  id: string;
  name: string;
  campaignName: string | null;
  effectiveStatus: string | null;
  /** True when Meta reports the ad set actively delivering (status ACTIVE). */
  active: boolean;
  budgetType: 'Daily' | 'Lifetime';
  /** Daily budget in dollars (ABO daily ad sets); null otherwise. */
  dailyBudget: number | null;
  /** Lifetime budget in dollars (lifetime ad sets); null otherwise. */
  lifetimeBudget: number | null;
  /** Account-TZ calendar dates of the ad set's flight (null = open-ended). */
  startDate: string | null;
  endDate: string | null;
  /** Spend in the requested period ($). */
  periodSpend: number;
  /** All-time spend across the whole flight ($); informational. */
  runSpend: number | null;
  /** Already linked to a pacer row in THIS period — excluded from import. */
  alreadyLinked: boolean;
  /** The planner status this ad set would map to on import. */
  suggestedStatus: string;
}

export interface DiscoverResult {
  ok: true;
  adAccountId: string;
  since: string;
  until: string;
  adSets: DiscoveredAdSet[];
}

/**
 * List every ad set in the account's Facebook ad account, enriched with the
 * budget / flight / spend the import modal previews, and flagged for the ones
 * already linked to a pacer row in `period` (so re-running never double-offers
 * them). Read-only.
 */
export async function discoverAdSets(
  accountKey: string,
  period: string,
  todayIso: string,
): Promise<DiscoverResult> {
  const { cfg, adAccountId } = await getAdAccountConfig(accountKey);
  const { since, until, future } = periodWindow(period, todayIso);

  const [adSets, spendMap, runSpendMap] = await Promise.all([
    fetchAdSets(cfg, adAccountId),
    future
      ? Promise.resolve(new Map<string, number>())
      : fetchAdSetSpend(cfg, adAccountId, since, until),
    future
      ? Promise.resolve(new Map<string, number>())
      : fetchAdSetRunSpend(cfg, adAccountId).catch(() => new Map<string, number>()),
  ]);

  // Account timezone for bucketing Meta's start_time / end_time into calendar
  // dates. Best-effort — fall back to the default zone.
  let accountTz = DEFAULT_TIME_ZONE;
  try {
    const tz = await fetchAdAccountTimezone(cfg, adAccountId);
    if (tz) accountTz = tz;
  } catch {
    // Ignore — dates fall back to the default zone.
  }

  // Ad sets already linked to a row in THIS period — scoped to the period so a
  // multi-month ad set can legitimately back a row in more than one month.
  const plan = await prisma.metaAdsPacerPlan.findUnique({
    where: { accountKey },
    select: { id: true },
  });
  const linkedRows = plan
    ? await prisma.metaAdsPacerAd.findMany({
        where: { planId: plan.id, period, metaObjectId: { not: null } },
        select: { metaObjectId: true },
      })
    : [];
  const linkedIds = new Set(
    linkedRows.map((r) => r.metaObjectId).filter((id): id is string => !!id),
  );

  const out: DiscoveredAdSet[] = adSets.map((s) => {
    const eff = s.effective_status ?? s.status ?? null;
    const dailyBudget = metaBudgetDollars(s.daily_budget);
    const lifetimeBudget = metaBudgetDollars(s.lifetime_budget);
    return {
      id: s.id,
      name: s.name,
      campaignName: s.campaign?.name ?? null,
      effectiveStatus: eff,
      active: (eff ?? '').toUpperCase() === 'ACTIVE',
      budgetType: lifetimeBudget != null && dailyBudget == null ? 'Lifetime' : 'Daily',
      dailyBudget,
      lifetimeBudget,
      startDate: metaScheduleDate(s.start_time, accountTz),
      endDate: metaScheduleDate(s.end_time, accountTz),
      periodSpend: spendMap.get(s.id) ?? 0,
      runSpend: runSpendMap.get(s.id) ?? null,
      alreadyLinked: linkedIds.has(s.id),
      suggestedStatus: metaStatusToAdStatus(eff),
    };
  });

  return { ok: true, adAccountId, since, until, adSets: out };
}

export interface ImportedAdSummary {
  adId: string;
  adSetId: string;
  name: string;
  status: string;
}

export interface ImportAdSetsResult {
  ok: true;
  imported: ImportedAdSummary[];
  /** Ids requested but skipped (not found, or already linked in this period). */
  skipped: string[];
}

export interface ImportAssignments {
  ownerUserId?: string | null;
  designerUserId?: string | null;
  accountRepUserId?: string | null;
}

/**
 * Adopt the chosen Meta ad sets as new pacer rows in `period`, born already
 * linked (metaObjectId) and synced (actual spend, status, budget, flight
 * dates). `planId` is resolved by the caller (route) via getOrCreatePlan, so
 * this stays free of the pacer-lib dependency. The caller writes the audit
 * entry from the returned summaries.
 */
export async function importAdSets(
  accountKey: string,
  planId: string,
  period: string,
  todayIso: string,
  adSetIds: string[],
  assignments: ImportAssignments = {},
): Promise<ImportAdSetsResult> {
  const requested = Array.from(new Set(adSetIds.filter(Boolean)));
  if (requested.length === 0) return { ok: true, imported: [], skipped: [] };

  const { cfg, adAccountId } = await getAdAccountConfig(accountKey);
  const { since, until, future } = periodWindow(period, todayIso);

  const [adSets, spendMap, runSpendMap] = await Promise.all([
    fetchAdSets(cfg, adAccountId),
    future
      ? Promise.resolve(new Map<string, number>())
      : fetchAdSetSpend(cfg, adAccountId, since, until),
    future
      ? Promise.resolve(new Map<string, number>())
      : fetchAdSetRunSpend(cfg, adAccountId).catch(() => new Map<string, number>()),
  ]);

  // Cache the ad account timezone (same as a sync) and bucket flight dates.
  let accountTz = DEFAULT_TIME_ZONE;
  try {
    const tz = await fetchAdAccountTimezone(cfg, adAccountId);
    if (tz) {
      accountTz = tz;
      await prisma.account
        .update({ where: { key: accountKey }, data: { metaTimezone: tz } })
        .catch(() => undefined);
    }
  } catch {
    // Ignore — pacing falls back to the stored timezone / default.
  }

  const byId = new Map(adSets.map((s) => [s.id, s]));

  // Already-linked ids in this period are skipped (idempotency) — re-importing
  // the same ad set never creates a duplicate row.
  const linkedRows = await prisma.metaAdsPacerAd.findMany({
    where: { planId, period, metaObjectId: { not: null } },
    select: { metaObjectId: true },
  });
  const linkedIds = new Set(
    linkedRows.map((r) => r.metaObjectId).filter((id): id is string => !!id),
  );

  // Append after the period's existing rows.
  const maxPos = await prisma.metaAdsPacerAd.aggregate({
    where: { planId, period },
    _max: { position: true },
  });
  let position = (maxPos._max.position ?? -1) + 1;

  const syncedAt = new Date();
  const creates: Prisma.MetaAdsPacerAdCreateManyInput[] = [];
  const imported: ImportedAdSummary[] = [];
  const skipped: string[] = [];

  for (const id of requested) {
    const adSet = byId.get(id);
    if (!adSet || linkedIds.has(id)) {
      skipped.push(id);
      continue;
    }
    const dailyBudget = metaBudgetDollars(adSet.daily_budget);
    const lifetimeBudget = metaBudgetDollars(adSet.lifetime_budget);
    const budgetType: 'Daily' | 'Lifetime' =
      lifetimeBudget != null && dailyBudget == null ? 'Lifetime' : 'Daily';
    const status = metaStatusToAdStatus(adSet.effective_status ?? adSet.status);
    const spend = spendMap.get(adSet.id) ?? 0;
    const runSpend = runSpendMap.get(adSet.id);
    const startDate = metaScheduleDate(adSet.start_time, accountTz);
    const endDate = metaScheduleDate(adSet.end_time, accountTz);

    const adId = randomUUID();
    creates.push({
      id: adId,
      planId,
      position: position++,
      name: adSet.name,
      period,
      ownerUserId: assignments.ownerUserId ?? null,
      designerUserId: assignments.designerUserId ?? null,
      accountRepUserId: assignments.accountRepUserId ?? null,
      budgetType,
      adStatus: status,
      // Deliberately NOT seeded from Meta's budget: a daily *rate* isn't a
      // monthly target, and a lifetime ad's whole-flight pool would overstate
      // a single month's planned spend (the same distortion syncPeriodFromMeta
      // avoids — see its note on never writing allocation). The team sets the
      // planned target; import only brings in the real Meta numbers.
      allocation: null,
      flightStart: startDate,
      flightEnd: endDate,
      // Meta-managed mirror — born linked + synced.
      metaObjectType: 'adset',
      metaObjectId: adSet.id,
      metaEffectiveStatus: adSet.effective_status ?? adSet.status ?? null,
      pacerActual: spend.toFixed(2),
      pacerRunSpend: runSpend != null ? runSpend.toFixed(2) : null,
      // Settlement baseline (the spend cap), safe to seed — unlike allocation.
      metaLifetimeBudget: lifetimeBudget != null ? lifetimeBudget.toFixed(2) : null,
      pacerSyncedAt: syncedAt,
      pacerDailyBudget:
        budgetType !== 'Lifetime' && dailyBudget != null
          ? dailyBudget.toFixed(2)
          : null,
      metaStartDate: startDate,
      metaEndDate: endDate,
    });
    imported.push({ adId, adSetId: adSet.id, name: adSet.name, status });
  }

  if (creates.length > 0) {
    await prisma.metaAdsPacerAd.createMany({ data: creates });
  }

  return { ok: true, imported, skipped };
}
