import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { ELEVATED_ROLES, MANAGEMENT_ROLES } from '@/lib/roles';
import {
  getGlobalDefaultMarkup,
  setGlobalDefaultMarkup,
} from '@/lib/services/markup';

/**
 * The agency-wide default markup (gross→spend factor) applied to any account
 * with no per-account override (Account.markup). AppSetting-backed; see
 * services/markup.ts. §0.1: this is the only place a default markup is set.
 *
 * GET — management-tier (developer / super_admin / admin) so the settings tab
 *       can render the current value.
 * PUT — elevated only (developer / super_admin); body { markup: number } (> 0).
 */
export async function GET() {
  const { error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    return NextResponse.json({ markup: await getGlobalDefaultMarkup() });
  } catch {
    // 0 = unconfigured; the client renders this as "not set".
    return NextResponse.json({ markup: 0 });
  }
}

export async function PUT(req: NextRequest) {
  const { error } = await requireRole(...ELEVATED_ROLES);
  if (error) return error;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const value = Number(body.markup);
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json(
      { error: 'markup must be a positive number (e.g. 0.77).' },
      { status: 400 },
    );
  }

  try {
    const markup = await setGlobalDefaultMarkup(value);
    return NextResponse.json({ markup });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not save markup.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
