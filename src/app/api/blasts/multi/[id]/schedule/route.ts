import { NextRequest, NextResponse } from 'next/server';
import { requireAllPermissions } from '@/lib/permissions/require';
import { parseLinkedId } from '@/lib/services/blast-cancel';
import {
  parseSendTime,
  prepareEmailSchedule,
  prepareSmsSchedule,
  scheduleLinkedBlastDrafts,
  type ScheduleRejection,
} from '@/lib/services/blast-schedule';
import {
  BlastNotDraftError,
  getEmailBlast,
  planEmailBlastSchedule,
} from '@/lib/services/email-blasts';
import { getSmsBlast, planSmsBlastSchedule } from '@/lib/services/sms-blasts';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function inScope(
  user: { role: string; accountKeys?: string[] | null },
  blastAccountKeys: string[],
): boolean {
  const allowed = user.accountKeys ?? [];
  if (user.role !== 'admin' || allowed.length === 0) return true;
  const set = new Set(allowed);
  return blastAccountKeys.length === 0 || blastAccountKeys.some((key) => set.has(key));
}

/**
 * POST /api/blasts/multi/[id]/schedule — `id` is the email half's id.
 *
 * Schedules an email + text pair as ONE decision: both gates must pass, and
 * both halves are written in one transaction (scheduleLinkedBlastDrafts), so
 * the pair is either fully scheduled or still two drafts. The Schedule step
 * used to call the two single-channel routes in parallel, which could commit
 * the email while the text was refused — and a retry then re-ran the email.
 *
 * Body: `{ scheduledFor?: string | null }`.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireAllPermissions([
    'studio.email.edit',
    'blast.send',
  ]);
  if (error) return error;
  const user = session!.user;

  const { id } = await params;
  const email = await getEmailBlast(id);
  if (!email) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }
  const smsId = parseLinkedId(email.metadata, 'linkedSmsBlastId');
  if (!smsId) {
    return NextResponse.json(
      { error: 'This blast has no linked text message to send with it.' },
      { status: 400 },
    );
  }
  const sms = await getSmsBlast(smsId);
  if (!sms) {
    return NextResponse.json({ error: 'The linked text message was not found.' }, { status: 404 });
  }

  if (!inScope(user, email.accountKeys) || !inScope(user, sms.accountKeys)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (email.status !== 'draft' || sms.status !== 'draft') {
    return NextResponse.json({ error: new BlastNotDraftError().message }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const sendTime = parseSendTime(body?.scheduledFor);
  if (!sendTime.ok) return NextResponse.json(sendTime.body, { status: sendTime.status });

  const [emailPrep, smsPrep] = await Promise.all([
    prepareEmailSchedule(email, user),
    prepareSmsSchedule(sms, user, sendTime.scheduledFor ?? new Date()),
  ]);

  // Either gate refusing stops both halves. Report every refusal, labeled by
  // channel, so one round trip shows the user everything to fix.
  if (!emailPrep.ok || !smsPrep.ok) {
    const refusals: [string, ScheduleRejection][] = [];
    if (!emailPrep.ok) refusals.push(['Email', emailPrep]);
    if (!smsPrep.ok) refusals.push(['Text', smsPrep]);
    // Access and input problems outrank deliverability ones.
    const status = refusals.some(([, r]) => r.status === 403)
      ? 403
      : refusals.some(([, r]) => r.status === 400)
        ? 400
        : 422;
    return NextResponse.json(
      {
        error: refusals.map(([label, r]) => `${label}: ${r.body.error}`).join(' '),
        issues: refusals.flatMap(([label, r]) =>
          Array.isArray(r.body.issues)
            ? (r.body.issues as Record<string, unknown>[]).map((issue) => ({
                ...issue,
                channel: label,
              }))
            : [],
        ),
        suggestedSendAt: !smsPrep.ok ? (smsPrep.body.suggestedSendAt ?? null) : null,
      },
      { status },
    );
  }

  // A pair with an empty side is refused rather than half-sent: the list shows
  // the pair as one row on the email half, so a lone text behind a draft email
  // would be a send no one could see or cancel.
  if (emailPrep.recipients.length === 0 || smsPrep.recipients.length === 0) {
    const missing = emailPrep.recipients.length === 0 ? 'an email address' : 'a textable phone number';
    return NextResponse.json(
      {
        error:
          `No one in this audience has ${missing}, so the pair can't go out together. ` +
          'Change the audience, or send a single-channel blast instead.',
      },
      { status: 400 },
    );
  }

  try {
    const [emailPlan, smsPlan] = await Promise.all([
      planEmailBlastSchedule(email.id, {
        recipients: emailPrep.recipients,
        scheduledFor: sendTime.scheduledFor,
      }),
      planSmsBlastSchedule(sms.id, {
        recipients: smsPrep.recipients,
        scheduledFor: sendTime.scheduledFor,
      }),
    ]);
    await scheduleLinkedBlastDrafts(emailPlan, smsPlan);
    return NextResponse.json({
      scheduled: { emailId: email.id, smsId: sms.id, status: emailPlan.status },
    });
  } catch (err) {
    if (err instanceof BlastNotDraftError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : 'Failed to schedule campaign';
    const status = message.includes('required') || message.includes('valid') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
