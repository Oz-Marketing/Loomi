import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  accountTimeZone,
  addDaysIso,
  canAccessPacer,
  getOrCreatePlan,
  isValidPeriod,
} from '@/lib/meta-ads-pacer';
import {
  GoogleAdsError,
  getGoogleCustomer,
} from '@/lib/integrations/google-ads';
import { fetchCampaignWindowMetrics } from '@/lib/integrations/google-ads-pacer';
import { zonedTodayIso } from '@/lib/timezone';

const ALLOWED_WINDOWS = new Set([7, 14, 30]);

/**
 * Delivery-health data for ONE Google campaign (google-pacing-card spec §7).
 *
 * Two sources, deliberately split:
 *  - the daily spend SERIES comes from the already-synced MetaAdsPacerDailySpend
 *    rows (120-day retention), so opening the popup costs no Google call at all;
 *  - the reference METRICS (conversions, CTR) need a live read, and it is a
 *    single-campaign query fired lazily on open, per §11's "fetched lazily when a
 *    health popup opens".
 *
 * The metrics read is best-effort: an unconnected account or an API hiccup still
 * gets the chart and the verdict, which is the part that answers "should I move
 * spend, and which way".
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ accountKey: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { accountKey } = await params;
  if (!canAccessPacer(session, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const period = req.nextUrl.searchParams.get('period');
  if (!period || !isValidPeriod(period)) {
    return NextResponse.json(
      { error: 'Missing or invalid period (expected YYYY-MM)' },
      { status: 400 },
    );
  }
  const adId = req.nextUrl.searchParams.get('adId') ?? '';
  if (!adId) return NextResponse.json({ error: 'adId is required' }, { status: 400 });
  const days = Number(req.nextUrl.searchParams.get('days') ?? 7);
  if (!ALLOWED_WINDOWS.has(days)) {
    return NextResponse.json({ error: 'days must be 7, 14 or 30' }, { status: 400 });
  }

  const plan = await getOrCreatePlan(accountKey);
  const ad = await prisma.metaAdsPacerAd.findFirst({
    where: { id: adId, planId: plan.id, period, platform: 'google' },
    select: {
      id: true,
      name: true,
      googleCampaignId: true,
      pacerDailyBudget: true,
    },
  });
  if (!ad) {
    return NextResponse.json({ error: 'Campaign not found in this period' }, { status: 404 });
  }
  if (!ad.googleCampaignId) {
    return NextResponse.json(
      { error: 'Import this campaign from Google to see delivery history.' },
      { status: 400 },
    );
  }

  const tz = await accountTimeZone(accountKey);
  const todayIso = zonedTodayIso(Date.now(), tz);
  // The window ends at the last day that can have data (today, partial) and spans
  // `days` back. The series itself decides where data actually stops.
  const since = addDaysIso(todayIso, -(days - 1));

  const rows = await prisma.metaAdsPacerDailySpend.findMany({
    where: {
      planId: plan.id,
      platform: 'google',
      objectId: ad.googleCampaignId,
      date: { gte: since, lte: todayIso },
    },
    select: { date: true, spend: true, dailyBudget: true },
    orderBy: { date: 'asc' },
  });
  const series = rows.map((r) => ({
    date: r.date,
    spend: Number(r.spend) || 0,
    dailyBudget: r.dailyBudget != null ? Number(r.dailyBudget) : null,
  }));

  let metrics = null;
  let metricsError: string | null = null;
  try {
    const { cfg, customerId } = await getGoogleCustomer(accountKey);
    metrics = await fetchCampaignWindowMetrics(
      cfg,
      customerId,
      ad.googleCampaignId,
      since,
      todayIso,
    );
  } catch (err) {
    // Chart + verdict still render — say why the reference panel is empty rather
    // than showing zeros that look like real performance.
    metricsError =
      err instanceof GoogleAdsError ? err.message : 'Reference metrics unavailable';
  }

  return NextResponse.json({
    adId: ad.id,
    name: ad.name,
    days,
    since,
    until: todayIso,
    /** The dashed cap line: the campaign's current average daily budget. */
    cap: Number(ad.pacerDailyBudget) || 0,
    series,
    metrics,
    metricsError,
  });
}
