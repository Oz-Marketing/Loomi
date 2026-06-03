import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { forbidTemplateMutation } from '@/lib/flows/route-guards';
import {
  deleteTrigger,
  getFlow,
  updateTrigger,
} from '@/lib/services/loomi-flows';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; triggerId: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id, triggerId } = await context.params;
  const scope =
    session!.user.role === 'client' || session!.user.role === 'admin'
      ? (session!.user.accountKeys ?? [])
      : null;
  const existing = await getFlow(id, scope);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const templateGuard = forbidTemplateMutation(existing.accountKey, scope);
  if (templateGuard) return templateGuard;
  // The triggerId must belong to THIS flow. updateTrigger/deleteTrigger
  // operate on the id alone, so without this check a caller who owns
  // flow [id] could mutate or delete a trigger on another account's flow.
  if (!existing.triggers.some((t) => t.id === triggerId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const trigger = await updateTrigger(triggerId, {
    config: body?.config,
    enabled: typeof body?.enabled === 'boolean' ? body.enabled : undefined,
  });
  return NextResponse.json({ trigger });
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string; triggerId: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id, triggerId } = await context.params;
  const scope =
    session!.user.role === 'client' || session!.user.role === 'admin'
      ? (session!.user.accountKeys ?? [])
      : null;
  const existing = await getFlow(id, scope);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const templateGuard = forbidTemplateMutation(existing.accountKey, scope);
  if (templateGuard) return templateGuard;
  // The triggerId must belong to THIS flow. updateTrigger/deleteTrigger
  // operate on the id alone, so without this check a caller who owns
  // flow [id] could mutate or delete a trigger on another account's flow.
  if (!existing.triggers.some((t) => t.id === triggerId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await deleteTrigger(triggerId);
  return NextResponse.json({ ok: true });
}
