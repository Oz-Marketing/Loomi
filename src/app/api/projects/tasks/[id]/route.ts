import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as projects from '@/lib/services/projects';

/** GET /api/projects/tasks/[id] — task + comments + activity thread. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;
  const { id } = await params;

  const data = await projects.getTaskWithThread(id);
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!projects.canAccess(getAccountScope(session!), data.task.accountKey)) return forbidden();
  return NextResponse.json(data);
}

/** PATCH /api/projects/tasks/[id] — update fields (status, assignee, …). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;
  const { id } = await params;

  const existing = await projects.getTask(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!projects.canAccess(getAccountScope(session!), existing.accountKey)) return forbidden();

  const body = await req.json().catch(() => ({}));
  const task = await projects.updateTask(id, body, session!.user.id);
  return NextResponse.json({ task });
}

/** DELETE /api/projects/tasks/[id] — soft-archive a task. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;
  const { id } = await params;

  const existing = await projects.getTask(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!projects.canAccess(getAccountScope(session!), existing.accountKey)) return forbidden();

  await projects.archiveTask(id, session!.user.id);
  return NextResponse.json({ success: true });
}
