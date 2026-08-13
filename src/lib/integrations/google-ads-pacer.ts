// §8 — Google Ads PACER client. Adds the two pacer-specific GAQL reads (campaign
// import + cost_micros spend) on top of the existing reporting client's OAuth +
// GAQL layer (./google-ads). Reuses getGoogleCustomer for per-account cred +
// customer resolution and GoogleAdsError for uniform error handling — so this
// file is purely "what to query", not "how to auth". Nothing here runs until the
// agency OAuth env (GOOGLE_ADS_*) is set; isGoogleAdsConfigured() gates callers.

import {
  gaql,
  getGoogleCustomer,
  microsToUnits,
  isGoogleAdsConfigured,
  GoogleAdsError,
  type GoogleAdsConfig,
} from './google-ads';
// The pure module owns the shape (it's plain data, used by the channel/budget
// mappers + import reconciliation); this client just produces it.
import type { ImportedGoogleCampaign } from '@/lib/ad-pacer/google-pacer-calc';
import {
  reconcileImport,
  mapChannelGroup,
  mapGoogleBudgetType,
  computeProratedCeiling,
  isSharedBudget,
  type BudgetRateSegment,
  type ImportDiff,
} from '@/lib/ad-pacer/google-pacer-calc';
import type { PacerAd } from '@/lib/ad-pacer/types';
import { prisma } from '@/lib/prisma';
import {
  addDaysIso,
  getOrCreatePlan,
  dailySpendSyncWindow,
  writeDailySpendSeries,
  type DailySpendWriteRow,
} from '@/lib/meta-ads-pacer';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

/** Google campaign status → the planner's status vocabulary (mirrors the Meta
 *  equivalent + the client mapGoogleStatus). */
export function googleStatusToAdStatus(status: string | null | undefined): string {
  switch ((status ?? '').toUpperCase()) {
    case 'ENABLED':
      return 'Live';
    case 'PAUSED':
      return 'Off';
    default:
      return 'In Draft';
  }
}

export { getGoogleCustomer, isGoogleAdsConfigured, GoogleAdsError };
export type { ImportedGoogleCampaign };

// The §8 onboarding query: every non-removed campaign with its budget + channel.
// NOTE: campaign.start_date / campaign.end_date are intentionally NOT selected —
// newer Google Ads API versions reject them as "unrecognized fields", which 400s
// the whole sync. Flight dates aren't essential to a spend sync (the planner sets
// them, and channel/status/budget/spend all still import), so we omit them rather
// than couple the sync to a churning field set.
//
// §2/§5 additions: campaign.primary_status(_reasons) (the BUDGET_CONSTRAINED
// signal), and campaign_budget.reference_count / explicitly_shared / period (the
// shared badge + Daily/Total label). All are core, long-stable v24 fields.
const IMPORT_QUERY = `SELECT campaign.id, campaign.name, campaign.status,
       campaign.advertising_channel_type,
       campaign.primary_status, campaign.primary_status_reasons,
       campaign_budget.amount_micros, campaign_budget.total_amount_micros,
       campaign_budget.resource_name, campaign_budget.reference_count,
       campaign_budget.explicitly_shared, campaign_budget.period
FROM campaign
WHERE campaign.status != 'REMOVED'`;

/**
 * Campaign ids with at least one DISAPPROVED ad (§5). Disapproval lives at the
 * ad level (ad_group_ad.policy_summary.approval_status), not the campaign, so we
 * roll it up to a per-campaign flag. Best-effort: returns an empty set if the
 * read fails, so a policy-query hiccup never breaks the budget/spend sync.
 */
export async function fetchDisapprovedCampaignIds(
  cfg: GoogleAdsConfig,
  customerId: string,
): Promise<Set<string>> {
  try {
    const rows = await gaql(
      cfg,
      customerId,
      `SELECT campaign.id, ad_group_ad.policy_summary.approval_status
       FROM ad_group_ad
       WHERE ad_group_ad.policy_summary.approval_status = 'DISAPPROVED'
         AND campaign.status != 'REMOVED' AND ad_group.status != 'REMOVED'`,
    );
    const ids = new Set<string>();
    for (const r of rows) {
      const id = r.campaign?.id;
      if (id) ids.add(id);
    }
    return ids;
  } catch {
    return new Set<string>();
  }
}

/**
 * Pull every campaign in an account in one query (§8 auto-import). Daily-budget
 * campaigns carry amount_micros; total/lifetime campaigns carry
 * total_amount_micros — we surface both so the caller maps budget type without
 * a second round-trip. budgetResourceName lets the daily roll-up dedupe shared
 * budgets (multiple campaigns can point at one budget). Also folds in the §2
 * sharing/period fields and the §5 delivery signals (budget-limited from
 * primary_status_reasons, disapproved from a per-campaign ad-level roll-up).
 */
export async function importGoogleCampaigns(
  cfg: GoogleAdsConfig,
  customerId: string,
): Promise<ImportedGoogleCampaign[]> {
  const [rows, disapproved] = await Promise.all([
    gaql(cfg, customerId, IMPORT_QUERY),
    fetchDisapprovedCampaignIds(cfg, customerId),
  ]);
  const out: ImportedGoogleCampaign[] = [];
  for (const r of rows) {
    const id = r.campaign?.id;
    if (!id) continue;
    const totalMicros = r.campaignBudget?.totalAmountMicros;
    const dailyMicros = r.campaignBudget?.amountMicros;
    const hasTotal = totalMicros != null && Number(totalMicros) > 0;
    const reasons = r.campaign?.primaryStatusReasons ?? [];
    const refCount = r.campaignBudget?.referenceCount;
    out.push({
      id,
      name: r.campaign?.name ?? '',
      status: r.campaign?.status ?? 'UNKNOWN',
      channelType: r.campaign?.advertisingChannelType ?? 'UNKNOWN',
      dailyBudget: !hasTotal && dailyMicros != null ? microsToUnits(dailyMicros) : null,
      totalBudget: hasTotal ? microsToUnits(totalMicros) : null,
      budgetResourceName: r.campaignBudget?.resourceName ?? null,
      startDate: r.campaign?.startDate || null,
      endDate: r.campaign?.endDate || null,
      budgetReferenceCount: refCount != null ? Number(refCount) : null,
      budgetExplicitlyShared: r.campaignBudget?.explicitlyShared ?? null,
      budgetPeriod: r.campaignBudget?.period ?? null,
      primaryStatus: r.campaign?.primaryStatus ?? null,
      primaryStatusReasons: Array.isArray(reasons) ? reasons : [],
      budgetConstrained: reasons.includes('BUDGET_CONSTRAINED'),
      adsDisapproved: disapproved.has(id),
    });
  }
  return out;
}

/**
 * Campaign spend ($) summed per campaign over [sinceIso, untilIso] from
 * metrics.cost_micros. The date range gives a month-bounded slice (pass the
 * month window) or full-run spend (pass a wide range), so §1/§2 cross-month
 * logic ports directly — exactly like Meta's period vs run-spend pulls.
 */
export async function fetchCampaignSpend(
  cfg: GoogleAdsConfig,
  customerId: string,
  sinceIso: string,
  untilIso: string,
): Promise<Map<string, number>> {
  const rows = await gaql(
    cfg,
    customerId,
    `SELECT campaign.id, metrics.cost_micros
     FROM campaign
     WHERE segments.date BETWEEN '${sinceIso}' AND '${untilIso}'
       AND campaign.status != 'REMOVED'`,
  );
  const spend = new Map<string, number>();
  for (const r of rows) {
    const id = r.campaign?.id;
    if (!id) continue;
    spend.set(id, (spend.get(id) ?? 0) + microsToUnits(r.metrics?.costMicros));
  }
  return spend;
}

/**
 * One campaign's month-to-date delivery metrics — the inputs behind the six
 * expander tiles (delivery/reallocation spec §4). Ratios are raw fractions
 * (0–1), not percentages.
 */
export interface GoogleCampaignPeriodMetrics {
  /** Same figure fetchCampaignSpend would return for this window. */
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  /** metrics.conversions_from_interactions_rate. Stored, not derived —
   *  interactions ≠ clicks on several campaign types and we don't pull them. */
  convRate: number | null;
  /** Search/Shopping only; null everywhere else and below Google's threshold. */
  searchBudgetLostIs: number | null;
  searchRankLostIs: number | null;
}

/**
 * Read an impression-share field. Google returns these as fractions and reports
 * anything above 90% as exactly 0.9 (the display layer renders that as "≥90%").
 * Absent — which is what PMAX, Demand Gen and Display return, and what any
 * account under Google's reporting threshold returns — stays NULL rather than
 * becoming 0: an unavailable impression share and a zero impression share mean
 * opposite things, and a zero here would read as "losing nothing to budget",
 * which is exactly the wrong answer to "can this campaign absorb more money".
 * Exported for the unit tests; not part of the query layer's contract.
 */
export function impressionShareValue(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

/**
 * Month-to-date metrics per campaign over [sinceIso, untilIso] — spend PLUS the
 * §4 tile inputs, in ONE account-wide request. This replaces the period
 * fetchCampaignSpend call inside the sync rather than adding to it: same query
 * shape, same window, more SELECT columns. Two consequences, both deliberate:
 * the tiles cover exactly the window pacerActual does (so a tile can never
 * disagree with the spend above it), and opening N row expanders costs zero
 * Google calls because everything is already synced.
 *
 * Unsegmented by date on purpose. Impression share is a ratio over eligible
 * impressions, so it only has meaning at the range level — summing or averaging
 * per-day values produces a number that means nothing. With no segments Google
 * returns ONE row per campaign, so the ratios are simply read; the counters are
 * still accumulated defensively in case that ever stops being true.
 */
export async function fetchCampaignPeriodMetrics(
  cfg: GoogleAdsConfig,
  customerId: string,
  sinceIso: string,
  untilIso: string,
): Promise<Map<string, GoogleCampaignPeriodMetrics>> {
  const rows = await gaql(
    cfg,
    customerId,
    `SELECT campaign.id, metrics.cost_micros, metrics.impressions, metrics.clicks,
            metrics.conversions, metrics.conversions_from_interactions_rate,
            metrics.search_budget_lost_impression_share,
            metrics.search_rank_lost_impression_share
     FROM campaign
     WHERE segments.date BETWEEN '${sinceIso}' AND '${untilIso}'
       AND campaign.status != 'REMOVED'`,
  );
  const out = new Map<string, GoogleCampaignPeriodMetrics>();
  for (const r of rows) {
    const id = r.campaign?.id;
    if (!id) continue;
    const m = r.metrics ?? {};
    const prev = out.get(id);
    out.set(id, {
      spend: (prev?.spend ?? 0) + microsToUnits(m.costMicros),
      impressions: (prev?.impressions ?? 0) + (Math.trunc(Number(m.impressions ?? 0)) || 0),
      clicks: (prev?.clicks ?? 0) + (Math.trunc(Number(m.clicks ?? 0)) || 0),
      conversions: (prev?.conversions ?? 0) + (Number(m.conversions ?? 0) || 0),
      convRate:
        m.conversionsFromInteractionsRate != null
          ? Number(m.conversionsFromInteractionsRate) || 0
          : (prev?.convRate ?? null),
      searchBudgetLostIs:
        impressionShareValue(m.searchBudgetLostImpressionShare) ??
        prev?.searchBudgetLostIs ??
        null,
      searchRankLostIs:
        impressionShareValue(m.searchRankLostImpressionShare) ??
        prev?.searchRankLostIs ??
        null,
    });
  }
  return out;
}

/**
 * Campaign spend ($) per day over [sinceIso, untilIso] (segments.date), for
 * the pacing-health engine's daily spend series. Returns campaignId →
 * ordered {date, spend} rows.
 */
export async function fetchCampaignDailySpend(
  cfg: GoogleAdsConfig,
  customerId: string,
  sinceIso: string,
  untilIso: string,
): Promise<Map<string, { date: string; spend: number }[]>> {
  const rows = await gaql(
    cfg,
    customerId,
    `SELECT campaign.id, segments.date, metrics.cost_micros
     FROM campaign
     WHERE segments.date BETWEEN '${sinceIso}' AND '${untilIso}'
       AND campaign.status != 'REMOVED'
     ORDER BY segments.date ASC`,
  );
  const byCampaign = new Map<string, { date: string; spend: number }[]>();
  for (const r of rows) {
    const id = r.campaign?.id;
    const date = r.segments?.date;
    if (!id || !date) continue;
    const list = byCampaign.get(id) ?? [];
    list.push({ date, spend: microsToUnits(r.metrics?.costMicros) });
    byCampaign.set(id, list);
  }
  return byCampaign;
}

/**
 * Campaign ids that restrict days/dayparts via an ad schedule. Post
 * June 2026, scheduled campaigns pace the full monthly cap into active days,
 * so calendar-day pacing math misreads them — the sync badges them via
 * googleHasAdSchedule. Best-effort: a failure returns an empty set and the
 * flags are simply left as they were.
 */
export async function fetchAdScheduleCampaignIds(
  cfg: GoogleAdsConfig,
  customerId: string,
): Promise<Set<string> | null> {
  try {
    const rows = await gaql(
      cfg,
      customerId,
      `SELECT campaign.id FROM ad_schedule_view
       WHERE campaign.status != 'REMOVED'`,
    );
    const ids = new Set<string>();
    for (const r of rows) {
      const id = r.campaign?.id;
      if (id) ids.add(id);
    }
    return ids;
  } catch {
    return null;
  }
}

/**
 * §9 — daily-budget change history within [sinceIso, untilIso], keyed by budget
 * resource name, as rate segments for `computeProratedCeiling`. Each amount
 * change becomes a {date, dailyRate} boundary; the segment array is seeded at
 * the month start with the rate in effect then (the earliest change's OLD
 * amount), so the prorated ceiling reflects the whole month. Best-effort:
 * change_event has a limited retention window and strict query rules, so a
 * failure just returns an empty map and the ceiling falls back to daily × 30.4.
 */
export async function fetchBudgetRateSegments(
  cfg: GoogleAdsConfig,
  customerId: string,
  sinceIso: string,
  untilIso: string,
): Promise<Map<string, BudgetRateSegment[]>> {
  const byBudget = new Map<string, BudgetRateSegment[]>();
  try {
    const rows = await gaql(
      cfg,
      customerId,
      `SELECT change_event.change_date_time, change_event.changed_fields,
              change_event.old_resource, change_event.new_resource,
              change_event.change_resource_type
       FROM change_event
       WHERE change_event.change_date_time >= '${sinceIso}'
         AND change_event.change_date_time <= '${untilIso} 23:59:59'
         AND change_event.change_resource_type = 'CAMPAIGN_BUDGET'
       ORDER BY change_event.change_date_time ASC
       LIMIT 1000`,
    );
    // Collect raw changes per budget (date, old rate, new rate), in order.
    const raw = new Map<string, { date: string; oldRate: number; newRate: number }[]>();
    for (const r of rows) {
      const ce = r.changeEvent;
      const resourceName =
        ce?.newResource?.campaignBudget?.resourceName ??
        ce?.oldResource?.campaignBudget?.resourceName;
      const newMicros = ce?.newResource?.campaignBudget?.amountMicros;
      const oldMicros = ce?.oldResource?.campaignBudget?.amountMicros;
      // Only amount changes matter for the ceiling; skip if no new amount.
      if (!resourceName || newMicros == null) continue;
      const date = (ce?.changeDateTime ?? '').slice(0, 10);
      if (!date) continue;
      const list = raw.get(resourceName) ?? [];
      list.push({
        date,
        oldRate: oldMicros != null ? microsToUnits(oldMicros) : microsToUnits(newMicros),
        newRate: microsToUnits(newMicros),
      });
      raw.set(resourceName, list);
    }
    // Build month-spanning segments: seed at month start with the first
    // change's OLD rate, then one boundary per change at its date/new rate.
    for (const [resourceName, changes] of raw) {
      if (changes.length === 0) continue;
      const segments: BudgetRateSegment[] = [{ date: sinceIso, dailyRate: changes[0].oldRate }];
      for (const c of changes) segments.push({ date: c.date, dailyRate: c.newRate });
      byBudget.set(resourceName, segments);
    }
  } catch {
    // best-effort — empty map means the ceiling uses current daily × 30.4
  }
  return byBudget;
}

// ── Orchestration (server): links the GAQL reads to the pacer DB rows ──

function monthEndIso(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * The month window a Google spend read covers: the 1st through the DATA EDGE —
 * the last whole day, i.e. yesterday in a live month and the month end in a
 * closed one. Never today.
 *
 * This is the same edge `resolveClock` anchors every day count to, and the two
 * have to agree. Pulling spend through today while counting days through
 * yesterday puts a partial day in the numerator of
 * `(target − spent) ÷ remaining days` and not the denominator, so the
 * recommended daily slides down through the afternoon as spend accrues against
 * a day count that hasn't moved — the exact drift whole-day anchoring exists to
 * remove — and the pace badge reads a campaign as further ahead than it is.
 *
 * Today's spend is not lost: it is pulled by the daily-spend series (which does
 * run through today) and surfaced as the "today so far" figure, deliberately
 * separate from every finalized number.
 *
 * `empty` marks a window with no finalized day in it at all — the 1st of the
 * month, or a month that hasn't started. Callers must skip the read rather than
 * send Google a backwards date range.
 *
 * Meta deliberately keeps its own window through today: its pacer runs on
 * fractional days and a rolling 7-day average, so spend-to-this-instant is the
 * consistent choice there. This edge is Google-only, like the whole-day helpers.
 */
export function periodWindow(
  period: string,
  todayIso: string,
): { since: string; until: string; empty: boolean } {
  const since = `${period}-01`;
  const monthEnd = monthEndIso(period);
  const dataEdge = addDaysIso(todayIso, -1);
  const until = dataEdge < monthEnd ? dataEdge : monthEnd;
  return { since, until, empty: until < since };
}

// Wide start for the full-run spend pull — a campaign's all-time cost for the §2
// cross-month full-run figure (mirrors Meta's date_preset=maximum).
const RUN_SPEND_SINCE = '2000-01-01';

export interface GoogleSyncAdResult {
  adId: string;
  name: string;
  matched: boolean;
  googleCampaignId: string | null;
  spend: number | null;
}

export interface GoogleSyncResult {
  ok: true;
  customerId: string;
  since: string;
  until: string;
  total: number;
  matched: number;
  results: GoogleSyncAdResult[];
}

/**
 * Sync actual spend + campaign status/dates/budget onto the account's LINKED
 * Google pacer lines for a period. Mirrors syncPeriodFromMeta: links by
 * googleCampaignId, else case-insensitive campaign name; writes pacerActual
 * (period slice), pacerRunSpend (all-time), googleEffectiveStatus,
 * googleStart/EndDate, googleChannelType, googleBudgetResourceName, and (for
 * daily campaigns) pacerDailyBudget. Never touches `allocation` (planned intent).
 */
/**
 * The period read: spend per campaign, plus the §4 tile metrics when they can be
 * had. One request in the normal case.
 *
 * If the richer column set is ever rejected — a field renamed out from under us,
 * an account without impression-share access — this falls back to the plain
 * spend query and reports `metrics: null`. Degrading that way is the point: an
 * empty set of tiles is a thinner expander, but a missing pacerActual is a
 * broken card and a broken push. `metrics: null` also tells the writer to leave
 * whatever was synced last time alone, so a failed pull never overwrites real
 * numbers with zeros — the stale as-of stamp is what surfaces the failure.
 */
async function fetchPeriodSpendAndMetrics(
  cfg: GoogleAdsConfig,
  customerId: string,
  sinceIso: string,
  untilIso: string,
  empty: boolean,
): Promise<{
  spend: Map<string, number>;
  metrics: Map<string, GoogleCampaignPeriodMetrics> | null;
}> {
  // No finalized day in the window — the 1st of the month, or a month that
  // hasn't started. Every campaign is legitimately at $0 spend, so report that
  // instead of asking Google about a backwards date range. `metrics` is an empty
  // map rather than null: this is a successful read of nothing, so the tiles
  // should be cleared and stamped, not left showing last month's numbers.
  if (empty) return { spend: new Map(), metrics: new Map() };
  try {
    const metrics = await fetchCampaignPeriodMetrics(cfg, customerId, sinceIso, untilIso);
    const spend = new Map<string, number>();
    for (const [id, m] of metrics) spend.set(id, m.spend);
    return { spend, metrics };
  } catch {
    return {
      spend: await fetchCampaignSpend(cfg, customerId, sinceIso, untilIso),
      metrics: null,
    };
  }
}

export async function syncPeriodFromGoogle(
  accountKey: string,
  period: string,
  todayIso: string,
): Promise<GoogleSyncResult> {
  const { cfg, customerId } = await getGoogleCustomer(accountKey);
  const plan = await getOrCreatePlan(accountKey);
  const ads = await prisma.metaAdsPacerAd.findMany({
    where: { planId: plan.id, period, platform: 'google' },
    select: { id: true, name: true, googleCampaignId: true },
  });
  const { since, until, empty } = periodWindow(period, todayIso);
  // Full last day of the month — the ceiling is a month-end cap, so it spans the
  // whole month, not just the elapsed-to-`until` window.
  const monthEnd = monthEndIso(period);

  const [campaigns, periodRead, runSpend, rateSegments, scheduledIds] =
    await Promise.all([
      importGoogleCampaigns(cfg, customerId),
      fetchPeriodSpendAndMetrics(cfg, customerId, since, until, empty),
      // Full-run spend rides the same data edge: a run total that includes
      // today while the month total doesn't would put two different "now"s on
      // one row.
      (empty
        ? Promise.resolve(new Map<string, number>())
        : fetchCampaignSpend(cfg, customerId, RUN_SPEND_SINCE, until)
      ).catch(() => new Map<string, number>()),
      fetchBudgetRateSegments(cfg, customerId, since, monthEnd).catch(
        () => new Map<string, BudgetRateSegment[]>(),
      ),
      // Ad-schedule (day-parting) badge — null on failure = leave flags alone.
      fetchAdScheduleCampaignIds(cfg, customerId),
    ]);
  const byId = new Map(campaigns.map((c) => [c.id, c]));
  const byName = new Map(campaigns.map((c) => [c.name.toLowerCase(), c]));

  const ops: ReturnType<typeof prisma.metaAdsPacerAd.update>[] = [];
  const results: GoogleSyncAdResult[] = [];
  for (const ad of ads) {
    let camp = ad.googleCampaignId ? byId.get(ad.googleCampaignId) : undefined;
    if (!camp && ad.name) camp = byName.get(ad.name.toLowerCase());
    if (!camp) {
      results.push({
        adId: ad.id,
        name: ad.name,
        matched: false,
        googleCampaignId: ad.googleCampaignId,
        spend: null,
      });
      continue;
    }
    const spend = periodRead.spend.get(camp.id) ?? 0;
    // §4 tiles. A campaign missing from the metrics map genuinely had no
    // delivery in the window, so its counters are zero — but its RATIOS stay
    // null, because "no impressions were eligible" is not "lost nothing to
    // budget". When the metrics read failed outright (metrics === null) we write
    // nothing at all and the previous values survive with their old as-of stamp.
    const metrics = periodRead.metrics?.get(camp.id) ?? null;
    const metricFields = periodRead.metrics
      ? {
          googleImpressions: metrics?.impressions ?? 0,
          googleClicks: metrics?.clicks ?? 0,
          googleConversions: (metrics?.conversions ?? 0).toFixed(2),
          googleConvRate: metrics?.convRate != null ? metrics.convRate.toFixed(6) : null,
          googleSearchBudgetLostIs:
            metrics?.searchBudgetLostIs != null
              ? metrics.searchBudgetLostIs.toFixed(6)
              : null,
          googleSearchRankLostIs:
            metrics?.searchRankLostIs != null ? metrics.searchRankLostIs.toFixed(6) : null,
          googleMetricsAsOf: until,
        }
      : {};
    // §9 ceiling: daily campaigns only (a total budget has no daily-rate cap).
    // Reprorated across mid-month rate changes; falls back to daily × 30.4.
    const ceiling =
      camp.dailyBudget != null
        ? computeProratedCeiling(
            (camp.budgetResourceName && rateSegments.get(camp.budgetResourceName)) || [],
            camp.dailyBudget,
            since,
            monthEnd,
          )
        : null;
    ops.push(
      prisma.metaAdsPacerAd.update({
        where: { id: ad.id },
        data: {
          googleCampaignId: camp.id,
          googleEffectiveStatus: camp.status,
          // Store the display rollup group (Search/Display/…), consistent with
          // the importer; mapChannelGroup also normalizes the raw enum.
          googleChannelType: mapChannelGroup(camp.channelType),
          googleBudgetResourceName: camp.budgetResourceName,
          googleStartDate: camp.startDate,
          googleEndDate: camp.endDate,
          googleBudgetReferenceCount: camp.budgetReferenceCount,
          googleBudgetExplicitlyShared: camp.budgetExplicitlyShared,
          googleBudgetPeriod: camp.budgetPeriod,
          googlePrimaryStatus: camp.primaryStatus,
          googlePrimaryStatusReasons: JSON.stringify(camp.primaryStatusReasons ?? []),
          googleBudgetConstrained: camp.budgetConstrained,
          googleAdsDisapproved: camp.adsDisapproved,
          ...(scheduledIds != null
            ? { googleHasAdSchedule: scheduledIds.has(camp.id) }
            : {}),
          googleProratedCeiling: ceiling != null ? ceiling.toFixed(2) : null,
          ...metricFields,
          pacerActual: spend.toFixed(2),
          pacerRunSpend: (runSpend.get(camp.id) ?? 0).toFixed(2),
          ...(camp.dailyBudget != null
            ? { pacerDailyBudget: String(camp.dailyBudget) }
            : {}),
          pacerSyncedAt: new Date(),
        },
      }),
    );
    results.push({
      adId: ad.id,
      name: ad.name,
      matched: true,
      googleCampaignId: camp.id,
      spend,
    });
  }
  if (ops.length > 0) await prisma.$transaction(ops);

  // Daily spend series (pacing-health engine): per-day cost for every linked
  // campaign — 90-day backfill on the first sync, a short trailing window
  // after. Best-effort: never aborts the month sync.
  try {
    const linked = results.filter((r) => r.matched && r.googleCampaignId);
    if (linked.length > 0) {
      const window = await dailySpendSyncWindow(plan.id, 'google', todayIso);
      const daily = await fetchCampaignDailySpend(
        cfg,
        customerId,
        window.since,
        window.until,
      );
      const budgetByCampaign = new Map(
        campaigns.map((c) => [c.id, c.dailyBudget] as const),
      );
      const linkedIds = new Set(linked.map((r) => r.googleCampaignId as string));
      const rows: DailySpendWriteRow[] = [];
      for (const [campaignId, points] of daily) {
        if (!linkedIds.has(campaignId)) continue;
        const dailyBudget = budgetByCampaign.get(campaignId) ?? null;
        for (const p of points) {
          rows.push({ objectId: campaignId, date: p.date, spend: p.spend, dailyBudget });
        }
      }
      if (rows.length > 0) await writeDailySpendSeries(plan.id, 'google', window, rows);
    }
  } catch {
    // Series sync is additive — the cards fall back gracefully.
  }

  return {
    ok: true,
    customerId,
    since,
    until,
    total: ads.length,
    matched: results.filter((r) => r.matched).length,
    results,
  };
}

export interface GoogleImportPreview {
  customerId: string;
  diff: ImportDiff;
  totalCampaigns: number;
}

/**
 * Preview the §8 auto-import: pull all campaigns and diff them against the
 * account's existing Google cards (adds / removes / changes) for the user to
 * CONFIRM. Read-only — never creates or overwrites cards, so a renamed/paused
 * campaign can't wipe planner work. Applying confirmed adds is the planner's job.
 */
export async function previewGoogleImport(
  accountKey: string,
  period: string,
): Promise<GoogleImportPreview> {
  const { cfg, customerId } = await getGoogleCustomer(accountKey);
  const plan = await getOrCreatePlan(accountKey);
  const campaigns = await importGoogleCampaigns(cfg, customerId);
  const existing = await prisma.metaAdsPacerAd.findMany({
    // Only diff against Google lines — Meta rows must never appear as
    // adds/removes in the Google import preview.
    where: { planId: plan.id, period, platform: 'google' },
    select: {
      id: true,
      name: true,
      platform: true,
      googleCampaignId: true,
      budgetType: true,
    },
  });
  const diff = reconcileImport(campaigns, existing as unknown as PacerAd[]);
  return { customerId, diff, totalCampaigns: campaigns.length };
}

// ── Discovery + adopt (mirrors Meta's discoverAdSets / importAdSets) ──

export interface DiscoveredGoogleCampaign {
  id: string;
  name: string;
  /** Raw advertising_channel_type enum (e.g. SEARCH). */
  channelType: string;
  /** Display rollup group (Search/Display/Video/Shopping/PMax/Other). */
  channelGroup: string;
  /** Raw campaign status (ENABLED / PAUSED). */
  effectiveStatus: string;
  /** True when actively delivering (status ENABLED). */
  active: boolean;
  budgetType: 'Daily' | 'Lifetime';
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  /** Spend in the requested period ($). */
  periodSpend: number;
  /** Already linked to a Google pacer row in THIS period — excluded from import. */
  alreadyLinked: boolean;
  /** The planner status this campaign would map to on import. */
  suggestedStatus: string;
  /** §2 genuinely shared (reference_count > 1) + the group size. */
  shared: boolean;
  sharedCount: number | null;
  /** §5 delivery signals (opposite remedies — raise budget vs fix ads). */
  budgetConstrained: boolean;
  adsDisapproved: boolean;
}

export interface DiscoverGoogleResult {
  ok: true;
  customerId: string;
  since: string;
  until: string;
  campaigns: DiscoveredGoogleCampaign[];
}

/**
 * List every non-removed campaign in the account's Google Ads customer, enriched
 * with budget + period spend, and flagged for the ones already linked to a Google
 * pacer row in `period`. Read-only — feeds the "Import campaigns" modal. Mirrors
 * discoverAdSets. (Flight dates aren't pulled — newer API versions reject the
 * campaign date fields; the planner sets flight dates.)
 */
export async function discoverGoogleCampaigns(
  accountKey: string,
  period: string,
  todayIso: string,
): Promise<DiscoverGoogleResult> {
  const { cfg, customerId } = await getGoogleCustomer(accountKey);
  const { since, until, empty } = periodWindow(period, todayIso);

  const [campaigns, periodSpend] = await Promise.all([
    importGoogleCampaigns(cfg, customerId),
    empty
      ? new Map<string, number>()
      : fetchCampaignSpend(cfg, customerId, since, until).catch(() => new Map<string, number>()),
  ]);

  const plan = await prisma.metaAdsPacerPlan.findUnique({
    where: { accountKey },
    select: { id: true },
  });
  const linkedRows = plan
    ? await prisma.metaAdsPacerAd.findMany({
        where: { planId: plan.id, period, platform: 'google', googleCampaignId: { not: null } },
        select: { googleCampaignId: true },
      })
    : [];
  const linkedIds = new Set(
    linkedRows.map((r) => r.googleCampaignId).filter((id): id is string => !!id),
  );

  const out: DiscoveredGoogleCampaign[] = campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    channelType: c.channelType,
    channelGroup: mapChannelGroup(c.channelType),
    effectiveStatus: c.status,
    active: (c.status ?? '').toUpperCase() === 'ENABLED',
    budgetType: mapGoogleBudgetType(c.dailyBudget, c.totalBudget),
    dailyBudget: c.dailyBudget,
    lifetimeBudget: c.totalBudget,
    periodSpend: periodSpend.get(c.id) ?? 0,
    alreadyLinked: linkedIds.has(c.id),
    suggestedStatus: googleStatusToAdStatus(c.status),
    shared: isSharedBudget(c.budgetReferenceCount),
    sharedCount: isSharedBudget(c.budgetReferenceCount) ? c.budgetReferenceCount : null,
    budgetConstrained: c.budgetConstrained,
    adsDisapproved: c.adsDisapproved,
  }));

  return { ok: true, customerId, since, until, campaigns: out };
}

export interface ImportedGoogleAdSummary {
  adId: string;
  campaignId: string;
  name: string;
  status: string;
}

export interface ImportGoogleResult {
  ok: true;
  imported: ImportedGoogleAdSummary[];
  /** Ids requested but skipped (not found, or already linked in this period). */
  skipped: string[];
}

export interface ImportGoogleAssignments {
  ownerUserId?: string | null;
  designerUserId?: string | null;
  accountRepUserId?: string | null;
}

/**
 * Adopt the chosen Google campaigns as new pacer rows in `period`, born already
 * linked (googleCampaignId) and synced (period spend, status, budget, channel).
 * Mirrors importAdSets. allocation is left null (the planner sets the monthly
 * target; observed budget is a suggestion, not intent).
 */
export async function importGoogleCampaignsAsRows(
  accountKey: string,
  planId: string,
  period: string,
  todayIso: string,
  campaignIds: string[],
  assignments: ImportGoogleAssignments = {},
): Promise<ImportGoogleResult> {
  const requested = Array.from(new Set(campaignIds.filter(Boolean)));
  if (requested.length === 0) return { ok: true, imported: [], skipped: [] };

  const { cfg, customerId } = await getGoogleCustomer(accountKey);
  const { since, until, empty } = periodWindow(period, todayIso);

  const [campaigns, periodSpend] = await Promise.all([
    importGoogleCampaigns(cfg, customerId),
    empty
      ? new Map<string, number>()
      : fetchCampaignSpend(cfg, customerId, since, until).catch(() => new Map<string, number>()),
  ]);
  const byId = new Map(campaigns.map((c) => [c.id, c]));

  const linkedRows = await prisma.metaAdsPacerAd.findMany({
    where: { planId, period, platform: 'google', googleCampaignId: { not: null } },
    select: { googleCampaignId: true },
  });
  const linkedIds = new Set(
    linkedRows.map((r) => r.googleCampaignId).filter((id): id is string => !!id),
  );

  // Append after this period's existing Google rows.
  const maxPos = await prisma.metaAdsPacerAd.aggregate({
    where: { planId, period, platform: 'google' },
    _max: { position: true },
  });
  let position = (maxPos._max.position ?? -1) + 1;

  const syncedAt = new Date();
  const creates: Prisma.MetaAdsPacerAdCreateManyInput[] = [];
  const imported: ImportedGoogleAdSummary[] = [];
  const skipped: string[] = [];

  for (const id of requested) {
    const c = byId.get(id);
    if (!c || linkedIds.has(id)) {
      skipped.push(id);
      continue;
    }
    const budgetType = mapGoogleBudgetType(c.dailyBudget, c.totalBudget);
    const status = googleStatusToAdStatus(c.status);
    const spend = periodSpend.get(c.id) ?? 0;
    // §9 ceiling on import: daily only, daily × 30.4 (a freshly-imported row has
    // no allocation yet; sync reprorates it against change history next run).
    const ceiling =
      c.dailyBudget != null ? Number((c.dailyBudget * 30.4).toFixed(2)) : null;
    const adId = randomUUID();
    creates.push({
      id: adId,
      planId,
      platform: 'google',
      position: position++,
      name: c.name,
      period,
      ownerUserId: assignments.ownerUserId ?? null,
      designerUserId: assignments.designerUserId ?? null,
      accountRepUserId: assignments.accountRepUserId ?? null,
      budgetType,
      adStatus: status,
      // See importAdSets: never seed allocation from observed budget.
      allocation: null,
      googleCampaignId: c.id,
      googleChannelType: mapChannelGroup(c.channelType),
      googleEffectiveStatus: c.status,
      googleBudgetResourceName: c.budgetResourceName,
      googleBudgetReferenceCount: c.budgetReferenceCount,
      googleBudgetExplicitlyShared: c.budgetExplicitlyShared,
      googleBudgetPeriod: c.budgetPeriod,
      googlePrimaryStatus: c.primaryStatus,
      googleBudgetConstrained: c.budgetConstrained,
      googleAdsDisapproved: c.adsDisapproved,
      googleProratedCeiling: ceiling != null ? ceiling.toFixed(2) : null,
      pacerActual: spend.toFixed(2),
      pacerDailyBudget:
        budgetType !== 'Lifetime' && c.dailyBudget != null ? c.dailyBudget.toFixed(2) : null,
      pacerSyncedAt: syncedAt,
    });
    imported.push({ adId, campaignId: c.id, name: c.name, status });
  }

  if (creates.length > 0) {
    await prisma.metaAdsPacerAd.createMany({ data: creates });
  }

  return { ok: true, imported, skipped };
}
