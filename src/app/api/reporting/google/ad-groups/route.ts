/**
 * Ad-group drilldown — GET /api/reporting/google/ad-groups
 *
 * Port of Oz's GoogleAdsReport::adGroups AJAX endpoint. Returns the ad groups
 * for one campaign over the window, margin applied. Driven by the campaign-row
 * expander in the Google report.
 *
 *   ?accountKey=…&campaign_id=123&start_date=…&end_date=…
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../../_lib/guard';
import { canAccessAccount } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { GoogleAdsError, getGoogleCustomer, getAdGroupPerformance } from '@/lib/integrations/google-ads';
import { applyGoogleMargins } from '@/lib/reporting/margins';

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
  const campaignId = sp.get('campaign_id');
  if (!accountKey) return NextResponse.json({ error: 'Missing accountKey' }, { status: 400 });
  if (!canAccessAccount(ctx.accountKeys, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }
  if (!campaignId || !/^\d+$/.test(campaignId)) {
    return NextResponse.json({ error: 'Valid campaign_id required' }, { status: 400 });
  }

  const startDate = sp.get('start_date') || monthStartIso();
  const endDate = sp.get('end_date') || todayIso();
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
    return NextResponse.json({ error: 'start_date / end_date must be YYYY-MM-DD' }, { status: 400 });
  }

  try {
    const account = await prisma.account.findUnique({
      where: { key: accountKey },
      select: { googleAdsMargin: true },
    });
    const margin = account?.googleAdsMargin ?? 0;
    const { cfg, customerId } = await getGoogleCustomer(accountKey);
    const adGroups = await getAdGroupPerformance(cfg, customerId, campaignId, startDate, endDate);
    return NextResponse.json({ adGroups: adGroups.map((a) => applyGoogleMargins(a, margin)) });
  } catch (err) {
    if (err instanceof GoogleAdsError) {
      const status = err.code === 'api_error' ? 502 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    // eslint-disable-next-line no-console
    console.error('[reporting/google/ad-groups] failed', err);
    return NextResponse.json({ error: 'Drilldown failed' }, { status: 500 });
  }
}
