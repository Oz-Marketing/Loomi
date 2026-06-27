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
import { reconcileImport, type ImportDiff } from '@/lib/ad-pacer/google-pacer-calc';
import type { PacerAd } from '@/lib/ad-pacer/types';
import { prisma } from '@/lib/prisma';
import { getOrCreatePlan } from '@/lib/meta-ads-pacer';

export { getGoogleCustomer, isGoogleAdsConfigured, GoogleAdsError };
export type { ImportedGoogleCampaign };

// The §8 onboarding query: every non-removed campaign with its budget + channel.
const IMPORT_QUERY = `SELECT campaign.id, campaign.name, campaign.status,
       campaign.advertising_channel_type, campaign.start_date, campaign.end_date,
       campaign_budget.amount_micros, campaign_budget.total_amount_micros,
       campaign_budget.resource_name
FROM campaign
WHERE campaign.status != 'REMOVED'`;

/**
 * Pull every campaign in an account in one query (§8 auto-import). Daily-budget
 * campaigns carry amount_micros; total/lifetime campaigns carry
 * total_amount_micros — we surface both so the caller maps budget type without
 * a second round-trip. budgetResourceName lets the daily roll-up dedupe shared
 * budgets (multiple campaigns can point at one budget).
 */
export async function importGoogleCampaigns(
  cfg: GoogleAdsConfig,
  customerId: string,
): Promise<ImportedGoogleCampaign[]> {
  const rows = await gaql(cfg, customerId, IMPORT_QUERY);
  const out: ImportedGoogleCampaign[] = [];
  for (const r of rows) {
    const id = r.campaign?.id;
    if (!id) continue;
    const totalMicros = r.campaignBudget?.totalAmountMicros;
    const dailyMicros = r.campaignBudget?.amountMicros;
    const hasTotal = totalMicros != null && Number(totalMicros) > 0;
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

// ── Orchestration (server): links the GAQL reads to the pacer DB rows ──

function periodWindow(period: string, todayIso: string): { since: string; until: string } {
  const [y, m] = period.split('-').map(Number);
  const since = `${period}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthEnd = `${period}-${String(lastDay).padStart(2, '0')}`;
  const until = todayIso < monthEnd ? todayIso : monthEnd;
  return { since, until };
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
  const { since, until } = periodWindow(period, todayIso);

  const [campaigns, periodSpend, runSpend] = await Promise.all([
    importGoogleCampaigns(cfg, customerId),
    fetchCampaignSpend(cfg, customerId, since, until),
    fetchCampaignSpend(cfg, customerId, RUN_SPEND_SINCE, until).catch(
      () => new Map<string, number>(),
    ),
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
    const spend = periodSpend.get(camp.id) ?? 0;
    ops.push(
      prisma.metaAdsPacerAd.update({
        where: { id: ad.id },
        data: {
          googleCampaignId: camp.id,
          googleEffectiveStatus: camp.status,
          googleChannelType: camp.channelType,
          googleBudgetResourceName: camp.budgetResourceName,
          googleStartDate: camp.startDate,
          googleEndDate: camp.endDate,
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
