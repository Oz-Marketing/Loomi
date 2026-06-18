/**
 * StackAdapt (OTT/CTV/display) performance report — GET /api/reporting/stackadapt
 *
 * Port of Oz Dealer Tools' StackAdaptReport controller. Resolves the active
 * account → its StackAdapt advertiser + reporting margin → pulls live delivery
 * via GraphQL → grosses up the cost fields → returns report-shaped JSON. No
 * metrics DB; every load is a live pull.
 *
 * Query params (all optional except accountKey):
 *   accountKey   — the sub-account to report on (required; scoped per caller)
 *   start_date   — YYYY-MM-DD, defaults to 30 days ago (Oz parity)
 *   end_date     — YYYY-MM-DD, defaults to today
 *   compare_to   — none | previous_period | previous_month | previous_year | custom
 *   compare_start / compare_end — YYYY-MM-DD when compare_to=custom
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../_lib/guard';
import { canAccessAccount } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  StackAdaptError,
  getAdvertiserConfig,
  getAccountMetrics,
  getCampaignPerformance,
  getCampaignGroupPerformance,
  getDailyPerformance,
  getCreativePerformance,
} from '@/lib/integrations/stackadapt';
import { applyStackAdaptMargins } from '@/lib/reporting/margins';
import { resolveComparisonDates } from '@/lib/reporting/comparison';

export const dynamic = 'force-dynamic';

/** YYYY-MM-DD in server-local time. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** YYYY-MM-DD for `days` ago (Oz StackAdapt default window is last 30 days). */
function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const { ctx, error } = await requireReportingAccess();
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const accountKey = sp.get('accountKey');
  if (!accountKey) {
    return NextResponse.json({ error: 'Missing accountKey' }, { status: 400 });
  }
  if (!canAccessAccount(ctx.accountKeys, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const startDate = sp.get('start_date') || daysAgoIso(30);
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
      select: { dealer: true, stackadaptMargin: true },
    });
    const margin = account?.stackadaptMargin ?? 0;

    const { cfg, advertiserId } = await getAdvertiserConfig(accountKey);

    const [accountMetrics, campaigns, campaignGroups, daily, creatives] =
      await Promise.all([
        getAccountMetrics(cfg, advertiserId, startDate, endDate),
        getCampaignPerformance(cfg, advertiserId, startDate, endDate),
        getCampaignGroupPerformance(cfg, advertiserId, startDate, endDate),
        getDailyPerformance(cfg, advertiserId, startDate, endDate),
        getCreativePerformance(cfg, advertiserId, startDate, endDate),
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
        getAccountMetrics(cfg, advertiserId, comparison.start, comparison.end),
        getCampaignPerformance(cfg, advertiserId, comparison.start, comparison.end),
        getDailyPerformance(cfg, advertiserId, comparison.start, comparison.end),
      ]);
      compare = {
        startDate: comparison.start,
        endDate: comparison.end,
        label: comparison.label,
        accountMetrics: applyStackAdaptMargins(cMetrics, margin),
        campaigns: cCampaigns.map((c) => applyStackAdaptMargins(c, margin)),
        daily: cDaily.map((d) => applyStackAdaptMargins(d, margin)),
      };
    }

    return NextResponse.json({
      accountKey,
      dealer: account?.dealer ?? accountKey,
      advertiserId,
      margin,
      startDate,
      endDate,
      compareTo,
      accountMetrics: applyStackAdaptMargins(accountMetrics, margin),
      campaigns: campaigns.map((c) => applyStackAdaptMargins(c, margin)),
      campaignGroups: campaignGroups.map((g) => applyStackAdaptMargins(g, margin)),
      daily: daily.map((d) => applyStackAdaptMargins(d, margin)),
      creatives: creatives.map((c) => applyStackAdaptMargins(c, margin)),
      compare,
    });
  } catch (err) {
    if (err instanceof StackAdaptError) {
      const status = err.code === 'graphql_error' ? 502 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    // eslint-disable-next-line no-console
    console.error('[reporting/stackadapt] failed', err);
    return NextResponse.json({ error: 'Report failed' }, { status: 500 });
  }
}
