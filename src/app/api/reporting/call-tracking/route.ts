/**
 * Call Tracking report — GET /api/reporting/call-tracking
 *
 * Port of Oz Dealer Tools' CallTrackingReport. Volume, answer rate, and the six
 * breakdowns (status, tracker, city, weekday, hour, date).
 *
 * Reads local Postgres — its source is `CallEvent`, filled by the Oz Reports
 * bridge route `/loomi/pushcalls`. See src/lib/reporting/call-tracking.ts.
 *
 * Query params:
 *   accountKey  — the sub-account to report on (required; scoped per caller)
 *   start_date  — YYYY-MM-DD, defaults to the 1st of the current month
 *   end_date    — YYYY-MM-DD, defaults to today
 *   tz          — IANA timezone for the hour/weekday breakdowns
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../_lib/guard';
import { canAccessAccount } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { getCallTracking } from '@/lib/reporting/call-tracking';

export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Dealers are US-based; this is the sane default when nothing is configured. */
const DEFAULT_TZ = 'America/Denver';

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Postgres throws on an unknown timezone name, which would surface as a 500 on
 * a report rather than as the bad input it is. Validate with the platform's own
 * database before it reaches SQL.
 */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const { ctx, error } = await requireReportingAccess({ report: 'call_tracking', req: req });
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const accountKey = sp.get('accountKey');
  if (!accountKey) return NextResponse.json({ error: 'Missing accountKey' }, { status: 400 });
  if (!canAccessAccount(ctx.accountKeys, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const startDate = sp.get('start_date') || iso(monthStart);
  const endDate = sp.get('end_date') || iso(today);
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
    return NextResponse.json({ error: 'start_date / end_date must be YYYY-MM-DD' }, { status: 400 });
  }
  if (startDate > endDate) {
    return NextResponse.json({ error: 'start_date must not be after end_date' }, { status: 400 });
  }

  const tz = sp.get('tz') || DEFAULT_TZ;
  if (!isValidTimezone(tz)) {
    return NextResponse.json({ error: 'tz must be an IANA timezone name' }, { status: 400 });
  }

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true, dealer: true },
  });
  if (!account) return NextResponse.json({ error: 'Unknown account' }, { status: 404 });

  try {
    const result = await getCallTracking(accountKey, startDate, endDate, tz);
    return NextResponse.json({ dealer: account.dealer, startDate, endDate, ...result });
  } catch (err) {
    console.error('[reporting/call-tracking]', err);
    return NextResponse.json({ error: 'Failed to load call tracking' }, { status: 500 });
  }
}
