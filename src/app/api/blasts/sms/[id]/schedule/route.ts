import { NextRequest, NextResponse } from 'next/server';
import {
  formatSmsPreflightBlockers,
  preflightSmsBlast,
} from '@/lib/sending/sms-preflight';
import { requireAllPermissions } from '@/lib/permissions/require';
import {
  getSmsBlast,
  scheduleSmsBlastDraft,
  type SmsRecipientInput,
} from '@/lib/services/sms-blasts';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function normalizeRecipients(raw: unknown): SmsRecipientInput[] {
  if (!Array.isArray(raw)) return [];
  const recipients: SmsRecipientInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const contactId = String(row.contactId || '').trim();
    const accountKey = String(row.accountKey || '').trim();
    if (!contactId || !accountKey) continue;
    recipients.push({
      contactId,
      accountKey,
      phone: String(row.phone || '').trim(),
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
 * POST /api/blasts/sms/[id]/schedule
 *
 * Transitions an SMS draft to 'scheduled' (or 'queued' if immediate) and
 * persists recipient rows. pg-boss fires it once scheduledFor passes.
 */
/**
 * Has the user opted into holding quiet-hours recipients rather than being
 * blocked? Stored on the blast by the Schedule step's "send at 8am local time
 * instead" option.
 */
function readDeferFlag(metadata: string | null | undefined): boolean {
  if (!metadata) return false;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    return Boolean(parsed.deferOutsideQuietHours);
  } catch {
    return false;
  }
}

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

  const body = await req.json().catch(() => ({}));
  const recipients = normalizeRecipients(body?.recipients);
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: 'At least one recipient is required.' },
      { status: 400 },
    );
  }
  if (recipients.length > 5000) {
    return NextResponse.json(
      { error: 'Recipient limit is 5000 per SMS campaign.' },
      { status: 400 },
    );
  }

  if (userRole === 'admin' && userAccountKeys.length > 0) {
    const allowed = new Set(userAccountKeys);
    const disallowed = recipients.find((r) => !allowed.has(r.accountKey));
    if (disallowed) {
      return NextResponse.json({ error: 'Forbidden recipient account selection' }, { status: 403 });
    }
  }

  const scheduledFor = parseDate(body?.scheduledFor);

  // Compliance + deliverability gate. Scheduling IS sending — pg-boss fires it
  // unattended — so this is the last point at which a TCPA violation can be
  // stopped, and it hard-blocks.
  //
  // Quiet hours are assessed against the RECIPIENT payload, because the check
  // needs their phone numbers (area code → local timezone) and because
  // existing.accountKeys isn't stamped onto the blast until
  // scheduleSmsBlastDraft runs below — reading it here would check an empty
  // list on a first-time send and wave everything through.
  const preflight = await preflightSmsBlast({
    message: existing.message || '',
    accountKeys: [...new Set(recipients.map((r) => r.accountKey))],
    recipients: recipients.map((r) => ({ phone: r.phone })),
    // An immediate send happens within a minute of now; a scheduled one at its
    // own time. Either way, that instant is what quiet hours applies to.
    sendAt: scheduledFor ?? new Date(),
    deferOutsideQuietHours: readDeferFlag(existing.metadata),
  });
  if (!preflight.ok) {
    return NextResponse.json(
      {
        error: formatSmsPreflightBlockers(preflight),
        issues: preflight.issues,
        // Lets the Schedule step offer "send at 8am local time instead"
        // without recomputing the window client-side.
        suggestedSendAt: preflight.suggestedSendAt,
        heldByQuietHours: preflight.heldByQuietHours,
      },
      { status: 422 },
    );
  }

  try {
    const updated = await scheduleSmsBlastDraft(id, { recipients, scheduledFor });
    return NextResponse.json({ campaign: updated }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to schedule campaign';
    const status = message.includes('required') || message.includes('valid') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
