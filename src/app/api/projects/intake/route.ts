import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as projects from '@/lib/services/projects';

/**
 * POST /api/projects/intake — file a ticket. Creates (or attaches to) an
 * initiative for the account and spins up one task per selected team, firing
 * assignment / team notifications. Internal-staff only.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const scope = getAccountScope(session!);
  const body = await req.json().catch(() => ({}));

  const accountKey = typeof body.accountKey === 'string' ? body.accountKey : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const teamKeys = Array.isArray(body.teamKeys) ? body.teamKeys.map(String) : [];

  if (!accountKey || !title) {
    return NextResponse.json({ error: 'accountKey and title are required' }, { status: 400 });
  }
  if (!projects.canAccess(scope, accountKey)) return forbidden();

  const result = await projects.createTicket(
    {
      accountKey,
      initiativeId: body.initiativeId ?? null,
      initiativeName: body.initiativeName ?? null,
      templateKey: body.templateKey ?? null,
      teamKeys,
      title,
      description: typeof body.description === 'string' ? body.description : null,
      priority: typeof body.priority === 'string' ? body.priority : undefined,
      kind: typeof body.kind === 'string' ? body.kind : undefined,
      dueDate: body.dueDate ?? null,
      assigneeUserId: body.assigneeUserId ?? null,
    },
    session!.user.id,
  );

  return NextResponse.json(result, { status: 201 });
}
