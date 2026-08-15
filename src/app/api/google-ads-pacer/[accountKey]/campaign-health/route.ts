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
import { monthBoundsIso, zonedTodayIso } from '@/lib/timezone';

/**
 * Daily spend series for ONE Google campaign — the delivery expander's chart.
 *
 * DB ONLY. It reads the already-synced MetaAdsPacerDailySpend rows (120-day
 * retention), so opening a row costs no Google request. That is load-bearing
 * now that the expander replaced the modal: any number of rows can be open at
 * once (delivery/reallocation spec §1), so a per-open live read would turn one
 * glance at a busy account into a dozen API calls.
 *
 * The reference metrics used to be fetched here, one live single-campaign query
 * per open. They now ride the account sync as stored columns (§4) and reach the
 * panel on the pacer row itself, which is what made multi-open affordable.
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
  const bounds = monthBoundsIso(period);
  const monthStart = bounds?.start ?? `${period}-01`;
  const monthEnd = bounds?.end ?? todayIso;
  // The DATA EDGE — the last WHOLE day — never today. Today is always partial,
  // and a partial bar beside full ones reads as a collapse in delivery; it also
  // drags the average the verdict is computed from. Past months end at the month
  // end: every day in them is settled.
  const yesterday = addDaysIso(todayIso, -1);
  const edge = yesterday < monthEnd ? yesterday : monthEnd;

  // The WHOLE month up to the edge, in one read. The panel slices this to the
  // campaign's flight (§2) rather than the route doing it: the flight window is
  // already resolved on the allocator line, overrides and all, and computing it
  // a second time here is how the chart and the day counts drift apart. Never
  // more than 31 rows, so there is nothing to save by narrowing it server-side.
  //
  // Bounded at the month start on purpose. The old rolling window counted back
  // from today and reached into the previous month, so a chart in a fresh month
  // opened on prior-month delivery.
  const rows = await prisma.metaAdsPacerDailySpend.findMany({
    where: {
      planId: plan.id,
      platform: 'google',
      objectId: ad.googleCampaignId,
      date: { gte: monthStart, lte: todayIso },
    },
    select: { date: true, spend: true, dailyBudget: true },
    orderBy: { date: 'asc' },
  });
  const all = rows.map((r) => ({
    date: r.date,
    spend: Number(r.spend) || 0,
    dailyBudget: r.dailyBudget != null ? Number(r.dailyBudget) : null,
  }));
  const series = all.filter((p) => p.date <= edge);
  // Today's partial, kept strictly apart from the finalized series (§3). Null in
  // a closed month (there is no "today" inside it) and null when the sync has
  // not run today — in both cases the panel shows no today figure rather than a
  // zero, which would read as "spent nothing today".
  const todayRow = todayIso <= monthEnd ? all.find((p) => p.date === todayIso) : undefined;

  return NextResponse.json({
    adId: ad.id,
    name: ad.name,
    since: monthStart,
    // What the panel stamps as "data through". The last day we actually HAVE,
    // not the last day we asked for: when a sync is behind, claiming data
    // through the edge would contradict the card header (which follows the
    // series) and overstate how current the chart is.
    until: series.length > 0 ? series[series.length - 1].date : edge,
    /** The data edge itself, so the panel can tell "behind" from "up to date". */
    dataEdge: edge,
    todayIso,
    todaySpend: todayRow ? todayRow.spend : null,
    /** The dashed cap line: the campaign's current average daily budget. */
    cap: Number(ad.pacerDailyBudget) || 0,
    series,
  });
}
