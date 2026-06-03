import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { forbidTemplateMutation } from '@/lib/flows/route-guards';
import {
  archiveFlow,
  getFlow,
  updateFlow,
  type FlowSettings,
} from '@/lib/services/loomi-flows';

function accountScope(session: {
  user: { role: string; accountKeys?: string[] };
}): string[] | null {
  if (session.user.role === 'client' || session.user.role === 'admin') {
    return session.user.accountKeys ?? [];
  }
  return null;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin', 'client');
  if (error) return error;

  const { id } = await context.params;
  const flow = await getFlow(id, accountScope(session!));
  if (!flow) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ flow });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await context.params;
  // Confirm the flow exists + is accessible to this caller before
  // we let them mutate it.
  const scope = accountScope(session!);
  const existing = await getFlow(id, scope);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const templateGuard = forbidTemplateMutation(existing.accountKey, scope);
  if (templateGuard) return templateGuard;

  const body = await req.json().catch(() => ({}));
  const data: {
    name?: string;
    description?: string | null;
    settings?: FlowSettings;
  } = {};
  if (typeof body?.name === 'string') data.name = body.name;
  if (body?.description === null || typeof body?.description === 'string') {
    data.description = body.description;
  }
  // Settings shape is trusted to be FlowSettings — parseFlowSettings
  // in the service normalises on read, so even partial/malformed
  // payloads survive a round-trip.
  if (body?.settings && typeof body.settings === 'object') {
    data.settings = body.settings as FlowSettings;
  }

  const flow = await updateFlow(id, data);
  return NextResponse.json({ flow });
}

// DELETE /api/flows/[id]
//
// Default: soft-archive (status='archived'). Hidden from listFlows
// but stays in the DB so the row can be restored if needed.
//
// With `?purge=true`: hard-delete the row. Cascades wipe nodes,
// edges, triggers, enrollments, and orphans any instances of this
// template (parentTemplateId is set to null via SetNull). Reserved
// for the explicit "Delete" action — Archive remains the default.
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await context.params;
  const scope = accountScope(session!);
  const existing = await getFlow(id, scope);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const templateGuard = forbidTemplateMutation(existing.accountKey, scope);
  if (templateGuard) return templateGuard;

  const purge = req.nextUrl.searchParams.get('purge') === 'true';
  if (purge) {
    await prisma.loomiFlow.delete({ where: { id } });
    return NextResponse.json({ purged: true, id });
  }

  const flow = await archiveFlow(id);
  return NextResponse.json({ flow });
}
