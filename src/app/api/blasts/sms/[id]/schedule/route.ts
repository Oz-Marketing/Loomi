import { NextRequest, NextResponse } from 'next/server';
import { requireAllPermissions } from '@/lib/permissions/require';
import { parseSendTime, prepareSmsSchedule } from '@/lib/services/blast-schedule';
import { BlastNotDraftError } from '@/lib/services/email-blasts';
import { getSmsBlast, scheduleSmsBlastDraft } from '@/lib/services/sms-blasts';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/blasts/sms/[id]/schedule
 *
 * Transitions an SMS draft to 'scheduled' (or 'queued' if immediate) and
 * persists recipient rows. pg-boss fires it once scheduledFor passes.
 *
 * Body: `{ scheduledFor?: string | null }`. The audience is the one the draft
 * saved on the Recipients step, resolved here — see lib/services/blast-schedule.
 * Only a draft can be scheduled; anything else is a 409.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  // Same as the email side: scheduling is an unattended send.
  const { session, error } = await requireAllPermissions([
    'studio.email.edit',
    'blast.send',
  ]);
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

  // Fast, friendly refusal. The schedule write re-checks this under a row
  // lock, which is what actually stops a double-submit.
  if (existing.status !== 'draft') {
    return NextResponse.json({ error: new BlastNotDraftError().message }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const sendTime = parseSendTime(body?.scheduledFor);
  if (!sendTime.ok) return NextResponse.json(sendTime.body, { status: sendTime.status });

  // Compliance + deliverability gate, assessed at the instant the text would
  // go out: an immediate send happens within a minute of now, a scheduled one
  // at its own time. Quiet hours depend on exactly that instant.
  const prepared = await prepareSmsSchedule(
    existing,
    session!.user,
    sendTime.scheduledFor ?? new Date(),
  );
  if (!prepared.ok) return NextResponse.json(prepared.body, { status: prepared.status });
  if (prepared.recipients.length === 0) {
    return NextResponse.json(
      { error: 'No one in this audience has a textable phone number. Pick recipients on the Recipients step.' },
      { status: 400 },
    );
  }

  try {
    const updated = await scheduleSmsBlastDraft(id, {
      recipients: prepared.recipients,
      scheduledFor: sendTime.scheduledFor,
    });
    return NextResponse.json({ campaign: updated }, { status: 200 });
  } catch (err) {
    if (err instanceof BlastNotDraftError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : 'Failed to schedule campaign';
    const status = message.includes('required') || message.includes('valid') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
