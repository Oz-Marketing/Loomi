/**
 * Service retention report — GET /api/reporting/service-retention
 *
 * Port of Oz Dealer Tools' ServiceRetentionReport. Two cohort metrics:
 * sales → service conversion, and service-only repeat visits.
 *
 * UNLIKE the other reporting routes, this reads local Postgres rather than a
 * vendor API — its source is `ContactEvent`. See
 * src/lib/reporting/service-retention.ts, including why the numbers do not tie
 * out with ODT's for dealers with repeat buyers.
 *
 * There is no date range: cohorts are fixed at the trailing 5 years and each
 * one's window is defined by its own start, so an arbitrary range would make
 * the rates meaningless. The only parameter is the account.
 *
 * Query params:
 *   accountKey  — the sub-account to report on (required; scoped per caller)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../_lib/guard';
import { canAccessAccount } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { getServiceRetention } from '@/lib/reporting/service-retention';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { ctx, error } = await requireReportingAccess();
  if (error) return error;

  const accountKey = req.nextUrl.searchParams.get('accountKey');
  if (!accountKey) return NextResponse.json({ error: 'Missing accountKey' }, { status: 400 });
  if (!canAccessAccount(ctx.accountKeys, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true, dealer: true },
  });
  if (!account) return NextResponse.json({ error: 'Unknown account' }, { status: 404 });

  try {
    const result = await getServiceRetention(accountKey);
    return NextResponse.json({ dealer: account.dealer, ...result });
  } catch (err) {
    console.error('[reporting/service-retention]', err);
    return NextResponse.json({ error: 'Failed to load service retention' }, { status: 500 });
  }
}
