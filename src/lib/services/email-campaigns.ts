import nodemailer from 'nodemailer';
import { prisma } from '@/lib/prisma';
import { withConcurrencyLimit } from '@/lib/esp/utils';
import {
  isLikelyDeliverableEmail,
  normalizeEmailAddress,
} from '@/lib/contact-hygiene';
import { decryptToken } from '@/lib/esp/encryption';
import { sendEmailViaSendGrid, SendGridError } from '@/lib/sending/sendgrid';
import { buildUnsubscribeFooter } from '@/lib/sending/unsubscribe-footer';

type EmailCampaignStatus =
  | 'draft'
  | 'queued'
  | 'scheduled'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'canceled';

// Drafts are NOT processable — they live until the user explicitly
// schedules them, at which point status transitions to queued/scheduled.
const PROCESSABLE_STATUSES: EmailCampaignStatus[] = ['queued', 'scheduled', 'processing'];
const TERMINAL_STATUSES: EmailCampaignStatus[] = ['completed', 'partial', 'failed', 'canceled'];
const INVALID_EMAIL_ERROR = 'Recipient email is missing or blocked by hygiene policy';

export interface EmailRecipientInput {
  contactId: string;
  accountKey: string;
  email?: string;
  fullName?: string;
}

export interface CreateEmailCampaignInput {
  name?: string;
  subject: string;
  previewText?: string;
  htmlContent: string;
  textContent?: string;
  sourceType?: string;
  recipients: EmailRecipientInput[];
  scheduledFor?: string | null;
  createdByUserId?: string;
  createdByRole?: string;
  sourceAudienceId?: string | null;
  sourceFilter?: string | null;
  metadata?: string | null;
}

export interface EmailCampaignSummary {
  id: string;
  name: string;
  subject: string;
  previewText: string;
  sourceType: string;
  status: EmailCampaignStatus;
  scheduledFor: string;
  startedAt: string;
  completedAt: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  accountKeys: string[];
  sourceAudienceId: string;
  sourceFilter: string;
  htmlContent: string;
  textContent: string;
  metadata: string;
  createdAt: string;
  updatedAt: string;
  error: string;
}

function parseAccountKeys(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((entry) => String(entry).trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeRecipient(input: EmailRecipientInput): EmailRecipientInput | null {
  const contactId = String(input.contactId || '').trim();
  const accountKey = String(input.accountKey || '').trim();
  const normalizedEmail = normalizeEmailAddress(input.email);

  if (!contactId || !accountKey) return null;
  if (!isLikelyDeliverableEmail(normalizedEmail)) {
    return {
      contactId,
      accountKey,
      email: '',
      fullName: String(input.fullName || '').trim(),
    };
  }

  return {
    contactId,
    accountKey,
    email: normalizedEmail,
    fullName: String(input.fullName || '').trim(),
  };
}

function dedupeRecipients(recipients: EmailRecipientInput[]): EmailRecipientInput[] {
  const byContactKey = new Map<string, EmailRecipientInput>();
  for (const recipient of recipients) {
    const normalized = normalizeRecipient(recipient);
    if (!normalized) continue;

    const key = `${normalized.accountKey}::${normalized.contactId}`;
    const existing = byContactKey.get(key);
    if (!existing) {
      byContactKey.set(key, normalized);
      continue;
    }

    // Prefer a contact row that carries a deliverable email if duplicates exist.
    if (!existing.email && normalized.email) {
      byContactKey.set(key, normalized);
    }
  }

  const seenEmails = new Set<string>();
  const deduped: EmailRecipientInput[] = [];
  for (const recipient of byContactKey.values()) {
    if (!recipient.email) {
      deduped.push(recipient);
      continue;
    }
    if (seenEmails.has(recipient.email)) continue;
    seenEmails.add(recipient.email);
    deduped.push(recipient);
  }

  return deduped;
}

function normalizeSourceType(value: string | null | undefined): string {
  const sourceType = String(value || '').trim().toLowerCase();
  if (sourceType === 'drag-drop' || sourceType === 'html' || sourceType === 'template-library') {
    return sourceType;
  }
  return 'template-library';
}

function sanitizeSubject(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

function sanitizeHtml(value: string): string {
  return value.trim();
}

function sanitizeText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function withPreviewText(htmlContent: string, previewText: string): string {
  const text = previewText.trim();
  if (!text) return htmlContent;

  const hiddenPreview = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${text}</div>`;
  if (/<body[^>]*>/i.test(htmlContent)) {
    return htmlContent.replace(/<body[^>]*>/i, (match) => `${match}${hiddenPreview}`);
  }
  return `${hiddenPreview}${htmlContent}`;
}

function buildCampaignMetadata(input: CreateEmailCampaignInput): string | null {
  const payload = {
    sourceType: normalizeSourceType(input.sourceType),
    sourceMetadata: input.metadata || '',
  };
  return JSON.stringify(payload);
}

function parseCampaignMetadata(raw: string | null | undefined): {
  sourceType: string;
} {
  if (!raw) {
    return { sourceType: 'template-library' };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      sourceType: normalizeSourceType(String(parsed.sourceType || '')),
    };
  } catch {
    return { sourceType: 'template-library' };
  }
}

function toSummary(row: {
  id: string;
  name: string | null;
  subject: string;
  previewText: string | null;
  sourceType: string;
  status: string;
  scheduledFor: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  accountKeys: string;
  sourceAudienceId: string | null;
  sourceFilter: string | null;
  htmlContent: string;
  textContent: string | null;
  metadata: string | null;
  createdAt: Date;
  updatedAt: Date;
  error: string | null;
}): EmailCampaignSummary {
  return {
    id: row.id,
    name: row.name || '',
    subject: row.subject,
    previewText: row.previewText || '',
    sourceType: row.sourceType || 'template-library',
    status: row.status as EmailCampaignStatus,
    scheduledFor: row.scheduledFor?.toISOString() || '',
    startedAt: row.startedAt?.toISOString() || '',
    completedAt: row.completedAt?.toISOString() || '',
    totalRecipients: row.totalRecipients,
    sentCount: row.sentCount,
    failedCount: row.failedCount,
    accountKeys: parseAccountKeys(row.accountKeys),
    sourceAudienceId: row.sourceAudienceId || '',
    sourceFilter: row.sourceFilter || '',
    htmlContent: row.htmlContent || '',
    textContent: row.textContent || '',
    metadata: row.metadata || '',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    error: row.error || '',
  };
}

const emailCampaignSummarySelect = {
  id: true,
  name: true,
  subject: true,
  previewText: true,
  sourceType: true,
  status: true,
  scheduledFor: true,
  startedAt: true,
  completedAt: true,
  totalRecipients: true,
  sentCount: true,
  failedCount: true,
  accountKeys: true,
  sourceAudienceId: true,
  sourceFilter: true,
  htmlContent: true,
  textContent: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  error: true,
} as const;

interface AccountSenderIdentity {
  from: string;
  replyTo: string | null;
  /** Raw sender email (without name wrapping) for providers that take
   *  separate name + email fields like SendGrid. */
  senderEmail: string | null;
  senderName: string | null;
  /** Decrypted SendGrid API key when this sub-account has one configured;
   *  null = fall back to nodemailer SMTP. */
  sendgridApiKey: string | null;
  /** Pre-built CAN-SPAM unsubscribe footer (HTML + text). Null when the
   *  account hasn't filled in any address/dealer info; the worker still
   *  sends in that case but skips the subscription_tracking block. */
  unsubscribeFooter: { html: string; text: string } | null;
}

/**
 * Resolve the SMTP transport when env vars are present. Returns null
 * when SMTP isn't configured so callers can route through SendGrid
 * exclusively if every sub-account has its own key. The worker only
 * errors out if BOTH SMTP and SendGrid are missing for a given
 * recipient's account.
 */
function getTransporter(): {
  defaultFrom: string;
  transporter: nodemailer.Transporter;
} | null {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || '587');
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM || smtpUser;

  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
    return null;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number.isFinite(smtpPort) ? smtpPort : 587,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  return {
    defaultFrom: smtpFrom,
    transporter,
  };
}

function formatFromHeader(email: string, name: string | null | undefined): string {
  const trimmedName = (name || '').trim();
  if (!trimmedName) return email;
  const safeName = trimmedName.replace(/["\\]/g, '');
  return `"${safeName}" <${email}>`;
}

async function buildSenderMap(
  accountKeys: string[],
  defaultFrom: string,
): Promise<Map<string, AccountSenderIdentity>> {
  const map = new Map<string, AccountSenderIdentity>();
  if (accountKeys.length === 0) return map;

  const accounts = await prisma.account.findMany({
    where: { key: { in: accountKeys } },
    select: {
      key: true,
      dealer: true,
      senderEmail: true,
      senderName: true,
      replyToEmail: true,
      sendgridApiKey: true,
      // CAN-SPAM physical-address fields. Falsy values get filtered out
      // of the footer copy in buildUnsubscribeFooter.
      address: true,
      city: true,
      state: true,
      postalCode: true,
    },
  });

  const lookup = new Map(accounts.map((a) => [a.key, a]));
  for (const key of accountKeys) {
    const account = lookup.get(key);
    let sendgridApiKey: string | null = null;
    if (account?.sendgridApiKey) {
      try {
        sendgridApiKey = decryptToken(account.sendgridApiKey);
      } catch (err) {
        // Bad ciphertext is a clear misconfiguration — log and treat
        // as "no SendGrid" so this account falls back to SMTP instead
        // of silently failing every recipient.
        console.error(
          `[email-campaigns] Failed to decrypt SendGrid key for ${key}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Build the unsubscribe footer once per account — same copy applies
    // to every recipient in this batch.
    const unsubscribeFooter = account
      ? buildUnsubscribeFooter({
          dealer: account.dealer || '',
          address: account.address,
          city: account.city,
          state: account.state,
          postalCode: account.postalCode,
        })
      : null;

    if (account?.senderEmail) {
      map.set(key, {
        from: formatFromHeader(account.senderEmail, account.senderName),
        replyTo: account.replyToEmail || null,
        senderEmail: account.senderEmail,
        senderName: account.senderName || null,
        sendgridApiKey,
        unsubscribeFooter,
      });
    } else {
      map.set(key, {
        from: defaultFrom,
        replyTo: null,
        senderEmail: null,
        senderName: null,
        sendgridApiKey,
        unsubscribeFooter,
      });
    }
  }
  return map;
}

export async function createEmailCampaign(input: CreateEmailCampaignInput): Promise<EmailCampaignSummary> {
  const subject = sanitizeSubject(input.subject || '');
  const htmlContent = sanitizeHtml(input.htmlContent || '');
  const textContent = sanitizeText(input.textContent || '');
  const previewText = String(input.previewText || '').trim();
  const sourceType = normalizeSourceType(input.sourceType);

  if (!subject) throw new Error('Email subject is required');
  if (!htmlContent) throw new Error('Email HTML content is required');

  const recipients = dedupeRecipients(input.recipients || []);
  if (recipients.length === 0) throw new Error('At least one recipient is required');

  const sendableRecipients = recipients.filter((recipient) => Boolean(recipient.email));
  if (sendableRecipients.length === 0) throw new Error('No recipients with valid email addresses were provided');

  const scheduledDate = parseDate(input.scheduledFor || undefined);
  const now = Date.now();
  const status: EmailCampaignStatus =
    scheduledDate && scheduledDate.getTime() > now
      ? 'scheduled'
      : 'queued';
  const accountKeys = [...new Set(recipients.map((recipient) => recipient.accountKey))];

  const created = await prisma.$transaction(async (tx) => {
    const campaign = await tx.emailCampaign.create({
      data: {
        name: input.name?.trim() || null,
        subject,
        previewText: previewText || null,
        htmlContent,
        textContent: textContent || null,
        sourceType,
        status,
        scheduledFor: scheduledDate,
        createdByUserId: input.createdByUserId || null,
        createdByRole: input.createdByRole || null,
        sourceAudienceId: input.sourceAudienceId || null,
        sourceFilter: input.sourceFilter || null,
        accountKeys: JSON.stringify(accountKeys),
        totalRecipients: recipients.length,
        metadata: buildCampaignMetadata(input),
      },
    });

    await tx.emailCampaignRecipient.createMany({
      data: recipients.map((recipient) => ({
        campaignId: campaign.id,
        contactId: recipient.contactId,
        accountKey: recipient.accountKey,
        email: recipient.email || null,
        fullName: recipient.fullName || null,
        status: recipient.email ? 'pending' : 'failed',
        error: recipient.email ? null : INVALID_EMAIL_ERROR,
      })),
    });

    return campaign;
  });

  return toSummary(created);
}

function defaultDraftName(now: Date): string {
  return `Campaign ${now.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

/**
 * Creates an empty EmailCampaign row in 'draft' status. The campaign-builder
 * flow walks the user through the remaining steps (recipients, template,
 * schedule) and PATCHes the same row at each step. The pg-boss worker
 * ignores drafts — they only fire once status transitions to 'scheduled'.
 */
export async function createDraftEmailCampaign(input: {
  name?: string;
  accountKeys?: string[];
  createdByUserId?: string;
  createdByRole?: string;
}): Promise<EmailCampaignSummary> {
  const name = (input.name || '').trim() || defaultDraftName(new Date());
  const created = await prisma.emailCampaign.create({
    data: {
      name,
      subject: '',
      htmlContent: '',
      sourceType: 'drag-drop',
      status: 'draft',
      accountKeys: JSON.stringify(input.accountKeys || []),
      createdByUserId: input.createdByUserId || null,
      createdByRole: input.createdByRole || null,
    },
    select: emailCampaignSummarySelect,
  });
  return toSummary(created);
}

/**
 * PATCH-style update for in-flight campaign drafts. Only the fields passed
 * in `patch` are touched; unspecified fields keep their current values.
 * Pass `null` to clear a column.
 */
export async function updateEmailCampaignDraft(
  campaignId: string,
  patch: {
    name?: string;
    subject?: string;
    previewText?: string | null;
    htmlContent?: string;
    textContent?: string | null;
    accountKeys?: string[];
    sourceAudienceId?: string | null;
    sourceFilter?: string | null;
    sourceType?: string;
    scheduledFor?: Date | null;
    status?: EmailCampaignStatus;
    metadata?: string | null;
  },
): Promise<EmailCampaignSummary> {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.subject !== undefined) data.subject = patch.subject;
  if (patch.previewText !== undefined) data.previewText = patch.previewText;
  if (patch.htmlContent !== undefined) data.htmlContent = patch.htmlContent;
  if (patch.textContent !== undefined) data.textContent = patch.textContent;
  if (patch.accountKeys !== undefined) data.accountKeys = JSON.stringify(patch.accountKeys);
  if (patch.sourceAudienceId !== undefined) data.sourceAudienceId = patch.sourceAudienceId;
  if (patch.sourceFilter !== undefined) data.sourceFilter = patch.sourceFilter;
  if (patch.sourceType !== undefined) data.sourceType = patch.sourceType;
  if (patch.scheduledFor !== undefined) data.scheduledFor = patch.scheduledFor;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.metadata !== undefined) data.metadata = patch.metadata;

  const updated = await prisma.emailCampaign.update({
    where: { id: campaignId },
    data,
    select: emailCampaignSummarySelect,
  });
  return toSummary(updated);
}

/**
 * Transitions a draft EmailCampaign into 'scheduled' (future send time) or
 * 'queued' (send immediately). Creates EmailCampaignRecipient rows in the
 * same transaction so the pg-boss worker has everything it needs once
 * scheduledFor passes.
 *
 * Suppression filtering happens here too: recipients whose (accountKey,
 * email) tuple is on EmailSuppression land in the recipient table with
 * status='skipped' rather than 'pending'. They're preserved for audit
 * but the worker won't try to send to them. Hard bounces and spam
 * reports from the SendGrid Event webhook are the main producers of
 * suppression rows.
 */
export async function scheduleEmailCampaignDraft(
  campaignId: string,
  input: {
    recipients: EmailRecipientInput[];
    scheduledFor: Date | null; // null = send immediately
  },
): Promise<EmailCampaignSummary> {
  const recipients = dedupeRecipients(input.recipients);
  if (recipients.length === 0) {
    throw new Error('At least one recipient is required');
  }
  const sendableRecipients = recipients.filter((r) => Boolean(r.email));
  if (sendableRecipients.length === 0) {
    throw new Error('No recipients with valid email addresses were provided');
  }

  // Pull the suppression list for every (account, email) tuple that
  // could appear in this batch in one query. Email comparisons are
  // case-insensitive — we lower-case in the lookup map.
  const accountKeysInBatch = [
    ...new Set(sendableRecipients.map((r) => r.accountKey).filter(Boolean)),
  ];
  const emailsInBatch = [
    ...new Set(
      sendableRecipients
        .map((r) => (r.email || '').toLowerCase().trim())
        .filter(Boolean),
    ),
  ];
  const suppressed = accountKeysInBatch.length > 0 && emailsInBatch.length > 0
    ? await prisma.emailSuppression.findMany({
        where: {
          accountKey: { in: accountKeysInBatch },
          email: { in: emailsInBatch },
        },
        select: { accountKey: true, email: true, reason: true },
      })
    : [];
  const suppressionKey = (accountKey: string, email: string) =>
    `${accountKey}|${email.toLowerCase().trim()}`;
  const suppressedByKey = new Map(
    suppressed.map((s) => [suppressionKey(s.accountKey, s.email), s.reason]),
  );

  const now = Date.now();
  const isImmediate = !input.scheduledFor || input.scheduledFor.getTime() <= now;
  const status: EmailCampaignStatus = isImmediate ? 'queued' : 'scheduled';

  const updated = await prisma.$transaction(async (tx) => {
    // Clear any pre-existing recipient rows so re-scheduling a draft
    // starts from a clean slate.
    await tx.emailCampaignRecipient.deleteMany({ where: { campaignId } });

    await tx.emailCampaignRecipient.createMany({
      data: recipients.map((recipient) => {
        if (!recipient.email) {
          return {
            campaignId,
            contactId: recipient.contactId,
            accountKey: recipient.accountKey,
            email: null,
            fullName: recipient.fullName || null,
            status: 'failed',
            error: INVALID_EMAIL_ERROR,
          };
        }
        const suppressionReason = suppressedByKey.get(
          suppressionKey(recipient.accountKey, recipient.email),
        );
        if (suppressionReason) {
          return {
            campaignId,
            contactId: recipient.contactId,
            accountKey: recipient.accountKey,
            email: recipient.email,
            fullName: recipient.fullName || null,
            status: 'skipped',
            error: `Suppressed (${suppressionReason})`,
          };
        }
        return {
          campaignId,
          contactId: recipient.contactId,
          accountKey: recipient.accountKey,
          email: recipient.email,
          fullName: recipient.fullName || null,
          status: 'pending',
          error: null,
        };
      }),
    });

    const accountKeys = [...new Set(recipients.map((r) => r.accountKey).filter(Boolean))];

    return tx.emailCampaign.update({
      where: { id: campaignId },
      data: {
        status,
        scheduledFor: isImmediate ? null : input.scheduledFor,
        totalRecipients: recipients.length,
        accountKeys: JSON.stringify(accountKeys),
        startedAt: null,
        completedAt: null,
        error: null,
      },
      select: emailCampaignSummarySelect,
    });
  });

  return toSummary(updated);
}

export async function getEmailCampaign(campaignId: string): Promise<EmailCampaignSummary | null> {
  const row = await prisma.emailCampaign.findUnique({
    where: { id: campaignId },
    select: emailCampaignSummarySelect,
  });
  return row ? toSummary(row) : null;
}

/**
 * Delete a campaign + its recipient rows. We block deletion of in-flight
 * campaigns (queued/processing) so the worker never finds itself running
 * a job whose campaign row has vanished mid-loop.
 */
export async function deleteEmailCampaign(campaignId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.emailCampaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    if (!row) return;
    if (row.status === 'queued' || row.status === 'processing') {
      throw new Error('Cannot delete a campaign that is currently sending.');
    }
    await tx.emailCampaignRecipient.deleteMany({ where: { campaignId } });
    await tx.emailCampaign.delete({ where: { id: campaignId } });
  });
}

/**
 * Toggle the archive flag on a campaign. Archive is stored as
 * `metadata.archived = true` so we can ship it without a Prisma
 * migration. The list endpoint filters archived rows out by default.
 * In-flight campaigns (queued/processing) can't be archived to keep the
 * worker's state machine simple.
 */
export async function setEmailCampaignArchived(
  campaignId: string,
  archived: boolean,
): Promise<EmailCampaignSummary> {
  const existing = await prisma.emailCampaign.findUnique({
    where: { id: campaignId },
    select: { status: true, metadata: true },
  });
  if (!existing) throw new Error('Campaign not found');
  if (existing.status === 'queued' || existing.status === 'processing') {
    throw new Error('Cannot archive a campaign that is currently sending.');
  }
  let meta: Record<string, unknown> = {};
  try {
    meta = existing.metadata ? (JSON.parse(existing.metadata) as Record<string, unknown>) : {};
    if (typeof meta !== 'object' || meta === null) meta = {};
  } catch {
    meta = {};
  }
  if (archived) meta.archived = true;
  else delete meta.archived;
  const updated = await prisma.emailCampaign.update({
    where: { id: campaignId },
    data: { metadata: JSON.stringify(meta) },
    select: emailCampaignSummarySelect,
  });
  return toSummary(updated);
}

/**
 * Create a new draft email campaign by cloning an existing one. Status
 * resets to 'draft', schedule + timestamps clear, name gets a "(Copy)"
 * suffix, and recipient rows are NOT copied — the user will reselect the
 * audience in the Recipients step.
 */
export async function duplicateEmailCampaign(
  campaignId: string,
  options?: { createdByUserId?: string; createdByRole?: string },
): Promise<EmailCampaignSummary> {
  const source = await prisma.emailCampaign.findUnique({
    where: { id: campaignId },
    select: emailCampaignSummarySelect,
  });
  if (!source) {
    throw new Error('Source campaign not found');
  }

  const created = await prisma.emailCampaign.create({
    data: {
      name: source.name ? `${source.name} (Copy)` : defaultDraftName(new Date()),
      subject: source.subject || '',
      previewText: source.previewText || null,
      htmlContent: source.htmlContent || '',
      textContent: source.textContent || null,
      sourceType: source.sourceType || 'drag-drop',
      status: 'draft',
      accountKeys: source.accountKeys || JSON.stringify([]),
      sourceAudienceId: source.sourceAudienceId || null,
      sourceFilter: source.sourceFilter || null,
      metadata: source.metadata || null,
      createdByUserId: options?.createdByUserId || null,
      createdByRole: options?.createdByRole || null,
    },
    select: emailCampaignSummarySelect,
  });
  return toSummary(created);
}

export async function listEmailCampaigns(options?: {
  limit?: number;
  accountKeys?: string[];
}): Promise<EmailCampaignSummary[]> {
  const limit = Math.max(1, Math.min(100, options?.limit ?? 25));
  const rows = await prisma.emailCampaign.findMany({
    select: emailCampaignSummarySelect,
    orderBy: { createdAt: 'desc' },
    take: limit * 4,
  });

  const allowedAccountKeys = options?.accountKeys && options.accountKeys.length > 0
    ? new Set(options.accountKeys)
    : null;

  return rows
    .filter((row) => {
      if (!allowedAccountKeys) return true;
      const keys = parseAccountKeys(row.accountKeys);
      return keys.some((key) => allowedAccountKeys.has(key));
    })
    .slice(0, limit)
    .map(toSummary);
}

async function summarizeCampaign(campaignId: string) {
  const recipients = await prisma.emailCampaignRecipient.findMany({
    where: { campaignId },
    select: { status: true, error: true },
  });

  let pending = 0;
  let sent = 0;
  let failed = 0;
  let firstError = '';

  for (const row of recipients) {
    if (row.status === 'sent') sent += 1;
    else if (row.status === 'failed') {
      failed += 1;
      if (!firstError && row.error) firstError = row.error;
    } else pending += 1;
  }

  return {
    total: recipients.length,
    pending,
    sent,
    failed,
    firstError,
  };
}

export async function processEmailCampaign(
  campaignId: string,
  options?: { concurrency?: number },
): Promise<EmailCampaignSummary> {
  const concurrency = Math.max(1, Math.min(8, options?.concurrency ?? 3));
  const campaign = await prisma.emailCampaign.findUnique({
    where: { id: campaignId },
    include: {
      recipients: {
        where: { status: 'pending' },
        select: { id: true, email: true, fullName: true, accountKey: true },
      },
    },
  });

  if (!campaign) throw new Error('Email campaign not found');
  if (TERMINAL_STATUSES.includes(campaign.status as EmailCampaignStatus)) {
    return toSummary(campaign);
  }

  if (campaign.recipients.length === 0) {
    const counts = await summarizeCampaign(campaign.id);
    const status: EmailCampaignStatus =
      counts.sent > 0 && counts.failed > 0
        ? 'partial'
        : counts.sent > 0
          ? 'completed'
          : counts.failed > 0
            ? 'failed'
            : 'queued';
    const updated = await prisma.emailCampaign.update({
      where: { id: campaign.id },
      data: {
        status,
        totalRecipients: counts.total,
        sentCount: counts.sent,
        failedCount: counts.failed,
        completedAt: status === 'queued' ? null : new Date(),
        error: counts.firstError || null,
      },
    });
    return toSummary(updated);
  }

  await prisma.emailCampaign.update({
    where: { id: campaign.id },
    data: {
      status: 'processing',
      startedAt: campaign.startedAt || new Date(),
      completedAt: null,
      error: null,
    },
  });

  const smtp = getTransporter();
  const defaultFrom = smtp?.defaultFrom || '';
  const uniqueAccountKeys = [...new Set(campaign.recipients.map((r) => r.accountKey))];
  const senderByAccount = await buildSenderMap(uniqueAccountKeys, defaultFrom);
  const metadata = parseCampaignMetadata(campaign.metadata);
  const html = withPreviewText(campaign.htmlContent, campaign.previewText || '');
  const text = campaign.textContent?.trim() || stripHtml(campaign.htmlContent);

  const tasks = campaign.recipients.map((recipient) => async () => {
    const recipientEmail = normalizeEmailAddress(recipient.email || '');
    if (!isLikelyDeliverableEmail(recipientEmail)) {
      await prisma.emailCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'failed',
          error: INVALID_EMAIL_ERROR,
        },
      });
      return;
    }

    const sender = senderByAccount.get(recipient.accountKey) || {
      from: defaultFrom,
      replyTo: null,
      senderEmail: null,
      senderName: null,
      sendgridApiKey: null,
      unsubscribeFooter: null,
    };

    // Dispatch: SendGrid first (per-sub-account API key), then SMTP fallback.
    // If neither is configured for this account, fail the recipient with
    // a clear message rather than throwing — keeps the rest of the batch
    // alive and the user sees what went wrong on the failed row.
    const useSendGrid = Boolean(sender.sendgridApiKey && sender.senderEmail);

    if (!useSendGrid && !smtp) {
      await prisma.emailCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'failed',
          error:
            'No sending transport configured for this sub-account. Add a SendGrid API key in Sending settings, or set SMTP_* env vars for a fallback.',
        },
      });
      return;
    }

    try {
      let messageId: string | null = null;

      if (useSendGrid) {
        const result = await sendEmailViaSendGrid({
          apiKey: sender.sendgridApiKey!,
          from: { email: sender.senderEmail!, name: sender.senderName || undefined },
          replyTo: sender.replyTo ? { email: sender.replyTo } : undefined,
          to: { email: recipientEmail, name: recipient.fullName || undefined },
          subject: campaign.subject,
          html,
          text,
          categories: ['loomi', `campaign:${campaign.id}`],
          // Carry these through to the Event webhook so we can correlate
          // opens/clicks/bounces back to the originating row.
          customArgs: {
            campaignId: campaign.id,
            recipientId: recipient.id,
            accountKey: recipient.accountKey,
          },
          // CAN-SPAM: SendGrid appends an unsubscribe link + sets the
          // List-Unsubscribe header. Footer copy is built per-account in
          // buildSenderMap. Skipped when the account has no dealer name
          // configured (extremely rare) — the worker still sends but the
          // recipient won't see a Loomi-rendered footer (their template
          // might already include one).
          ...(sender.unsubscribeFooter
            ? { unsubscribe: sender.unsubscribeFooter }
            : {}),
        });
        messageId = result.messageId || null;
      } else {
        const info = await smtp!.transporter.sendMail({
          from: sender.from,
          ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
          to: recipientEmail,
          subject: campaign.subject,
          html,
          text,
        });
        messageId = info.messageId || null;
      }

      await prisma.emailCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'sent',
          messageId,
          sentAt: new Date(),
          error: null,
        },
      });
    } catch (err) {
      const errorMessage =
        err instanceof SendGridError
          ? `SendGrid: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Failed to send email';
      await prisma.emailCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'failed',
          error: errorMessage,
        },
      });
    }
  });

  await withConcurrencyLimit(tasks, concurrency);

  const counts = await summarizeCampaign(campaign.id);
  const nextStatus: EmailCampaignStatus =
    counts.pending > 0
      ? 'processing'
      : counts.sent > 0 && counts.failed > 0
        ? 'partial'
        : counts.sent > 0
          ? 'completed'
          : counts.failed > 0
            ? 'failed'
            : 'queued';

  const updated = await prisma.emailCampaign.update({
    where: { id: campaign.id },
    data: {
      sourceType: metadata.sourceType,
      status: nextStatus,
      totalRecipients: counts.total,
      sentCount: counts.sent,
      failedCount: counts.failed,
      completedAt: nextStatus === 'processing' || nextStatus === 'queued' ? null : new Date(),
      error: counts.firstError || null,
    },
  });

  return toSummary(updated);
}

export async function processDueEmailCampaigns(options?: {
  limit?: number;
  accountKeys?: string[];
  concurrency?: number;
}): Promise<EmailCampaignSummary[]> {
  const limit = Math.max(1, Math.min(20, options?.limit ?? 5));
  const now = new Date();

  const rows = await prisma.emailCampaign.findMany({
    where: {
      status: { in: PROCESSABLE_STATUSES },
      OR: [
        { scheduledFor: null },
        { scheduledFor: { lte: now } },
      ],
    },
    orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }],
    take: limit * 4,
  });

  const allowedAccountKeys = options?.accountKeys && options.accountKeys.length > 0
    ? new Set(options.accountKeys)
    : null;

  const queue = rows
    .filter((row) => {
      if (!allowedAccountKeys) return true;
      const keys = parseAccountKeys(row.accountKeys);
      return keys.some((key) => allowedAccountKeys.has(key));
    })
    .slice(0, limit);

  const summaries: EmailCampaignSummary[] = [];
  for (const row of queue) {
    const summary = await processEmailCampaign(row.id, { concurrency: options?.concurrency });
    summaries.push(summary);
  }

  return summaries;
}
