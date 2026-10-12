import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { resolveDraftRecipients } from '@/lib/segments/draft-recipients';
import { getEmailBlast } from '@/lib/services/email-blasts';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/blasts/email/[id]/audience → `{ total }`
 *
 * How many people this blast would send to if scheduled now — resolved by
 * the SAME code the schedule route runs (lib/segments/draft-recipients), with
 * a saved segment's current definition, opt-outs and duplicate addresses
 * applied. The Schedule step's count therefore agrees with the send by
 * construction. A count only: no names, emails or phones leave the server.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requirePermission('studio.email.edit');
  if (error) return error;

  const { id } = await params;
  const blast = await getEmailBlast(id);
  if (!blast) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  if (session!.user.role === 'admin' && userAccountKeys.length > 0) {
    const allowed = new Set(userAccountKeys);
    if (
      blast.accountKeys.length > 0 &&
      !blast.accountKeys.some((key) => allowed.has(key))
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const resolved = await resolveDraftRecipients(blast, 'email');
  if (!resolved.ok) return NextResponse.json({ total: 0, reason: resolved.error });
  return NextResponse.json({ total: resolved.recipients.length });
}
