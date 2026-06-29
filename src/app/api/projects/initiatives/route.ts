import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as projects from '@/lib/services/projects';

/** GET /api/projects/initiatives — list initiatives the user can see. */
export async function GET(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const scope = getAccountScope(session!);
  const sp = req.nextUrl.searchParams;
  const initiatives = await projects.listInitiatives({
    scope,
    accountKey: sp.get('accountKey'),
    status: sp.get('status'),
  });
  return NextResponse.json({ initiatives });
}

/** POST /api/projects/initiatives — create an initiative. */
export async function POST(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const scope = getAccountScope(session!);
  const body = await req.json().catch(() => ({}));
  const accountKey = typeof body.accountKey === 'string' ? body.accountKey : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';

  if (!accountKey || !name) {
    return NextResponse.json({ error: 'accountKey and name are required' }, { status: 400 });
  }
  if (!projects.canAccess(scope, accountKey)) return forbidden();

  const initiative = await projects.createInitiative({
    accountKey,
    name,
    description: typeof body.description === 'string' ? body.description : null,
    priority: typeof body.priority === 'string' ? body.priority : undefined,
    dueDate: body.dueDate ?? null,
    ownerUserId: body.ownerUserId ?? session!.user.id,
    createdByUserId: session!.user.id,
  });
  return NextResponse.json({ initiative }, { status: 201 });
}
