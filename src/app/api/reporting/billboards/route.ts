/**
 * Billboards — GET /api/reporting/billboards
 *
 * Port of Oz Dealer Tools' BillboardReport. Boards owned by the account, plus
 * any an ancestor account has shared down the hierarchy.
 *
 * NATIVE LOOMI DATA, not a bridge feed — ODT owned these in its own database
 * and ODT is being retired, so they moved rather than being synced. See
 * src/lib/reporting/billboards.ts.
 *
 * READ is client-visible; WRITE lives on the sibling admin route, because a
 * board is an agency-managed asset (Oz signs the contract) rather than
 * something a dealer maintains.
 *
 * Query params:
 *   accountKey — the sub-account to report on (required; scoped per caller)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../_lib/guard';
import { canAccessAccount } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { getBillboards } from '@/lib/reporting/billboards';

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
    const result = await getBillboards(accountKey);
    return NextResponse.json({ dealer: account.dealer, ...result });
  } catch (err) {
    console.error('[reporting/billboards]', err);
    return NextResponse.json({ error: 'Failed to load billboards' }, { status: 500 });
  }
}
