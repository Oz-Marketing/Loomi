/**
 * Acquisition-cost outcomes — GET /api/reporting/acquisition-cost
 *
 * Returns the CRM half only: leads, sold units and transaction revenue for the
 * window, plus the same bucketed by month for the trend.
 *
 * THE SPEND HALF IS NOT HERE, DELIBERATELY. The report component fans out to
 * the existing channel routes client-side, exactly as the Marketing Overview
 * and Ad Meeting surfaces already do (see _components/account-sources.ts). A
 * server-side aggregator would be a second implementation of every channel's
 * auth, margin handling and error shape, and its first bug would be a number
 * here disagreeing with the report it came from.
 *
 * It also matters for the margin rule: spend arrives through the channel routes
 * with `stripMarginInternals` already applied per role, so this report cannot
 * become a side door onto raw cost.
 *
 * Query params:
 *   accountKey  — the sub-account to report on (required; scoped per caller)
 *   start_date  — YYYY-MM-DD, defaults to the 1st of the current month
 *   end_date    — YYYY-MM-DD, defaults to today
 *   trend_start — YYYY-MM-DD, optional wider window for the monthly series
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../_lib/guard';
import { canAccessAccount } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  getWindowOutcomes,
  getMonthlyOutcomes,
  getMonthlyMediaSpend,
} from '@/lib/reporting/acquisition-outcomes';

export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET(req: NextRequest) {
  const { ctx, error } = await requireReportingAccess();
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

  // The trend deliberately reaches back further than the selected window: one
  // month of cost-per-unit is dominated by the lag between click and delivery,
  // and the direction over a year is the part that means anything.
  const trendDefault = new Date(today);
  trendDefault.setMonth(trendDefault.getMonth() - 11);
  trendDefault.setDate(1);
  const trendStart = sp.get('trend_start') || iso(trendDefault);
  if (!ISO_DATE.test(trendStart)) {
    return NextResponse.json({ error: 'trend_start must be YYYY-MM-DD' }, { status: 400 });
  }

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { dealer: true },
  });
  if (!account) return NextResponse.json({ error: 'Unknown account' }, { status: 404 });

  try {
    const [window, monthly, monthlySpend] = await Promise.all([
      getWindowOutcomes(accountKey, startDate, endDate),
      getMonthlyOutcomes(accountKey, trendStart, endDate),
      // Ledger spend, so the trend costs one query rather than a year of
      // vendor calls. Billed figures, matching what the channel routes return.
      getMonthlyMediaSpend(accountKey, trendStart.slice(0, 7), endDate.slice(0, 7)),
    ]);

    return NextResponse.json({
      accountKey,
      dealer: account.dealer,
      startDate,
      endDate,
      trendStart,
      outcomes: window,
      monthly,
      monthlySpend,
      // Stated in the payload, not just in the UI, so an export or a future
      // consumer inherits the caveats rather than rediscovering them.
      caveats: {
        leads: 'Good leads only — the CRM\'s BAD and DUPLICATE leads are filtered upstream and never reach Loomi.',
        revenue: 'Transaction revenue (what the customer paid), not dealer gross.',
        lag: 'Sales often close weeks after the click that produced them, so a single month\'s cost per unit is approximate. The trend is the reliable signal.',
        trendSpend:
          'Monthly spend comes from the budget ledger (billed media lines), not a live platform pull — so the trend may differ slightly from the selected window\'s live figures.',
      },
    });
  } catch (err) {
    console.error('[reporting/acquisition-cost]', err);
    return NextResponse.json({ error: 'Failed to load acquisition cost' }, { status: 500 });
  }
}
