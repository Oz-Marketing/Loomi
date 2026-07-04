import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import {
  getEmailBlast,
  restoreEmailBlast,
} from '@/lib/services/email-blasts';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/campaigns/email/[id]/restore — admin-gated.
 *
 * Pulls an archived email campaign back to a non-archived state. Same
 * shape as /api/flows/[id]/restore: rejects rows that aren't currently
 * archived so a misclick doesn't silently no-op.
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireRole(
    'developer',
    'super_admin',
    'admin',
  );
  if (error) return error;

  const { id } = await params;
  const existing = await getEmailBlast(id);
  if (!existing) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  // Admin role is scoped to their assigned accountKeys; reject if the
  // campaign isn't in their scope. developer / super_admin pass through.
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

  try {
    const updated = await restoreEmailBlast(id);
    return NextResponse.json({ campaign: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to restore campaign';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
