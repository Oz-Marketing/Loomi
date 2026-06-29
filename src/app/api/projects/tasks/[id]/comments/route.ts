import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as projects from '@/lib/services/projects';

/** POST /api/projects/tasks/[id]/comments — add a comment (with @mentions). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;
  const { id } = await params;

  const existing = await projects.getTask(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!projects.canAccess(getAccountScope(session!), existing.accountKey)) return forbidden();

  const body = await req.json().catch(() => ({}));
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return NextResponse.json({ error: 'body is required' }, { status: 400 });

  const comment = await projects.addComment({
    taskId: id,
    body: text,
    mentions: Array.isArray(body.mentions) ? body.mentions.map(String) : [],
    authorUserId: session!.user.id,
  });
  return NextResponse.json({ comment }, { status: 201 });
}
