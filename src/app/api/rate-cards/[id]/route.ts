import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { updateRateCard } from '@/lib/services/rate-cards';

/**
 * PATCH /api/rate-cards/[id] — update one card's { label, markup, archived }.
 *
 * `key` is absent on purpose: budget lines and channels reference a category by
 * key, so renaming one would detach history. The label is the renameable name.
 *
 * There is no DELETE. Archiving is the retire path — see services/rate-cards.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requirePermission('finance.markup.manage');
  if (error) return error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);

  try {
    const card = await updateRateCard(id, {
      label: body.label === undefined ? undefined : String(body.label),
      markup: body.markup === undefined ? undefined : Number(body.markup),
      archived: body.archived === undefined ? undefined : Boolean(body.archived),
    });
    return NextResponse.json({ rateCard: card });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not save that rate card.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
