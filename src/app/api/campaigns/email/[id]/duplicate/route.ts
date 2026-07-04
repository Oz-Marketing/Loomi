import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import {
  duplicateEmailBlast,
  getEmailBlast,
} from '@/lib/services/email-blasts';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/campaigns/email/[id]/duplicate
 *
 * Clone an existing email campaign into a new draft. Used by the
 * campaigns-list bulk-actions dock (Copy). Recipient rows are NOT
 * carried over — the new draft starts at the Recipients step.
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
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

  try {
    const copy = await duplicateEmailBlast(id, {
      createdByUserId: session!.user.id,
      createdByRole: session!.user.role,
    });
    return NextResponse.json({ campaign: copy });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to duplicate campaign';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
