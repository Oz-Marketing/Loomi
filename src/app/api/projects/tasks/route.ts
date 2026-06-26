import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as projects from '@/lib/services/projects';

/**
 * GET /api/projects/tasks — list tasks with optional filters
 * (accountKey, teamKey, assigneeUserId — `me` resolves to the caller,
 * initiativeId, status). Internal-staff only, account-scoped.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const scope = getAccountScope(session!);
  const sp = req.nextUrl.searchParams;
  let assigneeUserId = sp.get('assigneeUserId');
  if (assigneeUserId === 'me') assigneeUserId = session!.user.id;

  const tasks = await projects.listTasks({
    scope,
    accountKey: sp.get('accountKey'),
    teamKey: sp.get('teamKey'),
    assigneeUserId,
    initiativeId: sp.get('initiativeId'),
    status: sp.get('status'),
  });
  return NextResponse.json({ tasks });
}

/** POST /api/projects/tasks — create a single task. */
export async function POST(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const scope = getAccountScope(session!);
  const body = await req.json().catch(() => ({}));
  const accountKey = typeof body.accountKey === 'string' ? body.accountKey : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';

  if (!accountKey || !title) {
    return NextResponse.json({ error: 'accountKey and title are required' }, { status: 400 });
  }
  if (!projects.canAccess(scope, accountKey)) return forbidden();

  const task = await projects.createTask(
    {
      accountKey,
      initiativeId: body.initiativeId ?? null,
      parentTaskId: body.parentTaskId ?? null,
      teamKey: body.teamKey ?? null,
      title,
      description: typeof body.description === 'string' ? body.description : null,
      kind: typeof body.kind === 'string' ? body.kind : undefined,
      status: typeof body.status === 'string' ? body.status : undefined,
      priority: typeof body.priority === 'string' ? body.priority : undefined,
      assigneeUserId: body.assigneeUserId ?? null,
      dueDate: body.dueDate ?? null,
    },
    session!.user.id,
  );
  return NextResponse.json({ task }, { status: 201 });
}
