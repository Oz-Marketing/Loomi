import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { resolveDraftRecipients } from '@/lib/segments/draft-recipients';
import { preflightSmsBlast } from '@/lib/sending/sms-preflight';
import { getSmsBlast } from '@/lib/services/sms-blasts';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/blasts/sms/[id]/preflight
 *
 * Read-only compliance + deliverability report for a draft.
 *
 * POST rather than GET because quiet hours can only be assessed against the
 * actual recipient phone numbers (area code → local timezone) at a proposed
 * send time. The body carries the `scheduledFor` the send would use, and the
 * route resolves the draft's saved audience exactly as POST /schedule does,
 * so the two answer identically — this one is advisory,
 * and exists so a TCPA problem surfaces while the user is still choosing a time
 * rather than at the final click.
 *
 * Writes nothing.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  // SMS blast routes share the messaging capability with email — see the
  // sibling routes under /api/blasts/sms.
  const { session, error } = await requirePermission('studio.email.edit');
  if (error) return error;

  const { id } = await params;
  const blast = await getSmsBlast(id);
  if (!blast) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  if (session!.user.role === 'client') {
    const allowed = new Set(session!.user.accountKeys ?? []);
    if (!blast.accountKeys.some((key) => allowed.has(key))) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
  }

  const body = await req.json().catch(() => ({}));

  // Assess the audience the draft saved, resolved exactly as POST /schedule
  // resolves it. A draft with no audience yet reports "pending" below.
  const resolved = await resolveDraftRecipients(blast, 'sms');
  const recipients = resolved.ok
    ? resolved.recipients.map((r) => ({ phone: r.phone, accountKey: r.accountKey }))
    : [];

  // Admins scoped to specific accounts can't preflight outside their scope —
  // the report names dealers and their configuration state.
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  if (session!.user.role === 'admin' && userAccountKeys.length > 0) {
    const allowed = new Set(userAccountKeys);
    if (recipients.some((r) => !allowed.has(r.accountKey))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const accountKeys = [...new Set(recipients.map((r) => r.accountKey))];

  // Nothing selected yet — report "not ready" without inventing issues.
  if (accountKeys.length === 0) {
    return NextResponse.json({
      ok: false,
      issues: [],
      pending: true,
      suggestedSendAt: null,
      heldByQuietHours: 0,
    });
  }

  const scheduledFor =
    typeof body?.scheduledFor === 'string' && body.scheduledFor
      ? new Date(body.scheduledFor)
      : null;
  const sendAt =
    scheduledFor && !Number.isNaN(scheduledFor.getTime())
      ? scheduledFor
      : new Date();

  const result = await preflightSmsBlast({
    message: blast.message || '',
    accountKeys,
    recipients,
    sendAt,
    deferOutsideQuietHours: Boolean(body?.deferOutsideQuietHours),
  });

  return NextResponse.json({ ...result, pending: false });
}
