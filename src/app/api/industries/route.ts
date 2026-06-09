import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { ELEVATED_ROLES, MANAGEMENT_ROLES } from '@/lib/roles';
import { getIndustries, setIndustries } from '@/lib/services/industries';

/**
 * The account "Industry" option list (AppSetting-backed; see
 * services/industries.ts).
 *
 * GET  — any management-tier user (developer / super_admin / admin) so the
 *        account-creation + edit dropdowns can render the current list.
 * PUT  — elevated only (developer / super_admin); replaces the whole list.
 *        Whole-list replace keeps add / rename / delete / reorder a single
 *        round-trip from the manager UI.
 */
export async function GET() {
  const { error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    return NextResponse.json({ industries: await getIndustries() });
  } catch {
    // Never break the dropdowns on a read error — the client also falls back.
    return NextResponse.json({ industries: [] });
  }
}

export async function PUT(req: NextRequest) {
  const { error } = await requireRole(...ELEVATED_ROLES);
  if (error) return error;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  if (!Array.isArray(body.industries)) {
    return NextResponse.json({ error: 'industries must be an array of strings.' }, { status: 400 });
  }

  try {
    const industries = await setIndustries(body.industries);
    return NextResponse.json({ industries });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not save industries.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
