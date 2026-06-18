/**
 * Meta (Facebook) Ads performance report — GET /api/reporting/ads
 *
 * Port of Oz Dealer Tools' FacebookAdsReport controller. Resolves the active
 * account → its Meta ad account + reporting margin → pulls the live Insights
 * breakdowns → grosses up the cost fields with the per-account margin → returns
 * report-shaped JSON. There is no metrics DB; every load is a live pull.
 *
 * Query params (all optional except accountKey):
 *   accountKey   — the sub-account to report on (required; scoped per caller)
 *   start_date   — YYYY-MM-DD, defaults to the 1st of the current month
 *   end_date     — YYYY-MM-DD, defaults to today
 *   compare_to   — none | previous_period | previous_month | previous_year | custom
 *   compare_start / compare_end — YYYY-MM-DD when compare_to=custom
 *
 * Defaults match Oz: month-to-date (Y-m-01 → today). Margin markup + comparison
 * window resolution are the shared, unit-tested utilities in src/lib/reporting.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../_lib/guard';
import { canAccessAccount } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  MetaSyncError,
  getAdAccountConfig,
  getAccountMetrics,
  getCampaignPerformance,
  getDevicePerformance,
  getDailyPerformance,
  getDemographics,
  getCampaignCreatives,
} from '@/lib/integrations/meta-ads';
import { applyMetaMargins } from '@/lib/reporting/margins';
import { resolveComparisonDates } from '@/lib/reporting/comparison';

export const dynamic = 'force-dynamic';

/** YYYY-MM-DD in server-local time. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** First day of the current month, YYYY-MM-01 (server-local). */
function monthStartIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const { ctx, error } = await requireReportingAccess();
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const accountKey = sp.get('accountKey');
  if (!accountKey) {
    return NextResponse.json(
      { error: 'Missing accountKey' },
      { status: 400 },
    );
  }
  // ctx.accountKeys === null means unrestricted; otherwise it's a non-empty
  // scope (the guard 403s an empty scope) the account must fall inside.
  if (!canAccessAccount(ctx.accountKeys, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const startDate = sp.get('start_date') || monthStartIso();
  const endDate = sp.get('end_date') || todayIso();
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
    return NextResponse.json(
      { error: 'start_date / end_date must be YYYY-MM-DD' },
      { status: 400 },
    );
  }
  const compareTo = sp.get('compare_to') || 'none';

  try {
    const account = await prisma.account.findUnique({
      where: { key: accountKey },
      select: { dealer: true, facebookAdsMargin: true },
    });
    const margin = account?.facebookAdsMargin ?? 0;

    // Resolves the agency token + this account's ad-account id; throws a
    // MetaSyncError (not_configured / no_ad_account) the catch maps to a status.
    const { cfg, adAccountId } = await getAdAccountConfig(accountKey);

    // Primary period. Creatives are best-effort (the lib already swallows its
    // own errors and returns {}), so a partial Graph failure still renders.
    const [accountMetrics, campaigns, devices, daily, demographics, creatives] =
      await Promise.all([
        getAccountMetrics(cfg, adAccountId, startDate, endDate),
        getCampaignPerformance(cfg, adAccountId, startDate, endDate),
        getDevicePerformance(cfg, adAccountId, startDate, endDate),
        getDailyPerformance(cfg, adAccountId, startDate, endDate),
        getDemographics(cfg, adAccountId, startDate, endDate),
        getCampaignCreatives(cfg, adAccountId, startDate, endDate),
      ]);

    // Comparison period (optional). Mirrors Oz: account metrics + campaigns +
    // daily for the prior window, same margin applied.
    const comparison = resolveComparisonDates(
      startDate,
      endDate,
      compareTo,
      sp.get('compare_start'),
      sp.get('compare_end'),
    );
    let compare = null;
    if (comparison.start && comparison.end) {
      const [cMetrics, cCampaigns, cDaily] = await Promise.all([
        getAccountMetrics(cfg, adAccountId, comparison.start, comparison.end),
        getCampaignPerformance(cfg, adAccountId, comparison.start, comparison.end),
        getDailyPerformance(cfg, adAccountId, comparison.start, comparison.end),
      ]);
      compare = {
        startDate: comparison.start,
        endDate: comparison.end,
        label: comparison.label,
        accountMetrics: applyMetaMargins(cMetrics, margin),
        campaigns: cCampaigns.map((c) => applyMetaMargins(c, margin)),
        daily: cDaily.map((d) => applyMetaMargins(d, margin)),
      };
    }

    return NextResponse.json({
      accountKey,
      dealer: account?.dealer ?? accountKey,
      adAccountId,
      margin,
      startDate,
      endDate,
      compareTo,
      accountMetrics: applyMetaMargins(accountMetrics, margin),
      campaigns: campaigns.map((c) => applyMetaMargins(c, margin)),
      devices: devices.map((d) => applyMetaMargins(d, margin)),
      daily: daily.map((d) => applyMetaMargins(d, margin)),
      demographics: demographics.map((d) => applyMetaMargins(d, margin)),
      campaignCreatives: creatives,
      compare,
    });
  } catch (err) {
    if (err instanceof MetaSyncError) {
      // Config / linking problems are the caller's to fix (400 + code so the
      // UI can show the right empty state); upstream Graph failures → 502.
      const status = err.code === 'graph_error' ? 502 : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    // eslint-disable-next-line no-console
    console.error('[reporting/ads] failed', err);
    return NextResponse.json({ error: 'Report failed' }, { status: 500 });
  }
}
