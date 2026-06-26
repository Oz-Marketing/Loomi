import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as teams from '@/lib/services/teams';

/**
 * GET /api/teams — list active teams (with members) + the internal-user
 * directory for the member picker. Internal-staff only.
 */
export async function GET() {
  const { error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const [list, users] = await Promise.all([
    teams.listTeamsWithMembers(),
    teams.listInternalUsers(),
  ]);
  return NextResponse.json({ teams: list, users });
}

/** POST /api/teams — create a team. */
export async function POST(req: NextRequest) {
  const { error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const created = await teams.createTeam({
    name,
    description: typeof body.description === 'string' ? body.description : null,
    color: typeof body.color === 'string' ? body.color : null,
  });
  const team = await teams.getTeamWithMembers(created.id);
  return NextResponse.json({ team }, { status: 201 });
}
