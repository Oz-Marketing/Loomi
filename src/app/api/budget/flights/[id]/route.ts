import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as budget from '@/lib/services/budget';

/**
 * GET    — the flight and its months.
 * PATCH  — move the dates or change the total; the months re-split. Settled
 *          months keep their money and the remainder spreads around them.
 * DELETE — cancel every open month. Settled ones stay as history.
 */
async function load(id: string, scope: string[] | null) {
  const flight = await budget.getFlight(id);
  if (!flight) return { flight: null, denied: false };
  return { flight, denied: !budget.canAccess(scope, flight.accountKey) };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;
  const { id } = await params;

  const { flight, denied } = await load(id, getAccountScope(session!));
  if (!flight) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (denied) return forbidden();
  return NextResponse.json({ flight });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;
  const { id } = await params;

  const { flight, denied } = await load(id, getAccountScope(session!));
  if (!flight) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (denied) return forbidden();

  const body = await req.json().catch(() => ({}));
  try {
    const updated = await budget.updateFlight(
      id,
      {
        startDate: typeof body.startDate === 'string' ? body.startDate : undefined,
        endDate: typeof body.endDate === 'string' ? body.endDate : undefined,
        amount: body.amount == null ? undefined : Number(body.amount),
        label: 'label' in body ? (body.label ?? null) : undefined,
      },
      session!.user.id,
    );
    return NextResponse.json({ flight: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not update the flight' },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;
  const { id } = await params;

  const { flight, denied } = await load(id, getAccountScope(session!));
  if (!flight) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (denied) return forbidden();

  return NextResponse.json({ canceled: await budget.cancelFlight(id) });
}
