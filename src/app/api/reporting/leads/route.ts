/**
 * Lead Performance — GET /api/reporting/leads
 *
 * Port of Oz Dealer Tools' LeadPerformance. Monthly lead volume, source and
 * category mix, and month-over-month / year-over-year / YTD comparisons.
 *
 * Reads local Postgres, not a vendor API — leads arrive as `Contact` rows
 * tagged `lead` from the Oz Reports bridge. See
 * src/lib/reporting/lead-performance.ts, including why Loomi's lead count is
 * structurally lower than ODT's and why the comparison is exact rather than
 * prorated.
 *
 * Query params:
 *   accountKey  — the sub-account to report on (required; scoped per caller)
 *   period      — YYYY-MM, defaults to the current month
 *   through_day — 1–31; cuts the current AND comparison periods at the same
 *                 day so a partial month compares fairly. Defaults to today's
 *                 day when `period` is the current month, else omitted.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../_lib/guard';
import { canAccessAccount } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { getLeadPerformance } from '@/lib/reporting/lead-performance';

export const dynamic = 'force-dynamic';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: NextRequest) {
  const { ctx, error } = await requireReportingAccess({ report: 'leads', req: req });
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const accountKey = sp.get('accountKey');
  if (!accountKey) return NextResponse.json({ error: 'Missing accountKey' }, { status: 400 });
  if (!canAccessAccount(ctx.accountKeys, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const now = new Date();
  const currentPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const period = sp.get('period') || currentPeriod;
  if (!PERIOD.test(period)) {
    return NextResponse.json({ error: 'period must be YYYY-MM' }, { status: 400 });
  }

  // A closed month is compared whole; only a month still in progress is cut at
  // a day. An explicit through_day overrides, so a rep can ask "how did we look
  // at the 15th" for any month.
  let throughDay: number | null = period === currentPeriod ? now.getUTCDate() : null;
  const raw = sp.get('through_day');
  if (raw !== null) {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) {
      return NextResponse.json({ error: 'through_day must be 1–31' }, { status: 400 });
    }
    throughDay = parsed;
  }

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true, dealer: true },
  });
  if (!account) return NextResponse.json({ error: 'Unknown account' }, { status: 404 });

  try {
    const result = await getLeadPerformance(accountKey, period, throughDay);
    return NextResponse.json({ dealer: account.dealer, ...result });
  } catch (err) {
    console.error('[reporting/leads]', err);
    return NextResponse.json({ error: 'Failed to load lead performance' }, { status: 500 });
  }
}
