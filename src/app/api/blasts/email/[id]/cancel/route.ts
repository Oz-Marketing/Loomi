import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { getEmailBlast } from '@/lib/services/email-blasts';
import { cancelBlastWithLinkedChannels } from '@/lib/services/blast-cancel';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/blasts/email/[id]/cancel
 *
 * Stop a blast that is scheduled, queued, or mid-send. Everything still
 * pending is marked skipped and the row goes terminal, so the worker sweep
 * drops it; an in-flight send notices within about a second.
 *
 * Already-sent recipients stay sent — this stops the rest, it does not
 * recall mail that has left.
 *
 * 409 on a blast that already finished, or one that never left draft.
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requirePermission('studio.email.edit');
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
    // Cancels the linked half of a multi-channel blast too — the list shows
    // the pair as one row, so stopping only this one would leave the other
    // sending with nowhere left to stop it from.
    const result = await cancelBlastWithLinkedChannels('email', id);
    const updated = await getEmailBlast(id);
    return NextResponse.json({
      campaign: updated,
      canceledChannels: result.canceledChannels,
      ...(result.partnerError ? { partnerError: result.partnerError } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to cancel campaign';
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
