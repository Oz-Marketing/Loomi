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
    throw new MetaSyncError(
      `Could not reach the Facebook Graph API: ${err instanceof Error ? err.message : 'network error'}`,
      'graph_error',
    );
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
    const adSet =
      (ad.metaObjectId ? byId.get(ad.metaObjectId) : undefined) ??
      (ad.name?.trim()
        ? byName.get(ad.name.trim().toLowerCase())
        : undefined);

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
