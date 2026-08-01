import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as budget from '@/lib/services/budget';

/**
 * POST   /api/budget/lines/[id]/settle  { actualAmount } — close the line out.
 * DELETE /api/budget/lines/[id]/settle  — reopen it for correction.
 *
 * The manual path. Radio, print, TV, video and PR have no platform to sync
 * from, so a human records what they cost; platform lines settle on their own
 * from synced spend but can be corrected here.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;
  const { id } = await params;

  const existing = await budget.getLine(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!budget.canAccess(getAccountScope(session!), existing.accountKey)) return forbidden();

  const body = await req.json().catch(() => ({}));
  const actualAmount = Number(body.actualAmount);
  if (!Number.isFinite(actualAmount) || actualAmount < 0) {
    return NextResponse.json(
      { error: 'actualAmount must be zero or a positive number' },
      { status: 400 },
    );
  }

  try {
    const line = await budget.settleLineManually(id, actualAmount, session!.user.id);
    if (!line) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ line });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to settle' },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;
  const { id } = await params;

  const existing = await budget.getLine(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!budget.canAccess(getAccountScope(session!), existing.accountKey)) return forbidden();

  const line = await budget.unsettleLine(id, session!.user.id);
  if (!line) {
    return NextResponse.json({ error: 'That line is not settled.' }, { status: 400 });
  }
  return NextResponse.json({ line });
}
