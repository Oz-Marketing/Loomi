import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as teams from '@/lib/services/teams';

/**
 * PATCH /api/teams/[id] — update a team's fields and/or its membership set.
 * Accepts any of { name, description, color, sortOrder, memberIds, leadIds }.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const hasFieldEdit =
    body.name !== undefined ||
    body.description !== undefined ||
    body.color !== undefined ||
    body.sortOrder !== undefined;

  if (hasFieldEdit) {
    await teams.updateTeam(id, {
      name: body.name,
      description: body.description,
      color: body.color,
      sortOrder: body.sortOrder,
    });
  }

  if (Array.isArray(body.memberIds)) {
    await teams.setTeamMembers(
      id,
      body.memberIds.map(String),
      Array.isArray(body.leadIds) ? body.leadIds.map(String) : [],
    );
  }

  const team = await teams.getTeamWithMembers(id);
  return NextResponse.json({ team });
}

/** DELETE /api/teams/[id] — soft-archive a team. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const { id } = await params;
  await teams.archiveTeam(id);
  return NextResponse.json({ success: true });
}
