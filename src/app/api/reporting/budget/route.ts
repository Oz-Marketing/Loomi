/**
 * Budget report — GET /api/reporting/budget
 *
 * The client-facing view of the budget ledger: what the contract commits, what
 * has been planned against it, and what has actually been spent.
 *
 * NOT the budget hub's data. The hub (/api/budget/summary) is gated to
 * MANAGEMENT_ROLES and returns Oz's cost and margin; this route runs behind
 * `requireReportingAccess`, which admits the `client` role, and returns the
 * projection from lib/reporting/budget-view.ts with every margin figure
 * removed. Read that file's header before adding a field here.
 *
 * Like the other dealer-data reports this reads local Postgres, not a vendor
 * API — the ledger lives in `BudgetLine`, fed by the Oz Reports push bridge.
 *
 * Query params:
 *   accountKey  — the sub-account to report on (required; scoped per caller)
 *   year        — budget year, defaults to the current one
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../_lib/guard';
import { canAccessAccount } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { getReportingBudget } from '@/lib/reporting/budget-view';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { ctx, error } = await requireReportingAccess();
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const accountKey = sp.get('accountKey');
  if (!accountKey) return NextResponse.json({ error: 'Missing accountKey' }, { status: 400 });
  if (!canAccessAccount(ctx.accountKeys, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const yearRaw = sp.get('year');
  const year = yearRaw ? Number(yearRaw) : new Date().getFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'year must be a 4-digit year' }, { status: 400 });
  }

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true, dealer: true },
  });
  if (!account) return NextResponse.json({ error: 'Unknown account' }, { status: 404 });

  try {
    const view = await getReportingBudget(accountKey, year);
    return NextResponse.json({ dealer: account.dealer, ...view });
  } catch (err) {
    console.error('[reporting/budget]', err);
    return NextResponse.json({ error: 'Failed to load budget' }, { status: 500 });
  }
}
