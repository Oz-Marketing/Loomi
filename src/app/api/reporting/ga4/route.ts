/**
 * GA4 website analytics report — GET /api/reporting/ga4
 *
 * Port of Oz Dealer Tools' WebsiteAnalytics controller. Resolves the active
 * account → its GA4 property id → pulls live Data API metrics → returns
 * report-shaped JSON. No metrics DB; the GA4 property is the source of truth.
 *
 * Query params:
 *   accountKey  — the sub-account to report on (required; scoped per caller)
 *   start_date  — YYYY-MM-DD, defaults to the 1st of the current month
 *   end_date    — YYYY-MM-DD, defaults to today
 *
 * Overview + trend are fatal (they define the report); channels + top pages are
 * non-fatal so a partial API hiccup still renders the headline numbers.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../_lib/guard';
import { canAccessAccount } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  Ga4Error,
  getGa4Config,
  resolveGa4Property,
  resolveGa4Platform,
  getTrafficOverview,
  getTrafficSources,
  getTopPages,
  getTrafficTrend,
  getDeviceBreakdown,
  getSourceMedium,
  getVdpViews,
} from '@/lib/integrations/ga4';

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

  try {
    const cfg = getGa4Config();
    if (!cfg) {
      throw new Ga4Error(
        'Google Analytics is not configured on the server (set GA4_SERVICE_ACCOUNT_JSON).',
        'not_configured',
      );
    }
    const propertyId = resolveGa4Property(accountKey);
    if (!propertyId) {
      throw new Ga4Error('No GA4 property is mapped to this account yet.', 'no_property');
    }

    const account = await prisma.account.findUnique({
      where: { key: accountKey },
      select: { dealer: true },
    });

    // Headline sections — fatal on failure.
    const [overview, trend] = await Promise.all([
      getTrafficOverview(cfg, propertyId, startDate, endDate),
      getTrafficTrend(cfg, propertyId, startDate, endDate),
    ]);

    // Breakdown sections — non-fatal (render the rest if one fails).
    const platform = resolveGa4Platform(accountKey);
    const [sources, topPages, devices, sourceMedium, vdp] = await Promise.all([
      getTrafficSources(cfg, propertyId, startDate, endDate).catch(() => []),
      getTopPages(cfg, propertyId, startDate, endDate, 10).catch(() => []),
      getDeviceBreakdown(cfg, propertyId, startDate, endDate).catch(() => []),
      getSourceMedium(cfg, propertyId, startDate, endDate, 25).catch(() => []),
      getVdpViews(cfg, propertyId, startDate, endDate, 10, platform).catch(() => ({ totalViews: 0, pages: [] })),
    ]);

    return NextResponse.json({
      accountKey,
      dealer: account?.dealer ?? accountKey,
      propertyId,
      platform,
      startDate,
      endDate,
      overview,
      trend,
      sources,
      topPages,
      devices,
      sourceMedium,
      vdp,
    });
  } catch (err) {
    if (err instanceof Ga4Error) {
      const status =
        err.code === 'api_error' ? 502 : err.code === 'not_configured' ? 503 : 404;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    // eslint-disable-next-line no-console
    console.error('[reporting/ga4] failed', err);
    return NextResponse.json({ error: 'Report failed' }, { status: 500 });
  }
}
