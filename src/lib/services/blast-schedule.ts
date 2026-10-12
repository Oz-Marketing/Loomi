// What every route that schedules a blast must check before it commits one.
//
// Three routes schedule: email, SMS, and the multi-channel pair. They used to
// each carry their own copy of these steps, and the pair didn't run them at
// all — it fired the two single-channel routes in parallel, so one half could
// commit while the other was refused. One implementation, used by all three.
//
// The audience always comes from what the draft saved on the Recipients step,
// resolved here on the server. A list posted by the browser is not accepted:
// it capped audiences at whatever fit in a request, and it let a caller with
// send rights mail addresses that were never contacts.

import {
  formatPreflightBlockers,
  preflightEmailBlast,
} from '@/lib/sending/blast-preflight';
import {
  formatSmsPreflightBlockers,
  preflightSmsBlast,
} from '@/lib/sending/sms-preflight';
import { prisma } from '@/lib/prisma';
import { resolveDraftRecipients } from '@/lib/segments/draft-recipients';
import {
  LONG_TX_OPTIONS,
  resendSubjectToCheck,
  writeEmailBlastSchedule,
  type EmailBlastSummary,
  type EmailRecipientInput,
  type EmailSchedulePlan,
} from './email-blasts';
import {
  writeSmsBlastSchedule,
  type SmsBlastSummary,
  type SmsRecipientInput,
  type SmsSchedulePlan,
} from './sms-blasts';

/** The parts of a session user that decide account scope. */
export interface ScheduleUser {
  role: string;
  accountKeys?: string[] | null;
}

/** A refusal, shaped for NextResponse.json(body, { status }). */
export interface ScheduleRejection {
  ok: false;
  status: number;
  body: { error: string } & Record<string, unknown>;
}

export type Prepared<R> = { ok: true; recipients: R[] } | ScheduleRejection;

function reject(
  status: number,
  error: string,
  extra?: Record<string, unknown>,
): ScheduleRejection {
  return { ok: false, status, body: { error, ...extra } };
}

/**
 * Admins scoped to specific accounts may only send to those accounts.
 * Unscoped staff (no account list) are not limited.
 */
function outsideScope(user: ScheduleUser, accountKeys: string[]): boolean {
  if (user.role !== 'admin') return false;
  const allowed = user.accountKeys ?? [];
  if (allowed.length === 0) return false;
  const set = new Set(allowed);
  return accountKeys.some((key) => !set.has(key));
}

/**
 * Parse the requested send time. Absent means "now". Present but unreadable is
 * an error — falling back to "now" would turn a garbled scheduled send into an
 * immediate one.
 */
export function parseSendTime(
  raw: unknown,
): { ok: true; scheduledFor: Date | null } | ScheduleRejection {
  if (raw === undefined || raw === null || raw === '') return { ok: true, scheduledFor: null };
  if (typeof raw === 'string') {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return { ok: true, scheduledFor: date };
  }
  return reject(400, 'The send time could not be read. Pick the date and time again.');
}

/** Has the user opted to hold quiet-hours recipients rather than be blocked? */
export function readDeferFlag(metadata: string | null | undefined): boolean {
  if (!metadata) return false;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    return Boolean(parsed.deferOutsideQuietHours);
  } catch {
    return false;
  }
}

/**
 * Resolve an email draft's audience and run the deliverability + CAN-SPAM gate.
 * An empty audience comes back as ok with no recipients — the caller decides
 * whether that is an error (single blast) or a skipped channel (multi).
 */
export async function prepareEmailSchedule(
  blast: EmailBlastSummary,
  user: ScheduleUser,
): Promise<Prepared<EmailRecipientInput>> {
  const resolved = await resolveDraftRecipients(blast, 'email');
  if (!resolved.ok) return reject(400, resolved.error);

  const recipients: EmailRecipientInput[] = resolved.recipients.map((r) => ({
    contactId: r.contactId,
    accountKey: r.accountKey,
    email: r.email,
    fullName: r.fullName,
  }));
  if (recipients.length === 0) return { ok: true, recipients };

  const accountKeys = [...new Set(recipients.map((r) => r.accountKey))];
  if (outsideScope(user, accountKeys)) {
    return reject(403, 'Forbidden recipient account selection');
  }

  // The last point at which a blast that would land in spam or breach
  // CAN-SPAM can be stopped, so it hard-blocks. Run against the audience's
  // accounts rather than blast.accountKeys, which the schedule write stamps.
  const preflight = await preflightEmailBlast({
    subject: blast.subject || '',
    htmlContent: blast.htmlContent || '',
    textContent: blast.textContent,
    previewText: blast.previewText,
    resendSubject: resendSubjectToCheck(blast.metadata),
    accountKeys,
    recipients: recipients.flatMap((r) =>
      r.email ? [{ accountKey: r.accountKey, email: r.email }] : [],
    ),
  });
  if (!preflight.ok) {
    return reject(422, formatPreflightBlockers(preflight), { issues: preflight.issues });
  }
  return { ok: true, recipients };
}

/**
 * Resolve an SMS draft's audience and run the TCPA / deliverability gate at the
 * instant the text would go out.
 */
export async function prepareSmsSchedule(
  blast: SmsBlastSummary,
  user: ScheduleUser,
  sendAt: Date,
): Promise<Prepared<SmsRecipientInput>> {
  const resolved = await resolveDraftRecipients(blast, 'sms');
  if (!resolved.ok) return reject(400, resolved.error);

  const recipients: SmsRecipientInput[] = resolved.recipients.map((r) => ({
    contactId: r.contactId,
    accountKey: r.accountKey,
    phone: r.phone,
    fullName: r.fullName,
  }));
  if (recipients.length === 0) return { ok: true, recipients };

  const accountKeys = [...new Set(recipients.map((r) => r.accountKey))];
  if (outsideScope(user, accountKeys)) {
    return reject(403, 'Forbidden recipient account selection');
  }

  const preflight = await preflightSmsBlast({
    message: blast.message || '',
    accountKeys,
    recipients: recipients.map((r) => ({ phone: r.phone ?? null })),
    sendAt,
    deferOutsideQuietHours: readDeferFlag(blast.metadata),
  });
  if (!preflight.ok) {
    return reject(422, formatSmsPreflightBlockers(preflight), {
      issues: preflight.issues,
      // Lets the Schedule step offer "send at 8am local time instead"
      // without recomputing the window client-side.
      suggestedSendAt: preflight.suggestedSendAt,
      heldByQuietHours: preflight.heldByQuietHours,
    });
  }
  return { ok: true, recipients };
}

/**
 * Commit a multi-channel pair in ONE transaction: both drafts are claimed and
 * both recipient lists written together, or neither is.
 *
 * The Blasts list shows a pair as a single row anchored on the email half and
 * hides the SMS half. Committing one half alone therefore isn't a partial
 * success — a scheduled text behind a draft email row is a send nobody can see
 * or cancel. Both halves or neither.
 */
export async function scheduleLinkedBlastDrafts(
  emailPlan: EmailSchedulePlan,
  smsPlan: SmsSchedulePlan,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await writeEmailBlastSchedule(tx, emailPlan);
    await writeSmsBlastSchedule(tx, smsPlan);
  }, LONG_TX_OPTIONS);
}
