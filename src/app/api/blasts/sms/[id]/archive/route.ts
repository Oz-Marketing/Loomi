import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { getSmsBlast } from '@/lib/services/sms-blasts';
import { archiveBlastWithLinkedChannels } from '@/lib/services/blast-linked';
import { clientErrorMessage } from '@/lib/api-errors';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** POST /api/blasts/sms/[id]/archive — toggle archive on an SMS campaign. */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requirePermission('studio.email.edit');
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

  const body = await req.json().catch(() => ({}));
  const archived = typeof body?.archived === 'boolean' ? body.archived : true;

  try {
    // An Email + Text pair is archived as a pair — see blast-linked.ts.
    const result = await archiveBlastWithLinkedChannels('sms', id, archived);
    return NextResponse.json({ campaign: result.primary, partnerError: result.partnerError });
  } catch (err) {
    const message = clientErrorMessage(err, 'Failed to archive campaign');
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
