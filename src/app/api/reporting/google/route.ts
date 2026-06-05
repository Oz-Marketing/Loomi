/**
 * Google Ads performance report — GET /api/reporting/google
 *
 * Port of Oz Dealer Tools' GoogleAdsReport controller. Resolves the active
 * account → its Google customer id + reporting margin → pulls live GAQL data →
 * grosses up the cost fields → returns report-shaped JSON. No metrics DB.
 *
 * Query params (all optional except accountKey):
 *   accountKey   — the sub-account to report on (required; scoped per caller)
 *   start_date   — YYYY-MM-DD, defaults to the 1st of the current month (Oz)
 *   end_date     — YYYY-MM-DD, defaults to today
 *   compare_to   — none | previous_period | previous_month | previous_year | custom
 *   compare_start / compare_end — YYYY-MM-DD when compare_to=custom
 *
 * Keywords / locations / auction-insights are wrapped individually so a partial
 * API failure still renders the rest (Oz parity).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../_lib/guard';
import { canAccessAccount } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  GoogleAdsError,
  getGoogleCustomer,
  getAccountMetrics,
  getCampaignPerformance,
  getDevicePerformance,
  getDailyPerformance,
  getTopSearchTerms,
  getKeywordPerformance,
  getLocationPerformance,
  getAuctionInsights,
} from '@/lib/integrations/google-ads';
import { applyGoogleMargins } from '@/lib/reporting/margins';
import { resolveComparisonDates } from '@/lib/reporting/comparison';

export const dynamic = 'force-dynamic';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
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
  if (!accountKey) return NextResponse.json({ error: 'Missing accountKey' }, { status: 400 });
  if (!canAccessAccount(ctx.accountKeys, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const startDate = sp.get('start_date') || monthStartIso();
  const endDate = sp.get('end_date') || todayIso();
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
    return NextResponse.json({ error: 'start_date / end_date must be YYYY-MM-DD' }, { status: 400 });
  }
  const compareTo = sp.get('compare_to') || 'none';

  try {
    const account = await prisma.account.findUnique({
      where: { key: accountKey },
      select: { dealer: true, googleAdsMargin: true },
    });
    const margin = account?.googleAdsMargin ?? 0;
    const { cfg, customerId } = await getGoogleCustomer(accountKey);

    // Core sections (fatal on failure — these define the report).
    const [accountMetrics, campaigns, devices, daily, searchTerms] = await Promise.all([
      getAccountMetrics(cfg, customerId, startDate, endDate),
      getCampaignPerformance(cfg, customerId, startDate, endDate),
      getDevicePerformance(cfg, customerId, startDate, endDate),
      getDailyPerformance(cfg, customerId, startDate, endDate),
      getTopSearchTerms(cfg, customerId, startDate, endDate, 20),
    ]);

    // Enrichment sections — non-fatal (Oz wraps each in try/catch).
    const [keywords, locations, auctionInsights] = await Promise.all([
      getKeywordPerformance(cfg, customerId, startDate, endDate, 50).catch(() => []),
      getLocationPerformance(cfg, customerId, startDate, endDate, 30).catch(() => []),
      getAuctionInsights(cfg, customerId, startDate, endDate).catch(() => []),
    ]);

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
        getAccountMetrics(cfg, customerId, comparison.start, comparison.end),
        getCampaignPerformance(cfg, customerId, comparison.start, comparison.end),
        getDailyPerformance(cfg, customerId, comparison.start, comparison.end),
      ]);
      compare = {
        startDate: comparison.start,
        endDate: comparison.end,
        label: comparison.label,
        accountMetrics: applyGoogleMargins(cMetrics, margin),
        campaigns: cCampaigns.map((c) => applyGoogleMargins(c, margin)),
        daily: cDaily.map((d) => applyGoogleMargins(d, margin)),
      };
    }

    return NextResponse.json({
      accountKey,
      dealer: account?.dealer ?? accountKey,
      customerId,
      margin,
      startDate,
      endDate,
      compareTo,
      accountMetrics: applyGoogleMargins(accountMetrics, margin),
      campaigns: campaigns.map((c) => applyGoogleMargins(c, margin)),
      devices: devices.map((d) => applyGoogleMargins(d, margin)),
      daily: daily.map((d) => applyGoogleMargins(d, margin)),
      searchTerms: searchTerms.map((s) => applyGoogleMargins(s, margin)),
      keywords: keywords.map((k) => applyGoogleMargins(k, margin)),
      locations: locations.map((l) => applyGoogleMargins(l, margin)),
      auctionInsights: auctionInsights.map((a) => applyGoogleMargins(a, margin)),
      compare,
    });
  } catch (err) {
    if (err instanceof GoogleAdsError) {
      const status = err.code === 'api_error' ? 502 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    // eslint-disable-next-line no-console
    console.error('[reporting/google] failed', err);
    return NextResponse.json({ error: 'Report failed' }, { status: 500 });
  }
}
