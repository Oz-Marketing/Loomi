import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { updateChannel } from '@/lib/services/budget-channels';

/**
 * PATCH /api/budget-channels/[id] — update one channel's label, display group,
 * line type, rate card, pacer, intake task kinds, icon, external ids or
 * archived state.
 *
 * `key` is absent on purpose: BudgetLine.channel stores it as a plain string,
 * so changing it would detach every line placed on that channel.
 *
 * There is no DELETE. Archiving is the retire path.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requirePermission('agency.platform.configure');
  if (error) return error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);

  try {
    const channel = await updateChannel(id, {
      label: body.label === undefined ? undefined : String(body.label),
      category: body.category === undefined ? undefined : String(body.category),
      lineType: body.lineType === undefined ? undefined : String(body.lineType),
      billingKey:
        body.billingKey === undefined ? undefined : body.billingKey === null || body.billingKey === '' ? null : String(body.billingKey),
      pacer:
        body.pacer === undefined ? undefined : body.pacer === null || body.pacer === '' ? null : String(body.pacer),
      intakeKinds:
        body.intakeKinds === undefined ? undefined : (body.intakeKinds as unknown[]).map(String),
      icon: body.icon === undefined ? undefined : body.icon === null || body.icon === '' ? null : String(body.icon),
      externalIds: body.externalIds === undefined ? undefined : (body.externalIds as unknown[]).map(Number),
      archived: body.archived === undefined ? undefined : Boolean(body.archived),
    });
    return NextResponse.json({ channel });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not save that channel.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
