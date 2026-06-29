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

  const accountKeys: string[] = Array.isArray(body.accountKeys)
    ? body.accountKeys.map(String).filter(Boolean)
    : [];
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  // Per-department type entries: [{ teamKey, kind, details }].
  const departments: { teamKey: string; kind: string; details?: Record<string, unknown> }[] =
    Array.isArray(body.departments)
      ? body.departments
          .filter((d: unknown): d is { teamKey: string; kind?: string; details?: unknown } =>
            !!d && typeof (d as { teamKey?: unknown }).teamKey === 'string',
          )
          .map((d: { teamKey: string; kind?: string; details?: unknown }) => ({
            teamKey: d.teamKey,
            kind: typeof d.kind === 'string' ? d.kind : 'generic',
            details:
              d.details && typeof d.details === 'object'
                ? (d.details as Record<string, unknown>)
                : undefined,
          }))
      : [];

  const meta =
    body.meta && typeof body.meta === 'object' ? (body.meta as Record<string, unknown>) : null;
  const billing =
    body.billing && typeof body.billing === 'object'
      ? (body.billing as Record<string, unknown>)
      : null;

  if (accountKeys.length === 0 || !title) {
    return NextResponse.json({ error: 'accountKeys and title are required' }, { status: 400 });
  }
  // Caller must be able to access every selected dealer.
  if (!accountKeys.every((k) => projects.canAccess(scope, k))) return forbidden();

  const result = await projects.createTicket(
    {
      accountKeys,
      initiativeId: body.initiativeId ?? null,
      initiativeName: body.initiativeName ?? null,
      createInitiative: body.createInitiative === true,
      templateKey: body.templateKey ?? null,
      departments,
      creativeMode: body.creativeMode === 'shared' ? 'shared' : 'unique',
      title,
      description: typeof body.description === 'string' ? body.description : null,
      priority: typeof body.priority === 'string' ? body.priority : undefined,
      dueDate: body.dueDate ?? null,
      assigneeUserId: body.assigneeUserId ?? null,
      meta,
      billing,
    },
    session!.user.id,
  );

  return NextResponse.json(result, { status: 201 });
}
