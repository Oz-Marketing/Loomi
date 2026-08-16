/**
 * Direct Mail ROI — GET /api/reporting/direct-mail
 *
 * Port of Oz Dealer Tools' ServiceMailerReport and its Summary roll-up, folded
 * into one route: campaigns in range, plus their totals.
 *
 * Reads local Postgres. Its source is `MailerCampaign` — matchback RESULTS
 * computed on the Oz Reports host, because the join key (`custno`) does not
 * exist in Loomi. See src/lib/reporting/direct-mail.ts.
 *
 * Query params:
 *   accountKey  — the sub-account to report on (required; scoped per caller)
 *   start_date  — YYYY-MM-DD, defaults to a year ago
 *   end_date    — YYYY-MM-DD, defaults to today
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../_lib/guard';
import { canAccessAccount } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { getDirectMail } from '@/lib/reporting/direct-mail';

export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const { ctx, error } = await requireReportingAccess({ report: 'direct_mail', req: req });
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const accountKey = sp.get('accountKey');
  if (!accountKey) return NextResponse.json({ error: 'Missing accountKey' }, { status: 400 });
  if (!canAccessAccount(ctx.accountKeys, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  // A year by default: a mailer's service window runs 45 days past the drop,
  // so a month-long default would routinely show campaigns mid-count.
  const today = new Date();
  const yearAgo = new Date(today);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const startDate = sp.get('start_date') || iso(yearAgo);
  const endDate = sp.get('end_date') || iso(today);
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
    const result = await getDirectMail(accountKey, startDate, endDate);
    return NextResponse.json({ dealer: account.dealer, startDate, endDate, ...result });
  } catch (err) {
    console.error('[reporting/direct-mail]', err);
    return NextResponse.json({ error: 'Failed to load direct mail' }, { status: 500 });
  }
}
