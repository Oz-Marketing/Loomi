import { NextRequest, NextResponse } from 'next/server';
import { requireAllPermissions } from '@/lib/permissions/require';
import { parseSendTime, prepareEmailSchedule } from '@/lib/services/blast-schedule';
import {
  BlastNotDraftError,
  getEmailBlast,
  scheduleEmailBlastDraft,
} from '@/lib/services/email-blasts';
import { clientErrorMessage } from '@/lib/api-errors';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/blasts/email/[id]/schedule
 *
 * Final step of the campaign builder: transitions the draft to
 * 'scheduled' (or 'queued' if send time is now/past) and persists
 * recipient rows. pg-boss fires it once scheduledFor passes.
 *
 * Body: `{ scheduledFor?: string | null }`. The audience is the one the draft
 * saved on the Recipients step, resolved here — see lib/services/blast-schedule.
 * Only a draft can be scheduled; anything else is a 409.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  // Scheduling IS sending — pg-boss fires it unattended once the time passes,
  // so this needs the same capability as an immediate send.
  const { session, error } = await requireAllPermissions([
    'studio.email.edit',
    'blast.send',
  ]);
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

  // Fast, friendly refusal. The schedule write re-checks this under a row
  // lock, which is what actually stops a double-submit.
  if (existing.status !== 'draft') {
    return NextResponse.json({ error: new BlastNotDraftError().message }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const sendTime = parseSendTime(body?.scheduledFor);
  if (!sendTime.ok) return NextResponse.json(sendTime.body, { status: sendTime.status });

  const prepared = await prepareEmailSchedule(existing, session!.user);
  if (!prepared.ok) return NextResponse.json(prepared.body, { status: prepared.status });
  if (prepared.recipients.length === 0) {
    return NextResponse.json(
      { error: 'No one in this audience can receive email. Pick recipients on the Recipients step.' },
      { status: 400 },
    );
  }

  try {
    const updated = await scheduleEmailBlastDraft(id, {
      recipients: prepared.recipients,
      scheduledFor: sendTime.scheduledFor,
    });
    return NextResponse.json({ campaign: updated }, { status: 200 });
  } catch (err) {
    if (err instanceof BlastNotDraftError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = clientErrorMessage(err, 'Failed to schedule campaign');
    const status = message.includes('required') || message.includes('valid') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
