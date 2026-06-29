import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as projects from '@/lib/services/projects';

/** PATCH /api/projects/initiatives/[id] — edit name/status/priority/owner/due. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;
  const { id } = await params;

  const existing = await projects.getInitiative(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!projects.canAccess(getAccountScope(session!), existing.accountKey)) return forbidden();

  const body = await req.json().catch(() => ({}));
  const initiative = await projects.updateInitiative(id, body);
  return NextResponse.json({ initiative });
}

/** DELETE /api/projects/initiatives/[id] — soft-archive. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;
  const { id } = await params;

  const existing = await projects.getInitiative(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!projects.canAccess(getAccountScope(session!), existing.accountKey)) return forbidden();

  await projects.archiveInitiative(id);
  return NextResponse.json({ success: true });
}
