import { withRouteErrors } from '@/lib/api-errors';
import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import * as teams from '@/lib/services/teams';

/**
 * GET /api/teams — list active teams (with members) + the internal-user
 * directory for the member picker. Internal-staff only.
 */
async function handleGet() {
  const { error } = await requirePermission('agency.teams.manage');
  if (error) return error;

  const [list, users] = await Promise.all([
    teams.listTeamsWithMembers(),
    teams.listInternalUsers(),
  ]);
  return NextResponse.json({ teams: list, users });
}

/** POST /api/teams — create a team. */
async function handlePost(req: NextRequest) {
  const { error } = await requirePermission('agency.teams.manage');
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
    icon: typeof body.icon === 'string' ? body.icon : null,
  });
  const team = await teams.getTeamWithMembers(created.id);
  return NextResponse.json({ team }, { status: 201 });
}

// Wrapped so an unhandled throw returns the JSON error envelope instead of
// a 500 with an empty body, which a caller cannot parse or report.
export const GET = withRouteErrors(handleGet, 'teams');
export const POST = withRouteErrors(handlePost, 'teams');
