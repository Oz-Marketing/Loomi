import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as budget from '@/lib/services/budget';

/**
 * GET  /api/budget/agreements?accountKey=…&year=… — agreements OVERLAPPING the
 *      year, each with its share of it. A Mar–Feb term shows up in both years.
 * POST /api/budget/agreements — create one, with its recurring fees.
 *
 * Replaces /api/budget/plan. A year-keyed plan couldn't express a term that
 * crosses a calendar boundary, which is most of them.
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
  const year = yearRaw ? Number(yearRaw) : undefined;
  if (year != null && !Number.isInteger(year)) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
  }

  return NextResponse.json({ agreements: await budget.listAgreements(accountKey, { year }) });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const accountKey = typeof body.accountKey === 'string' ? body.accountKey : '';
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }
  if (!budget.canAccess(getAccountScope(session!), accountKey)) return forbidden();

  try {
    const agreement = await budget.createAgreement(
      {
        accountKey,
        name: typeof body.name === 'string' ? body.name : '',
        startDate: String(body.startDate ?? ''),
        endDate: String(body.endDate ?? ''),
        committedAmount: body.committedAmount == null ? null : Number(body.committedAmount),
        status: typeof body.status === 'string' ? body.status : undefined,
        defaultMarkup: body.defaultMarkup == null ? null : Number(body.defaultMarkup),
        notes: typeof body.notes === 'string' ? body.notes : null,
        fees: Array.isArray(body.fees) ? body.fees : [],
      },
      session!.user.id,
    );
    return NextResponse.json({ agreement }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create the agreement' },
      { status: 400 },
    );
  }
}
