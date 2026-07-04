import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
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
 * POST /api/campaigns/sms/[id]/schedule
 *
 * Transitions an SMS draft to 'scheduled' (or 'queued' if immediate) and
 * persists recipient rows. pg-boss fires it once scheduledFor passes.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
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

  if (!existing.message?.trim()) {
    return NextResponse.json(
      { error: 'Campaign has no message. Write one on the Message step.' },
      { status: 400 },
    );
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

  try {
    const updated = await scheduleSmsBlastDraft(id, { recipients, scheduledFor });
    return NextResponse.json({ campaign: updated }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to schedule campaign';
    const status = message.includes('required') || message.includes('valid') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
