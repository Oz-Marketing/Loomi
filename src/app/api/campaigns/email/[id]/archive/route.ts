import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import {
  getEmailBlast,
  setEmailBlastArchived,
} from '@/lib/services/email-blasts';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/campaigns/email/[id]/archive
 *
 * Toggle archive on. Stored as a metadata flag, so the list endpoint
 * filters it out by default. Pass `{ archived: false }` in the body to
 * un-archive instead (defaults to true).
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await params;
  const existing = await getEmailBlast(id);
  if (!existing) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  if (userRole === 'admin' && userAccountKeys.length > 0) {
    const allowed = new Set(userAccountKeys);
    const inScope =
      existing.accountKeys.length === 0 ||
      existing.accountKeys.some((key) => allowed.has(key));
    if (!inScope) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const archived = typeof body?.archived === 'boolean' ? body.archived : true;

  try {
    const updated = await setEmailBlastArchived(id, archived);
    return NextResponse.json({ campaign: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to archive campaign';
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
