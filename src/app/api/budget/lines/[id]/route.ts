import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as budget from '@/lib/services/budget';

/**
 * GET    /api/budget/lines/[id] — one line plus its event trail.
 * PATCH  /api/budget/lines/[id] — edit amount / placement / status / bucket.
 * DELETE /api/budget/lines/[id] — cancel it. `?toPool=true` returns the money
 *        to the account's pool instead of just writing it off.
 */

async function loadAuthorized(id: string, scope: string[] | null) {
  const line = await budget.getLine(id);
  if (!line) return { line: null, denied: false };
  return { line, denied: !budget.canAccess(scope, line.accountKey) };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;
  const { id } = await params;

  const { line, denied } = await loadAuthorized(id, getAccountScope(session!));
  if (!line) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (denied) return forbidden();

  const events = await budget.listLineEvents(id);
  return NextResponse.json({ line, events });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;
  const { id } = await params;

  const scope = getAccountScope(session!);
  const { line: existing, denied } = await loadAuthorized(id, scope);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (denied) return forbidden();

  const body = await req.json().catch(() => ({}));
  if (
    typeof body.spendAccountKey === 'string' &&
    !budget.canAccess(scope, body.spendAccountKey)
  ) {
    return forbidden();
  }

  try {
    const line = await budget.updateLine(
      id,
      {
        amount: body.amount == null ? undefined : Number(body.amount),
        // `undefined` = leave alone, `null` = clear back to pool. Reading the
        // key's presence rather than its truthiness is what makes "unplace this
        // line" expressible at all.
        period: 'period' in body ? (body.period ?? null) : undefined,
        channel: 'channel' in body ? (body.channel ?? null) : undefined,
        status: typeof body.status === 'string' ? body.status : undefined,
        bucket: typeof body.bucket === 'string' ? body.bucket : undefined,
        label: 'label' in body ? (body.label ?? null) : undefined,
        notes: 'notes' in body ? (body.notes ?? null) : undefined,
        spendAccountKey:
          typeof body.spendAccountKey === 'string' ? body.spendAccountKey : undefined,
      },
      session!.user.id,
    );
    return NextResponse.json({ line });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update budget line' },
      { status: 400 },
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;
  const { id } = await params;

  const { line: existing, denied } = await loadAuthorized(id, getAccountScope(session!));
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (denied) return forbidden();

  const toPool = req.nextUrl.searchParams.get('toPool') === 'true';
  try {
    if (toPool) {
      const pooled = await budget.returnToPool(
        id,
        session!.user.id,
        req.nextUrl.searchParams.get('reason'),
      );
      return NextResponse.json({ ok: true, pooledLine: pooled });
    }
    const ok = await budget.archiveLine(id, session!.user.id);
    return NextResponse.json({ ok });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to cancel budget line' },
      { status: 400 },
    );
  }
}
