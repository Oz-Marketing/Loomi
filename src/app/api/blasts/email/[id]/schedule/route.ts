import { NextRequest, NextResponse } from 'next/server';
import { requireAllPermissions } from '@/lib/permissions/require';
import {
  formatPreflightBlockers,
  preflightEmailBlast,
} from '@/lib/sending/blast-preflight';
import {
  getEmailBlast,
  scheduleEmailBlastDraft,
  type EmailRecipientInput,
} from '@/lib/services/email-blasts';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function normalizeRecipients(raw: unknown): EmailRecipientInput[] {
  if (!Array.isArray(raw)) return [];
  const recipients: EmailRecipientInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const contactId = String(row.contactId || '').trim();
    const accountKey = String(row.accountKey || '').trim();
    if (!contactId || !accountKey) continue;
    recipients.push({
      contactId,
      accountKey,
      email: String(row.email || '').trim(),
      fullName: String(row.fullName || '').trim(),
    });
  }
  return recipients;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/**
 * POST /api/blasts/email/[id]/schedule
 *
 * Final step of the campaign builder: transitions the draft to
 * 'scheduled' (or 'queued' if send time is now/past) and persists
 * recipient rows. pg-boss fires it once scheduledFor passes.
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

  const body = await req.json().catch(() => ({}));
  const recipients = normalizeRecipients(body?.recipients);
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: 'At least one recipient is required to schedule the campaign.' },
      { status: 400 },
    );
  }
  if (recipients.length > 5000) {
    return NextResponse.json(
      { error: 'Recipient limit is 5000 per email campaign.' },
      { status: 400 },
    );
  }

  // Admins scoped to specific accounts can only schedule for their accounts.
  if (userRole === 'admin' && userAccountKeys.length > 0) {
    const allowed = new Set(userAccountKeys);
    const disallowed = recipients.find((r) => !allowed.has(r.accountKey));
    if (disallowed) {
      return NextResponse.json({ error: 'Forbidden recipient account selection' }, { status: 403 });
    }
  }

  const scheduledFor = parseDate(body?.scheduledFor);

  // Deliverability + compliance gate. This is the last point at which we can
  // stop a blast that would land in spam or breach CAN-SPAM, and it is a hard
  // block: scheduling is sending, and once pg-boss fires there is no undo.
  //
  // Preflight is run against the accounts in the RECIPIENT payload rather
  // than existing.accountKeys, because accountKeys isn't stamped onto the
  // blast until scheduleEmailBlastDraft runs a few lines below — reading it
  // here would check an empty list on a first-time send and wave everything
  // through.
  const preflight = await preflightEmailBlast({
    subject: existing.subject || '',
    htmlContent: existing.htmlContent || '',
    textContent: existing.textContent,
    accountKeys: [...new Set(recipients.map((r) => r.accountKey))],
  });
  if (!preflight.ok) {
    return NextResponse.json(
      {
        error: formatPreflightBlockers(preflight),
        // The Schedule step renders these individually with a settings link.
        issues: preflight.issues,
      },
      { status: 422 },
    );
  }

  try {
    const updated = await scheduleEmailBlastDraft(id, {
      recipients,
      scheduledFor,
    });
    return NextResponse.json({ campaign: updated }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to schedule campaign';
    const status = message.includes('required') || message.includes('valid') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
