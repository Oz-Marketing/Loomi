/**
 * GoHighLevel email campaign report — GET /api/reporting/email
 *
 * Port of Oz Dealer Tools' EmailReport controller. Resolves the active account
 * → its GHL Private Integration token + locationId → pulls the email schedule →
 * normalizes + aggregates. No margin (email has no media cost). The window
 * filters by scheduled date (campaigns with no schedule date pass through, Oz
 * parity); comparison periods don't apply.
 *
 *   ?accountKey=…&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../_lib/guard';
import { canAccessAccount } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  GhlError,
  getGhlCredentials,
  getEmailBlastsNormalized,
  aggregateStats,
} from '@/lib/integrations/gohighlevel';

export const dynamic = 'force-dynamic';
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

  const startDate = sp.get('start_date');
  const endDate = sp.get('end_date');
  if ((startDate && !ISO_DATE.test(startDate)) || (endDate && !ISO_DATE.test(endDate))) {
    return NextResponse.json({ error: 'start_date / end_date must be YYYY-MM-DD' }, { status: 400 });
  }

  try {
    const account = await prisma.account.findUnique({
      where: { key: accountKey },
      select: { dealer: true },
    });
    const creds = await getGhlCredentials(accountKey);
    const all = await getEmailBlastsNormalized(creds);

    // Filter by scheduled date; undated campaigns pass through (Oz parity).
    const startMs = startDate ? new Date(`${startDate}T00:00:00Z`).getTime() : null;
    const endMs = endDate ? new Date(`${endDate}T23:59:59Z`).getTime() : null;
    const inRange = all.filter((c) => {
      if (!c.scheduled_at) return true;
      const t = new Date(`${c.scheduled_at}Z`).getTime();
      if (!Number.isFinite(t)) return true;
      if (startMs != null && t < startMs) return false;
      if (endMs != null && t > endMs) return false;
      return true;
    });

    // Most recent first.
    const campaigns = inRange.sort(
      (a, b) =>
        new Date(`${b.scheduled_at || '1970-01-01'}Z`).getTime() -
        new Date(`${a.scheduled_at || '1970-01-01'}Z`).getTime(),
    );

    const stats = aggregateStats(campaigns);

    // Count by status for the breakdown chips.
    const statusBreakdown: Record<string, number> = {};
    for (const c of campaigns) {
      const s = (c.status || 'unknown').toLowerCase();
      statusBreakdown[s] = (statusBreakdown[s] ?? 0) + 1;
    }

    return NextResponse.json({
      accountKey,
      dealer: account?.dealer ?? accountKey,
      locationId: creds.locationId,
      startDate: startDate ?? null,
      endDate: endDate ?? null,
      stats,
      statusBreakdown,
      campaigns,
      totalCampaigns: all.length,
    });
  } catch (err) {
    if (err instanceof GhlError) {
      const status = err.code === 'api_error' ? 502 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    // eslint-disable-next-line no-console
    console.error('[reporting/email] failed', err);
    return NextResponse.json({ error: 'Report failed' }, { status: 500 });
  }
}
