import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as budget from '@/lib/services/budget';

/**
 * POST /api/budget/lines/[id]/allocate — split money off a pool line onto a
 * more-specific one (the oz-reports pool → category → channel → month
 * progression). Partial allocation is the normal case: the source keeps the
 * remainder, and both sides get linked events.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;
  const { id } = await params;

  const source = await budget.getLine(id);
  if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!budget.canAccess(getAccountScope(session!), source.accountKey)) return forbidden();

  const body = await req.json().catch(() => ({}));
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
  }

  try {
    const result = await budget.allocateFromLine(
      id,
      {
        amount,
        period: 'period' in body ? (body.period ?? null) : undefined,
        channel: 'channel' in body ? (body.channel ?? null) : undefined,
        taskId: body.taskId ?? null,
        initiativeId: body.initiativeId ?? null,
        label: typeof body.label === 'string' ? body.label : null,
        notes: typeof body.notes === 'string' ? body.notes : null,
      },
      session!.user.id,
    );
    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    // Over-allocating a SOURCE line is a hard error (you can't split off more
    // than it holds) — distinct from over-allocating the account's declared
    // total, which is only ever a warning (docs §8.3).
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to allocate' },
      { status: 400 },
    );
  }
}
