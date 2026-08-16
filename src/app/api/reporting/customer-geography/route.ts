/**
 * Customer geography report — GET /api/reporting/customer-geography
 *
 * Port of Oz Dealer Tools' HeatmapReport. Sale or service volume aggregated by
 * the customer's postal code.
 *
 * UNLIKE the other reporting routes, this reads local Postgres rather than a
 * vendor API — its source is `ContactEvent` joined to `Contact` for the
 * address. See src/lib/reporting/customer-geography.ts, including why the
 * address is the customer's CURRENT one rather than their address at the time
 * of sale, and what `placement` measures.
 *
 * Query params:
 *   accountKey  — the sub-account to report on (required; scoped per caller)
 *   mode        — 'sales' | 'service' (default 'sales')
 *   deal_type   — ALL | NEW | USED | LEASE (sales only; default ALL)
 *   start_date  — YYYY-MM-DD, defaults to the 1st of the current month
 *   end_date    — YYYY-MM-DD, defaults to today
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../_lib/guard';
import { canAccessAccount } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  getCustomerGeography,
  DEAL_TYPE_FILTERS,
  type GeographyMode,
  type DealTypeFilter,
} from '@/lib/reporting/customer-geography';

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
  const { ctx, error } = await requireReportingAccess({ report: 'heatmap', req: req });
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const accountKey = sp.get('accountKey');
  if (!accountKey) return NextResponse.json({ error: 'Missing accountKey' }, { status: 400 });
  if (!canAccessAccount(ctx.accountKeys, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const modeParam = sp.get('mode') || 'sales';
  if (modeParam !== 'sales' && modeParam !== 'service') {
    return NextResponse.json({ error: "mode must be 'sales' or 'service'" }, { status: 400 });
  }
  const mode = modeParam as GeographyMode;

  const dealTypeParam = (sp.get('deal_type') || 'ALL').toUpperCase();
  if (!DEAL_TYPE_FILTERS.includes(dealTypeParam as DealTypeFilter)) {
    return NextResponse.json(
      { error: `deal_type must be one of ${DEAL_TYPE_FILTERS.join(', ')}` },
      { status: 400 },
    );
  }
  const dealType = dealTypeParam as DealTypeFilter;

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
    const result = await getCustomerGeography(accountKey, mode, startDate, endDate, dealType);
    return NextResponse.json({
      dealer: account.dealer,
      mode,
      dealType,
      startDate,
      endDate,
      ...result,
    });
  } catch (err) {
    console.error('[reporting/customer-geography]', err);
    return NextResponse.json({ error: 'Failed to load customer geography' }, { status: 500 });
  }
}
