import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as budget from '@/lib/services/budget';

/**
 * GET /api/budget/summary?accountKey=…&year=… — the account/year rollup:
 * declared total, committed, allocated vs pool, and the over-allocation flag.
 * Powers the budget hub header and the live remaining figure on the Projects
 * intake form. Internal-staff only, account-scoped.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const accountKey = sp.get('accountKey');
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }
  if (!budget.canAccess(getAccountScope(session!), accountKey)) return forbidden();

  const yearRaw = sp.get('year');
  const year = yearRaw ? Number(yearRaw) : new Date().getFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
  }

  const summary = await budget.getAccountSummary(accountKey, year);
  return NextResponse.json({ summary });
}
