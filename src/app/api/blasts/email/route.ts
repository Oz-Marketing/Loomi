import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import {
  createEmailBlast,
  listEmailBlasts,
  processEmailBlast,
  type BlastStatusFilter,
  type EmailRecipientInput,
} from '@/lib/services/email-blasts';

function parseCampaignStatusFilter(
  value: string | null,
): BlastStatusFilter | undefined {
  if (value === 'all' || value === 'archived') return value;
  return undefined;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
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

/**
 * GET /api/blasts/email
 *
 * Lists recent email campaigns created in Loomi.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin', 'client');
  if (error) return error;

  const limitRaw = Number(req.nextUrl.searchParams.get('limit') || '20');
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : 20;
  const statusFilter = parseCampaignStatusFilter(
    req.nextUrl.searchParams.get('status'),
  );
  const accountKeys = session!.user.role === 'client'
    ? (session!.user.accountKeys ?? [])
    : undefined;

  const campaigns = await listEmailBlasts({ limit, accountKeys, statusFilter });
  return NextResponse.json({ campaigns });
}

/**
 * POST /api/blasts/email
 *
 * Creates a bulk email campaign and optionally processes it immediately.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin', 'client');
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const subject = typeof body?.subject === 'string' ? body.subject : '';
  const previewText = typeof body?.previewText === 'string' ? body.previewText : '';
  const htmlContent = typeof body?.htmlContent === 'string' ? body.htmlContent : '';
  const textContent = typeof body?.textContent === 'string' ? body.textContent : '';
  const sourceType = typeof body?.sourceType === 'string' ? body.sourceType : '';
  const scheduledForRaw = body?.scheduledFor;
  const scheduledFor = parseDate(scheduledForRaw);
  const recipients = normalizeRecipients(body?.recipients);
  const processNow = typeof body?.processNow === 'boolean'
    ? body.processNow
    : !(scheduledFor && scheduledFor.getTime() > Date.now());

  if (!subject.trim()) {
    return NextResponse.json({ error: 'subject is required' }, { status: 400 });
  }
  if (!htmlContent.trim()) {
    return NextResponse.json({ error: 'htmlContent is required' }, { status: 400 });
  }
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'At least one recipient is required' }, { status: 400 });
  }
  if (recipients.length > 1000) {
    return NextResponse.json({ error: 'Recipient limit is 1000 per email send' }, { status: 400 });
  }

  if (session!.user.role === 'client') {
    const allowed = new Set(session!.user.accountKeys ?? []);
    const forbiddenRecipient = recipients.find((recipient) => !allowed.has(recipient.accountKey));
    if (forbiddenRecipient) {
      return NextResponse.json({ error: 'Forbidden recipient account selection' }, { status: 403 });
    }
  }

  try {
    const created = await createEmailBlast({
      name: typeof body?.name === 'string' ? body.name : '',
      subject,
      previewText,
      htmlContent,
      textContent,
      sourceType,
      recipients,
      scheduledFor: scheduledFor?.toISOString() || null,
      createdByUserId: session!.user.id,
      createdByRole: session!.user.role,
      sourceAudienceId: typeof body?.audienceId === 'string' ? body.audienceId : null,
      sourceFilter: typeof body?.sourceFilter === 'string' ? body.sourceFilter : null,
      metadata: typeof body?.metadata === 'string' ? body.metadata : null,
    });

    if (!processNow) {
      return NextResponse.json({ campaign: created, processed: false }, { status: 201 });
    }

    const processed = await processEmailBlast(created.id, { concurrency: 3 });
    return NextResponse.json({ campaign: processed, processed: true }, { status: 201 });
  } catch (err) {
    const messageText = err instanceof Error ? err.message : 'Failed to create email campaign';
    const normalized = messageText.toLowerCase();
    const status = normalized.includes('required') || normalized.includes('invalid')
      ? 400
      : normalized.includes('configured')
        ? 500
        : 500;
    return NextResponse.json({ error: messageText }, { status });
  }
}
