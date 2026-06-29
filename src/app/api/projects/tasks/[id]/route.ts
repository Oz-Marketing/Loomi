import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as projects from '@/lib/services/projects';
import { STATUSES, KIND_META } from '@/lib/projects/ui';

const STATUS_KEYS = new Set(STATUSES.map((s) => s.key));
const PRIORITY_KEYS = new Set(['low', 'medium', 'high', 'urgent']);
const KIND_KEYS = new Set(Object.keys(KIND_META));
type Attachment = { id: string; name: string; url: string };

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

  const scope = getAccountScope(session!);
  const existing = await projects.getTask(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!projects.canAccess(scope, existing.accountKey)) return forbidden();

  const body = await req.json().catch(() => ({}));

  // Whitelist + validate — never forward the raw body (which could move the task
  // into an out-of-scope initiative, set bogus enums, or clobber reserved
  // `details` keys like _notify/_ticket).
  const patch: Parameters<typeof projects.updateTask>[1] = {};
  if (typeof body.title === 'string') patch.title = body.title;
  if (body.description === null || typeof body.description === 'string') patch.description = body.description;
  if (typeof body.status === 'string' && STATUS_KEYS.has(body.status)) patch.status = body.status;
  if (typeof body.priority === 'string' && PRIORITY_KEYS.has(body.priority)) patch.priority = body.priority;
  if (typeof body.kind === 'string' && KIND_KEYS.has(body.kind)) patch.kind = body.kind;
  if (body.teamKey === null || typeof body.teamKey === 'string') patch.teamKey = body.teamKey;
  if (body.assigneeUserId === null || typeof body.assigneeUserId === 'string')
    patch.assigneeUserId = body.assigneeUserId;
  if (body.dueDate === null || typeof body.dueDate === 'string') patch.dueDate = body.dueDate;
  if (body.startDate === null || typeof body.startDate === 'string') patch.startDate = body.startDate;
  if (typeof body.position === 'number' && Number.isFinite(body.position)) patch.position = body.position;

  // Moving into an initiative requires access to that initiative's account.
  if (body.initiativeId === null) {
    patch.initiativeId = null;
  } else if (typeof body.initiativeId === 'string') {
    const init = await projects.getInitiative(body.initiativeId);
    if (!init || !projects.canAccess(scope, init.accountKey)) return forbidden();
    patch.initiativeId = body.initiativeId;
  }

  // `details` from the client is limited to attachments — per-type fields are
  // intake-only, and reserved keys (_notify/_ticket) must never be client-set.
  if (body.details && typeof body.details === 'object' && Array.isArray(body.details._attachments)) {
    patch.details = {
      _attachments: (body.details._attachments as unknown[])
        .filter((f): f is Attachment => !!f && typeof (f as Attachment).url === 'string')
        .map((f) => ({ id: String(f.id), name: String(f.name), url: String(f.url) })),
    };
  }

  const task = await projects.updateTask(id, patch, session!.user.id);
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
