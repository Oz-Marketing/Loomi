/**
 * Service trend report — GET /api/reporting/service-trend
 *
 * Port of Oz Dealer Tools' ServiceTrend controller. Repair-order counts and
 * revenue by month, split customer-pay / warranty / internal.
 *
 * UNLIKE the other reporting routes, this reads local Postgres rather than a
 * vendor API — its source is `ContactEvent`, kept current by the Oz Reports
 * push bridge. See src/lib/reporting/dealer-trends.ts. Powersports ROs carry
 * no pay-type split, so their revenue lands in `unsplitPay`.
 *
 * Query params:
 *   accountKey  — the sub-account to report on (required; scoped per caller)
 *   start_date  — YYYY-MM-DD, defaults to the 1st of the current month
 *   end_date    — YYYY-MM-DD, defaults to today
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../_lib/guard';
import { canAccessAccount } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { getServiceTrend } from '@/lib/reporting/dealer-trends';

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
  const { ctx, error } = await requireReportingAccess({ report: 'service_trend', req: req });
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
  if (startDate > endDate) {
    return NextResponse.json({ error: 'start_date must not be after end_date' }, { status: 400 });
  }

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true, dealer: true },
  });
  if (!account) return NextResponse.json({ error: 'Unknown account' }, { status: 404 });

  try {
    const { months, summary } = await getServiceTrend(accountKey, startDate, endDate);
    return NextResponse.json({
      dealer: account.dealer,
      startDate,
      endDate,
      months,
      summary,
    });
  } catch (err) {
    console.error('[reporting/service-trend]', err);
    return NextResponse.json({ error: 'Failed to load service trend' }, { status: 500 });
  }
}
