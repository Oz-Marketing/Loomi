import { NextResponse } from 'next/server';
import { requireRole, getAccountScope } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import { getAccounts } from '@/lib/services/accounts';
import { listTeams, listInternalUsers } from '@/lib/services/teams';

/**
 * GET /api/projects/options — pickers for the intake form and view filters:
 * the accounts the user can see, the active teams, and the internal-user
 * directory. Internal-staff only.
 */
export async function GET() {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const scope = getAccountScope(session!);
  const accountKeys = scope && scope.length > 0 ? scope : undefined;

  const [accountsRaw, teams, users] = await Promise.all([
    getAccounts(accountKeys),
    listTeams(),
    listInternalUsers(),
  ]);

  const accounts = accountsRaw.map((a) => ({
    key: a.key,
    dealer: a.dealer,
    slug: a.slug,
    // Parsed { light, dark, white?, black? } so the pickers can show the
    // account's logo via AccountAvatar (mirrors the studio account switcher).
    logos: parseLogos(a.logos),
  }));
  const teamsOut = teams.map((t) => ({ key: t.key, name: t.name, color: t.color }));

  return NextResponse.json({ accounts, teams: teamsOut, users });
}

function parseLogos(
  raw: string | null,
): { light?: string; dark?: string; white?: string; black?: string } | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
