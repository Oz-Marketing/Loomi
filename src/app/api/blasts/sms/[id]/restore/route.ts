import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import {
  getSmsBlast,
  restoreSmsBlast,
} from '@/lib/services/sms-blasts';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/blasts/sms/[id]/restore — admin-gated.
 *
 * Pulls an archived SMS campaign back to a non-archived state.
 * Rejects rows that aren't currently archived.
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireRole(
    'developer',
    'super_admin',
    'admin',
  );
  if (error) return error;

  const { id } = await params;
  const existing = await getSmsBlast(id);
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

  try {
    const updated = await restoreSmsBlast(id);
    return NextResponse.json({ campaign: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to restore campaign';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
