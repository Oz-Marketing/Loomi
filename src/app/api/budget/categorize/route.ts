import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import { isBudgetLineType } from '@/lib/budget/channels';
import * as budget from '@/lib/services/budget';

/**
 * GET  /api/budget/categorize?accountKey=…&year=… — what still needs a type,
 *      grouped by channel.
 * POST — assign a type to every still-unclassified line on a channel.
 *
 * Bulk because the decision is almost never per line: everything on a channel
 * is usually the same kind of money, and the import left 738 lines of "Other"
 * alone, which nobody sorts one row at a time.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const accountKey = sp.get('accountKey');
  const year = Number(sp.get('year'));
  if (!accountKey || !Number.isInteger(year)) {
    return NextResponse.json({ error: 'accountKey and year are required' }, { status: 400 });
  }
  if (!budget.canAccess(getAccountScope(session!), accountKey)) return forbidden();

  return NextResponse.json({ groups: await budget.getUnclassified(accountKey, year) });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const accountKey = typeof body.accountKey === 'string' ? body.accountKey : '';
  const year = Number(body.year);
  if (!accountKey || !Number.isInteger(year)) {
    return NextResponse.json({ error: 'accountKey and year are required' }, { status: 400 });
  }
  if (!budget.canAccess(getAccountScope(session!), accountKey)) return forbidden();
  if (!isBudgetLineType(body.lineType)) {
    return NextResponse.json({ error: 'A valid lineType is required' }, { status: 400 });
  }

  // `channel` is nullable and null is a real value — lines with no channel at
  // all need typing too — so this reads presence, not truthiness.
  const channel = 'channel' in body ? (body.channel ?? null) : null;

  try {
    const updated = await budget.categorizeChannel(
      accountKey,
      year,
      channel,
      body.lineType,
      session!.user.id,
    );
    return NextResponse.json({ updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not categorize those lines' },
      { status: 400 },
    );
  }
}
