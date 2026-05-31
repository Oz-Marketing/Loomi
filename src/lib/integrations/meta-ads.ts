/**
 * Facebook (Meta) Marketing API client + Ad Pacer spend sync.
 *
 * Phase 1 is read-only: we pull per-campaign spend (and, when available,
 * daily/lifetime budget + delivery status) and write it onto the matching
 * MetaAdsPacerAd rows. A pacer row "links" to a Facebook campaign either by
 * a stored `metaObjectId` or, on first sync, by an exact (case-insensitive)
 * name match. Once linked, Facebook owns that row's `pacerActual`.
 *
 * Credentials are a single agency-wide System User token in env
 * (META_SYSTEM_USER_TOKEN). Each sub-account stores only its ad-account id
 * (Account.metaAdAccountId, e.g. "act_123"). We never write to Facebook here.
 */

import { createHmac } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  zonedTodayIso,
} from '@/lib/timezone';

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
    throw new MetaSyncError(
      `Could not reach the Facebook Graph API: ${err instanceof Error ? err.message : 'network error'}`,
      'graph_error',
    );
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

export interface MetaCampaign {
  id: string;
  name: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string; // minor units (cents) as a string
  lifetime_budget?: string; // minor units (cents) as a string
  start_time?: string;
  stop_time?: string;
}

export async function fetchCampaigns(
  cfg: MetaConfig,
  adAccountId: string,
): Promise<MetaCampaign[]> {
  return metaGraphFetchAll<MetaCampaign>(cfg, `${adAccountId}/campaigns`, {
    fields:
      'id,name,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time',
  });
}

interface MetaInsightRow {
  campaign_id?: string;
  spend?: string;
}

/**
 * Returns campaignId → total spend ($) over [since, until], aggregated across
 * the whole window (time_increment=all_days).
 */
export async function fetchCampaignSpend(
  cfg: MetaConfig,
  adAccountId: string,
  since: string,
  until: string,
): Promise<Map<string, number>> {
  const rows = await metaGraphFetchAll<MetaInsightRow>(
    cfg,
    `${adAccountId}/insights`,
    {
      level: 'campaign',
      fields: 'campaign_id,spend',
      time_range: JSON.stringify({ since, until }),
      time_increment: 'all_days',
    },
  );
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.campaign_id) continue;
    const spend = Number(row.spend ?? 0);
    if (!Number.isFinite(spend)) continue;
    map.set(row.campaign_id, (map.get(row.campaign_id) ?? 0) + spend);
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

export interface MetaSyncAdResult {
  adId: string;
  name: string;
  matched: boolean;
  campaignId: string | null;
  campaignName: string | null;
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

  const campaigns = await fetchCampaigns(cfg, adAccountId);
  const spendMap = future
    ? new Map<string, number>()
    : await fetchCampaignSpend(cfg, adAccountId, since, until);

  // Cache the ad account's timezone for the Pacer's time-left math, and use it
  // to bucket Meta's start_time / stop_time into account-TZ calendar dates
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

  const byId = new Map(campaigns.map((c) => [c.id, c]));
  const byName = new Map(
    campaigns.map((c) => [c.name.trim().toLowerCase(), c]),
  );

  const results: MetaSyncAdResult[] = [];
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  // Real wall-clock moment of the pull (drives the "synced Xh ago" badge);
  // `todayIso` only bounds the spend window, above.
  const syncedAt = new Date();

  for (const ad of ads) {
    const campaign =
      (ad.metaObjectId ? byId.get(ad.metaObjectId) : undefined) ??
      (ad.name?.trim()
        ? byName.get(ad.name.trim().toLowerCase())
        : undefined);

    if (!campaign) {
      results.push({
        adId: ad.id,
        name: ad.name,
        matched: false,
        campaignId: null,
        campaignName: null,
        spend: null,
      });
      continue;
    }

    const spend = spendMap.get(campaign.id) ?? 0;
    const data: Prisma.MetaAdsPacerAdUpdateInput = {
      metaObjectType: 'campaign',
      metaObjectId: campaign.id,
      metaEffectiveStatus: campaign.effective_status ?? campaign.status ?? null,
      pacerActual: spend.toFixed(2),
      pacerSyncedAt: syncedAt,
      // Actual run schedule, as account-TZ calendar dates. stop_time is often
      // absent (open-ended campaigns) → null, which the pacer treats as "runs
      // to month end." The pacer clamps these to the pacing month.
      metaStartDate: metaScheduleDate(campaign.start_time, accountTz),
      metaEndDate: metaScheduleDate(campaign.stop_time, accountTz),
    };

    // CBO campaigns expose budget at the campaign level (ABO is null — left
    // to manual entry). Daily for Daily ads, lifetime for Lifetime ads.
    if (ad.budgetType !== 'Lifetime' && campaign.daily_budget != null) {
      const dollars = Number(campaign.daily_budget) / 100;
      if (Number.isFinite(dollars)) data.pacerDailyBudget = dollars.toFixed(2);
    }
    if (ad.budgetType === 'Lifetime' && campaign.lifetime_budget != null) {
      const dollars = Number(campaign.lifetime_budget) / 100;
      if (Number.isFinite(dollars)) data.allocation = dollars.toFixed(2);
    }

    ops.push(prisma.metaAdsPacerAd.update({ where: { id: ad.id }, data }));
    results.push({
      adId: ad.id,
      name: ad.name,
      matched: true,
      campaignId: campaign.id,
      campaignName: campaign.name,
      spend,
    });
  }

  if (ops.length > 0) await prisma.$transaction(ops);

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
