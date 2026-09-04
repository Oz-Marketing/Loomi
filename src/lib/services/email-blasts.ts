import { prisma } from '@/lib/prisma';
import {
  isLikelyDeliverableEmail,
  normalizeEmailAddress,
} from '@/lib/contact-hygiene';
import { decryptToken } from '@/lib/crypto/encryption';
import { sendEmailViaSendGrid, SendGridError } from '@/lib/sending/sendgrid';
import {
  getCombinedRemaining,
  recordWarmupSends,
  releaseWarmupSends,
  sendingDomain,
} from '@/lib/sending/warmup';
import { orderByEngagement } from '@/lib/sending/warmup-ordering';
import {
  injectUnsubscribeFooter,
  UNSUBSCRIBE_TOKEN,
  type UnsubscribeFooterConfig,
  type UnsubscribeFooterInput,
} from '@/lib/sending/unsubscribe-footer';
import { resolveAccountFooters } from '@/lib/sending/account-footer';
import { applyUtmTags, type BlastUtmSettings } from '@/lib/sending/blast-utm';
import {
  applyBlastMergetags,
  buildBlastMergetagContext,
  type BlastAccountData,
  type BlastContactData,
} from '@/lib/sending/blast-mergetags';

/**
 * Run async tasks with a concurrency limit. Inlined here (was previously
 * in a shared utils module) so the email worker has no cross-module deps.
 */
async function withConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      try {
        const value = await tasks[index]();
        results[index] = { status: 'fulfilled', value };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => runNext(),
  );
  await Promise.all(workers);

  return results;
}

type EmailBlastStatus =
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
const PROCESSABLE_STATUSES: EmailBlastStatus[] = ['queued', 'scheduled', 'processing'];
const TERMINAL_STATUSES: EmailBlastStatus[] = ['completed', 'partial', 'failed', 'canceled'];
const INVALID_EMAIL_ERROR = 'Recipient email is missing or blocked by hygiene policy';

export interface EmailRecipientInput {
  contactId: string;
  accountKey: string;
  email?: string;
  fullName?: string;
}

export interface CreateEmailBlastInput {
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

export interface EmailBlastSummary {
  id: string;
  name: string;
  /** Non-empty only on the per-(flow, node) wrapper shells the flow
   *  engine creates. Callers use it to badge or hide those rows — see
   *  BlastSourceFilter. */
  flowNodeKey: string;
  subject: string;
  previewText: string;
  sourceType: string;
  status: EmailBlastStatus;
  scheduledFor: string;
  startedAt: string;
  completedAt: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  accountKeys: string[];
  sourceAudienceId: string;
  sourceFilter: string;
  sourceListId: string;
  /** JSON-stringified array of Contact IDs for manual ad-hoc selections.
   *  Mutually exclusive with sourceListId and sourceAudienceId+sourceFilter. */
  sourceContactIds: string;
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

function buildCampaignMetadata(input: CreateEmailBlastInput): string | null {
  const payload = {
    sourceType: normalizeSourceType(input.sourceType),
    sourceMetadata: input.metadata || '',
  };
  return JSON.stringify(payload);
}

export interface BlastResendSettings {
  enabled: boolean;
  delayHours: number;
  subject: string;
}

interface ParsedCampaignMetadata {
  sourceType: string;
  utm: BlastUtmSettings | null;
  resend: BlastResendSettings | null;
  /** Set on a follow-up blast; points at the blast it follows up on. */
  resendOf: string;
}

/**
 * Read the campaign metadata blob.
 *
 * This used to return ONLY sourceType and silently discard the rest, which
 * meant the UTM settings and the "Resend to non-engaged" toggle — both
 * faithfully saved by the Schedule step — had no effect whatsoever. The
 * fields are parsed defensively because the blob is also written by the flow
 * engine and the ad-generator automation.
 */
function parseCampaignMetadata(
  raw: string | null | undefined,
): ParsedCampaignMetadata {
  const empty: ParsedCampaignMetadata = {
    sourceType: 'template-library',
    utm: null,
    resend: null,
    resendOf: '',
  };
  if (!raw) return empty;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const utmRaw = parsed.utm as Record<string, unknown> | undefined;
    const resendRaw = parsed.resend as Record<string, unknown> | undefined;

    return {
      sourceType: normalizeSourceType(String(parsed.sourceType || '')),
      utm: utmRaw && typeof utmRaw === 'object'
        ? {
            enabled: Boolean(utmRaw.enabled),
            source: String(utmRaw.source || ''),
            medium: String(utmRaw.medium || ''),
            campaign: String(utmRaw.campaign || ''),
            term: String(utmRaw.term || ''),
            content: String(utmRaw.content || ''),
          }
        : null,
      resend: resendRaw && typeof resendRaw === 'object'
        ? {
            enabled: Boolean(resendRaw.enabled),
            // Clamp to a sane window: under an hour isn't a follow-up, and
            // past 30 days the offer is stale anyway.
            delayHours: Math.max(
              1,
              Math.min(720, Number(resendRaw.delayHours) || 72),
            ),
            subject: String(resendRaw.subject || ''),
          }
        : null,
      resendOf: String(parsed.resendOf || ''),
    };
  } catch {
    return empty;
  }
}

function toSummary(row: {
  id: string;
  name: string | null;
  // Optional: some call sites hand toSummary a row selected without it.
  flowNodeKey?: string | null;
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
  sourceListId: string | null;
  sourceContactIds: string | null;
  htmlContent: string;
  textContent: string | null;
  metadata: string | null;
  createdAt: Date;
  updatedAt: Date;
  error: string | null;
}): EmailBlastSummary {
  return {
    id: row.id,
    name: row.name || '',
    flowNodeKey: row.flowNodeKey || '',
    subject: row.subject,
    previewText: row.previewText || '',
    sourceType: row.sourceType || 'template-library',
    status: row.status as EmailBlastStatus,
    scheduledFor: row.scheduledFor?.toISOString() || '',
    startedAt: row.startedAt?.toISOString() || '',
    completedAt: row.completedAt?.toISOString() || '',
    totalRecipients: row.totalRecipients,
    sentCount: row.sentCount,
    failedCount: row.failedCount,
    accountKeys: parseAccountKeys(row.accountKeys),
    sourceAudienceId: row.sourceAudienceId || '',
    sourceFilter: row.sourceFilter || '',
    sourceListId: row.sourceListId || '',
    sourceContactIds: row.sourceContactIds || '',
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
  flowNodeKey: true,
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
  sourceListId: true,
  sourceContactIds: true,
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
   *  null = account can't send bulk email (preflight blocks this). */
  sendgridApiKey: string | null;
  /** Pre-built CAN-SPAM unsubscribe footer (HTML + text). Null when the
   *  account hasn't filled in any address/dealer info; the worker still
   *  sends in that case but skips the subscription_tracking block. */
  /** Account data the compliance footer is built from, per send. */
  unsubscribeFooter: UnsubscribeFooterInput | null;
  /** Resolved footer styling — this account's, or an ancestor's. */
  footerConfig: UnsubscribeFooterConfig | null;
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
  // One batched resolution for the whole blast — inheritance walks the
  // parent chain, which must not happen inside the per-recipient loop.
  const footers = await resolveAccountFooters(accountKeys);
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

    // Carry the raw address fields, not a prebuilt footer: whether the
    // footer repeats the unsubscribe link depends on the rendered body,
    // which we only have inside the per-recipient loop.
    const unsubscribeFooter: UnsubscribeFooterInput | null = account
      ? {
          dealer: account.dealer || '',
          address: account.address,
          city: account.city,
          state: account.state,
          postalCode: account.postalCode,
        }
      : null;

    const footerConfig = footers.get(key)?.config ?? null;

    if (account?.senderEmail) {
      map.set(key, {
        from: formatFromHeader(account.senderEmail, account.senderName),
        replyTo: account.replyToEmail || null,
        senderEmail: account.senderEmail,
        senderName: account.senderName || null,
        sendgridApiKey,
        unsubscribeFooter,
        footerConfig,
      });
    } else {
      map.set(key, {
        from: defaultFrom,
        replyTo: null,
        senderEmail: null,
        senderName: null,
        sendgridApiKey,
        unsubscribeFooter,
        footerConfig,
      });
    }
  }
  return map;
}

export async function createEmailBlast(input: CreateEmailBlastInput): Promise<EmailBlastSummary> {
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
  const status: EmailBlastStatus =
    scheduledDate && scheduledDate.getTime() > now
      ? 'scheduled'
      : 'queued';
  const accountKeys = [...new Set(recipients.map((recipient) => recipient.accountKey))];

  const created = await prisma.$transaction(async (tx) => {
    const campaign = await tx.emailBlast.create({
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

    await tx.emailBlastRecipient.createMany({
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
 * Creates an empty EmailBlast row in 'draft' status. The campaign-builder
 * flow walks the user through the remaining steps (recipients, template,
 * schedule) and PATCHes the same row at each step. The pg-boss worker
 * ignores drafts — they only fire once status transitions to 'scheduled'.
 */
export async function createDraftEmailBlast(input: {
  name?: string;
  accountKeys?: string[];
  createdByUserId?: string;
  createdByRole?: string;
}): Promise<EmailBlastSummary> {
  const name = (input.name || '').trim() || defaultDraftName(new Date());
  const created = await prisma.emailBlast.create({
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
export async function updateEmailBlastDraft(
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
    sourceListId?: string | null;
    sourceContactIds?: string | null;
    sourceType?: string;
    scheduledFor?: Date | null;
    status?: EmailBlastStatus;
    metadata?: string | null;
  },
): Promise<EmailBlastSummary> {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.subject !== undefined) data.subject = patch.subject;
  if (patch.previewText !== undefined) data.previewText = patch.previewText;
  if (patch.htmlContent !== undefined) data.htmlContent = patch.htmlContent;
  if (patch.textContent !== undefined) data.textContent = patch.textContent;
  if (patch.accountKeys !== undefined) data.accountKeys = JSON.stringify(patch.accountKeys);
  if (patch.sourceAudienceId !== undefined) data.sourceAudienceId = patch.sourceAudienceId;
  if (patch.sourceFilter !== undefined) data.sourceFilter = patch.sourceFilter;
  if (patch.sourceListId !== undefined) data.sourceListId = patch.sourceListId;
  if (patch.sourceContactIds !== undefined) data.sourceContactIds = patch.sourceContactIds;
  if (patch.sourceType !== undefined) data.sourceType = patch.sourceType;
  if (patch.scheduledFor !== undefined) data.scheduledFor = patch.scheduledFor;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.metadata !== undefined) data.metadata = patch.metadata;

  const updated = await prisma.emailBlast.update({
    where: { id: campaignId },
    data,
    select: emailCampaignSummarySelect,
  });
  return toSummary(updated);
}

/**
 * Transitions a draft EmailBlast into 'scheduled' (future send time) or
 * 'queued' (send immediately). Creates EmailBlastRecipient rows in the
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
export async function scheduleEmailBlastDraft(
  campaignId: string,
  input: {
    recipients: EmailRecipientInput[];
    scheduledFor: Date | null; // null = send immediately
  },
): Promise<EmailBlastSummary> {
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
  const status: EmailBlastStatus = isImmediate ? 'queued' : 'scheduled';

  const updated = await prisma.$transaction(async (tx) => {
    // Clear any pre-existing recipient rows so re-scheduling a draft
    // starts from a clean slate.
    await tx.emailBlastRecipient.deleteMany({ where: { campaignId } });

    await tx.emailBlastRecipient.createMany({
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

    return tx.emailBlast.update({
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

export async function getEmailBlast(campaignId: string): Promise<EmailBlastSummary | null> {
  const row = await prisma.emailBlast.findUnique({
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
export async function deleteEmailBlast(campaignId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.emailBlast.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    if (!row) return;
    if (row.status === 'queued' || row.status === 'processing') {
      throw new Error('Cannot delete a campaign that is currently sending.');
    }
    await tx.emailBlastRecipient.deleteMany({ where: { campaignId } });
    await tx.emailBlast.delete({ where: { id: campaignId } });
  });
}

/**
 * Toggle the archive state on a campaign. Stores the archive flag in
 * two places for back-compat during the migration to a dedicated
 * column: the existing `metadata.archived` flag (legacy callers) and
 * the new `archivedAt` timestamp (drives the 30-day purge job +
 * status filter on the campaigns table). In-flight campaigns
 * (queued/processing) can't be archived to keep the worker's state
 * machine simple.
 */
export async function setEmailBlastArchived(
  campaignId: string,
  archived: boolean,
): Promise<EmailBlastSummary> {
  const existing = await prisma.emailBlast.findUnique({
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
  const updated = await prisma.emailBlast.update({
    where: { id: campaignId },
    data: {
      metadata: JSON.stringify(meta),
      archivedAt: archived ? new Date() : null,
    },
    select: emailCampaignSummarySelect,
  });
  return toSummary(updated);
}

/**
 * Explicit restore — same effect as setEmailBlastArchived(id, false)
 * but rejects rows that aren't currently archived so the UI can
 * surface a clearer error than the legacy toggle would.
 */
export async function restoreEmailBlast(
  campaignId: string,
): Promise<EmailBlastSummary> {
  const existing = await prisma.emailBlast.findUnique({
    where: { id: campaignId },
    select: { archivedAt: true, metadata: true },
  });
  if (!existing) throw new Error('Campaign not found');
  const isArchived =
    existing.archivedAt !== null || parseArchivedMetadata(existing.metadata);
  if (!isArchived) {
    throw new Error('Campaign is not archived — nothing to restore.');
  }
  return setEmailBlastArchived(campaignId, false);
}

/**
 * Hard-delete archived email campaigns whose archivedAt is older than
 * the retention window. Invoked by the daily purge worker. Returns
 * the number of rows removed for logging.
 */
export async function purgeOldArchivedEmailBlasts(
  retentionDays = 30,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  // Hand-rolled fan-out: cascading recipient deletes happen inside
  // deleteEmailBlast which guards against in-flight rows. We
  // pre-filter on archivedAt so the in-flight guard never trips.
  const rows = await prisma.emailBlast.findMany({
    where: { archivedAt: { not: null, lt: cutoff } },
    select: { id: true },
  });
  if (rows.length === 0) return 0;
  await prisma.$transaction(async (tx) => {
    await tx.emailBlastRecipient.deleteMany({
      where: { campaignId: { in: rows.map((r) => r.id) } },
    });
    await tx.emailBlast.deleteMany({
      where: { id: { in: rows.map((r) => r.id) } },
    });
  });
  return rows.length;
}

/**
 * Parses `metadata.archived` out of a JSON string. Returns true iff
 * the row has the legacy archived flag set; callers should treat
 * archivedAt as the new source of truth.
 */
function parseArchivedMetadata(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed?.archived === true;
  } catch {
    return false;
  }
}

/**
 * Create a new draft email campaign by cloning an existing one. Status
 * resets to 'draft', schedule + timestamps clear, name gets a "(Copy)"
 * suffix, and recipient rows are NOT copied — the user will reselect the
 * audience in the Recipients step.
 */
export async function duplicateEmailBlast(
  campaignId: string,
  options?: { createdByUserId?: string; createdByRole?: string },
): Promise<EmailBlastSummary> {
  const source = await prisma.emailBlast.findUnique({
    where: { id: campaignId },
    select: emailCampaignSummarySelect,
  });
  if (!source) {
    throw new Error('Source campaign not found');
  }

  const created = await prisma.emailBlast.create({
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
      sourceContactIds: source.sourceContactIds || null,
      metadata: source.metadata || null,
      createdByUserId: options?.createdByUserId || null,
      createdByRole: options?.createdByRole || null,
    },
    select: emailCampaignSummarySelect,
  });
  return toSummary(created);
}

export type BlastStatusFilter = 'all' | 'archived';

/**
 * Which kind of row to return.
 *
 *   'blasts' (default) — only campaigns a human composed. This is what
 *                        the Blasts list means by "a blast".
 *   'flows'            — only the per-(flow, node) wrapper shells the
 *                        flow engine creates for its email/SMS steps.
 *   'all'              — both.
 *
 * Flow wrappers are excluded by default because they aren't blasts:
 * there's one row per flow STEP (not per send), its counters roll up
 * every enrollment that ever passed through, and it can't be edited,
 * scheduled, duplicated, or re-sent. Left in the list they multiply with
 * every flow email step and bury the real send history.
 */
export type BlastSourceFilter = 'blasts' | 'flows' | 'all';

/** Prisma `where` fragment implementing BlastSourceFilter. Both blast
 *  tables carry the same nullable `flowNodeKey` marker. */
export function blastSourceWhere(
  source: BlastSourceFilter,
): { flowNodeKey?: null | { not: null } } {
  if (source === 'all') return {};
  if (source === 'flows') return { flowNodeKey: { not: null } };
  return { flowNodeKey: null };
}

export async function listEmailBlasts(options?: {
  limit?: number;
  accountKeys?: string[];
  /** 'all' (default) hides archived rows. 'archived' returns only
   *  archived rows so the table can show them under the StatusFilter. */
  statusFilter?: BlastStatusFilter;
  /** Defaults to 'blasts' — flow wrapper rows are hidden. */
  source?: BlastSourceFilter;
}): Promise<EmailBlastSummary[]> {
  const limit = Math.max(1, Math.min(100, options?.limit ?? 25));
  const statusFilter = options?.statusFilter ?? 'all';
  // Filter on archivedAt at the DB layer — much cheaper than fetching
  // everything and dropping rows client-side once we have a real index.
  const where = {
    ...(statusFilter === 'archived'
      ? { archivedAt: { not: null } }
      : { archivedAt: null }),
    ...blastSourceWhere(options?.source ?? 'blasts'),
  };
  const rows = await prisma.emailBlast.findMany({
    where,
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

/**
 * SendGrid's substitution tag for the hosted unsubscribe URL. This is what
 * {{unsubscribe_link}} resolves to at send time, so an unsubscribe button a
 * designer wired up in the template editor becomes a real, per-recipient,
 * one-click unsubscribe link. Single-sourced from unsubscribe-footer.ts so
 * the body, the footer, and the API payload can never drift apart.
 */
const SENDGRID_UNSUBSCRIBE_TAG = UNSUBSCRIBE_TOKEN;

/** Mergetag + opt-out data for one recipient, keyed `accountKey|contactId`. */
type BlastContactRow = BlastContactData & { dndEmail: boolean };

/**
 * Load the Contact rows behind a set of recipients in one query.
 *
 * Keyed on (accountKey, contactId): a contact id is only unique within its
 * account, and a group blast spans several.
 */
async function loadBlastContacts(
  refs: { contactId: string; accountKey: string }[],
): Promise<Map<string, BlastContactRow>> {
  const map = new Map<string, BlastContactRow>();
  const ids = [...new Set(refs.map((r) => r.contactId).filter(Boolean))];
  if (ids.length === 0) return map;

  const rows = await prisma.contact.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      accountKey: true,
      firstName: true,
      lastName: true,
      fullName: true,
      email: true,
      phone: true,
      address1: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      vehicleYear: true,
      vehicleMake: true,
      vehicleModel: true,
      vehicleVin: true,
      vehicleMileage: true,
      lastServiceDate: true,
      nextServiceDate: true,
      leaseEndDate: true,
      warrantyEndDate: true,
      purchaseDate: true,
      dateOfBirth: true,
      customFields: true,
      dnd: true,
    },
  });

  for (const row of rows) {
    // dnd is a loose JSON blob: { email?: bool, sms?: bool }.
    let dndEmail = false;
    if (row.dnd && typeof row.dnd === 'object' && !Array.isArray(row.dnd)) {
      dndEmail = Boolean((row.dnd as Record<string, unknown>).email);
    }
    map.set(`${row.accountKey}|${row.id}`, { ...row, dndEmail });
  }

  return map;
}

/** `accountKey|email` → suppression reason, for the whole batch in one query. */
async function loadSuppressionSet(
  refs: { accountKey: string; email: string }[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const accountKeys = [...new Set(refs.map((r) => r.accountKey).filter(Boolean))];
  const emails = [
    ...new Set(refs.map((r) => r.email.toLowerCase().trim()).filter(Boolean)),
  ];
  if (accountKeys.length === 0 || emails.length === 0) return map;

  const rows = await prisma.emailSuppression.findMany({
    where: { accountKey: { in: accountKeys }, email: { in: emails } },
    select: { accountKey: true, email: true, reason: true },
  });
  for (const row of rows) {
    map.set(`${row.accountKey}|${row.email.toLowerCase().trim()}`, row.reason);
  }
  return map;
}

/** Account-level values behind the {{location.*}} mergetags. */
async function loadBlastAccountData(
  accountKeys: string[],
): Promise<Map<string, BlastAccountData>> {
  const map = new Map<string, BlastAccountData>();
  if (accountKeys.length === 0) return map;

  const rows = await prisma.account.findMany({
    where: { key: { in: accountKeys } },
    select: {
      key: true,
      dealer: true,
      senderEmail: true,
      phone: true,
      address: true,
      city: true,
      state: true,
      postalCode: true,
      website: true,
    },
  });
  for (const row of rows) map.set(row.key, row);
  return map;
}

interface BlastCounts {
  total: number;
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
  firstError: string;
}

/**
 * Collapse recipient counts into the blast's status.
 *
 * `skipped` counts as work DONE. A blast whose entire audience turned out to
 * be suppressed is finished — 'completed' with zero sends — not stuck.
 * Returning 'queued' there (the old behaviour) made the sweep re-pick it
 * forever.
 */
function resolveBlastStatus(counts: BlastCounts): EmailBlastStatus {
  if (counts.pending > 0) return 'processing';
  if (counts.sent > 0 && counts.failed > 0) return 'partial';
  if (counts.sent > 0) return 'completed';
  if (counts.failed > 0) return 'failed';
  if (counts.skipped > 0) return 'completed';
  // Genuinely nothing to do — no recipients at all.
  return 'completed';
}

async function summarizeCampaign(campaignId: string) {
  const recipients = await prisma.emailBlastRecipient.findMany({
    where: { campaignId },
    select: { status: true, error: true },
  });

  let pending = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let firstError = '';

  for (const row of recipients) {
    if (row.status === 'sent') sent += 1;
    else if (row.status === 'failed') {
      failed += 1;
      if (!firstError && row.error) firstError = row.error;
    } else if (row.status === 'skipped') {
      // TERMINAL, not pending. A suppressed/opted-out recipient is a
      // decision, not unfinished work. Counting it as pending used to leave
      // the blast permanently un-completable: the sweep re-picked it every
      // minute (processing/queued are both processable) while its recipient
      // query — which only ever loads status='pending' — came back empty, so
      // it never advanced. A fully-suppressed blast looped forever.
      skipped += 1;
    } else pending += 1;
  }

  return {
    total: recipients.length,
    pending,
    sent,
    failed,
    skipped,
    firstError,
  };
}

// ─────────────────────────────────────────────────────
// Resend to non-engaged
// ─────────────────────────────────────────────────────
//
// The Schedule step has offered a "Resend to non-engaged" toggle for a while,
// and it persisted cleanly into metadata.resend — but no worker ever read it
// back, so the follow-up simply never happened. Anyone who enabled it got a
// UI confirmation and silence.
//
// Shape of the implementation: when a blast finishes, we create a CHILD blast
// scheduled for +delayHours, carrying `resendOf: <parentId>` in its metadata.
// The child is created with NO recipients, because at that moment nobody has
// had a chance to open anything yet — the non-engaged set doesn't exist until
// the delay has elapsed. Recipients are materialized from the parent's
// engagement just before the child sends. The child's own metadata has resend
// disabled, so a follow-up never spawns a follow-up.

/** Marks a blast as a follow-up to `parentId` inside its metadata blob. */
function resendMetadata(sourceType: string, parentId: string): string {
  return JSON.stringify({ sourceType, resendOf: parentId });
}

/**
 * Queue the follow-up blast for a just-finished parent, if one is configured
 * and doesn't already exist.
 */
export async function scheduleResendIfDue(campaignId: string): Promise<void> {
  const parent = await prisma.emailBlast.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      name: true,
      subject: true,
      previewText: true,
      htmlContent: true,
      textContent: true,
      sourceType: true,
      accountKeys: true,
      metadata: true,
      sentCount: true,
      createdByUserId: true,
      createdByRole: true,
      sourceAudienceId: true,
      sourceFilter: true,
      sourceListId: true,
      sourceContactIds: true,
    },
  });
  if (!parent) return;

  const meta = parseCampaignMetadata(parent.metadata);
  if (!meta.resend?.enabled) return;
  // A follow-up never spawns its own follow-up.
  if (meta.resendOf) return;
  // Nothing was delivered, so there's no non-engaged audience to chase.
  if (parent.sentCount <= 0) return;

  // Idempotency: processEmailBlast can legitimately run more than once for
  // one blast (a 'partial' result stays processable), and we must not stack a
  // new follow-up each time. The marker lives in the child's metadata.
  const marker = `"resendOf":"${parent.id}"`;
  const existing = await prisma.emailBlast.findFirst({
    where: { metadata: { contains: marker } },
    select: { id: true },
  });
  if (existing) return;

  const scheduledFor = new Date(Date.now() + meta.resend.delayHours * 3_600_000);

  await prisma.emailBlast.create({
    data: {
      name: `${parent.name || 'Blast'} (follow-up)`,
      subject: meta.resend.subject.trim() || parent.subject,
      previewText: parent.previewText,
      htmlContent: parent.htmlContent,
      textContent: parent.textContent,
      sourceType: parent.sourceType,
      status: 'scheduled',
      scheduledFor,
      accountKeys: parent.accountKeys,
      metadata: resendMetadata(parent.sourceType, parent.id),
      createdByUserId: parent.createdByUserId,
      createdByRole: parent.createdByRole,
      // Audience provenance is carried over for display only — the actual
      // recipients come from the parent's engagement, not a re-evaluation of
      // the segment, so a contact who joined the segment after the original
      // send isn't swept into the follow-up.
      sourceAudienceId: parent.sourceAudienceId,
      sourceFilter: parent.sourceFilter,
      sourceListId: parent.sourceListId,
      sourceContactIds: parent.sourceContactIds,
      totalRecipients: 0,
    },
  });

  console.log(
    `[email-blasts] queued follow-up for ${parent.id} at ${scheduledFor.toISOString()} ` +
      `(+${meta.resend.delayHours}h)`,
  );
}

/**
 * Fill in a follow-up blast's recipients from its parent's engagement.
 *
 * No-op for anything that isn't an unpopulated follow-up, so it's safe to
 * call unconditionally at the top of processEmailBlast.
 *
 * "Non-engaged" = we successfully sent to them, and no open or click event
 * has arrived since. Bounces and spam reports are excluded implicitly: those
 * rows aren't status='sent' on the parent, and the sender re-checks the
 * suppression list anyway.
 */
export async function materializeResendRecipients(campaignId: string): Promise<void> {
  const blast = await prisma.emailBlast.findUnique({
    where: { id: campaignId },
    select: { id: true, metadata: true, status: true },
  });
  if (!blast) return;
  if (TERMINAL_STATUSES.includes(blast.status as EmailBlastStatus)) return;

  const meta = parseCampaignMetadata(blast.metadata);
  if (!meta.resendOf) return;

  // Already populated (or mid-send) — don't rebuild the audience.
  const existingCount = await prisma.emailBlastRecipient.count({
    where: { campaignId },
  });
  if (existingCount > 0) return;

  const parentSends = await prisma.emailBlastRecipient.findMany({
    where: { campaignId: meta.resendOf, status: 'sent' },
    select: { contactId: true, accountKey: true, email: true, fullName: true },
  });
  if (parentSends.length === 0) {
    // Parent delivered nothing; close the follow-up out rather than leaving
    // it to be re-swept every minute forever.
    await prisma.emailBlast.update({
      where: { id: campaignId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        totalRecipients: 0,
        error: 'Follow-up skipped: the original blast had no successful sends.',
      },
    });
    return;
  }

  // One query for every engaging recipient on the parent.
  const engaged = await prisma.emailEvent.findMany({
    where: {
      campaignId: meta.resendOf,
      eventType: { in: ['open', 'click'] },
    },
    select: { email: true },
  });
  const engagedEmails = new Set(
    engaged
      .map((e) => (e.email || '').toLowerCase().trim())
      .filter(Boolean),
  );

  const targets = parentSends.filter((r) => {
    const email = (r.email || '').toLowerCase().trim();
    return email && !engagedEmails.has(email);
  });

  if (targets.length === 0) {
    await prisma.emailBlast.update({
      where: { id: campaignId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        totalRecipients: 0,
        error: 'Follow-up skipped: everyone opened or clicked the original.',
      },
    });
    return;
  }

  await prisma.emailBlastRecipient.createMany({
    data: targets.map((r) => ({
      campaignId,
      contactId: r.contactId,
      accountKey: r.accountKey,
      email: r.email,
      fullName: r.fullName,
      status: 'pending',
      error: null,
    })),
  });
  await prisma.emailBlast.update({
    where: { id: campaignId },
    data: { totalRecipients: targets.length },
  });

  console.log(
    `[email-blasts] follow-up ${campaignId}: ${targets.length} non-engaged of ` +
      `${parentSends.length} sent on ${meta.resendOf}`,
  );
}

export async function processEmailBlast(
  campaignId: string,
  options?: { concurrency?: number },
): Promise<EmailBlastSummary> {
  const concurrency = Math.max(1, Math.min(8, options?.concurrency ?? 3));

  // A follow-up blast is created with an empty audience — its non-engaged set
  // can't be known until the delay has elapsed. Build it now, just before the
  // send. No-op for every other blast.
  await materializeResendRecipients(campaignId);

  // ── Warm-up budget ──
  //
  // Resolved BEFORE the recipients are loaded, from the accounts that still
  // have pending rows, because the answer decides how many to load. Domains
  // with no warm-up row report no limit, which is every established domain —
  // so for almost every send this is one cheap query that changes nothing.
  const pendingAccounts = await prisma.emailBlastRecipient.findMany({
    where: { campaignId, status: 'pending' },
    select: { accountKey: true },
    distinct: ['accountKey'],
  });
  const warmupSenders = await buildSenderMap(
    pendingAccounts.map((r) => r.accountKey),
    '',
  );
  const warmupDomains = [
    ...new Set(
      [...warmupSenders.values()]
        .map((sender) => sendingDomain(sender.senderEmail))
        .filter((domain): domain is string => Boolean(domain)),
    ),
  ];
  const warmupRemaining = await getCombinedRemaining(warmupDomains);

  const campaign = await prisma.emailBlast.findUnique({
    where: { id: campaignId },
    include: {
      recipients: {
        where: { status: 'pending' },
        select: {
          id: true,
          email: true,
          fullName: true,
          accountKey: true,
          // Needed to load the Contact row behind each recipient: mergetag
          // values, plus the `dnd` opt-out flag we re-check at send time.
          contactId: true,
        },
      },
    },
  });

  if (!campaign) throw new Error('Email campaign not found');
  if (TERMINAL_STATUSES.includes(campaign.status as EmailBlastStatus)) {
    return toSummary(campaign);
  }

  if (campaign.recipients.length === 0) {
    const counts = await summarizeCampaign(campaign.id);
    const status = resolveBlastStatus(counts);
    const updated = await prisma.emailBlast.update({
      where: { id: campaign.id },
      data: {
        status,
        totalRecipients: counts.total,
        sentCount: counts.sent,
        failedCount: counts.failed,
        completedAt: status === 'processing' ? null : new Date(),
        error: counts.firstError || null,
      },
    });
    return toSummary(updated);
  }

  await prisma.emailBlast.update({
    where: { id: campaign.id },
    data: {
      status: 'processing',
      startedAt: campaign.startedAt || new Date(),
      completedAt: null,
      error: null,
    },
  });

  // ── Apply the warm-up budget ──
  //
  // Today's allowance is spent: leave every recipient `pending` and stop. The
  // blast keeps status 'processing', which is in PROCESSABLE_STATUSES, so the
  // ordinary sweep picks it up again — tomorrow it will have budget. No new
  // scheduling machinery, and nothing distinguishes a warm-up pause from any
  // other partially-processed blast.
  if (warmupRemaining === 0) {
    console.log(
      `[email-blasts] ${campaign.id}: warm-up budget spent for ` +
        `${warmupDomains.join(', ') || 'sending domain'} — ` +
        `${campaign.recipients.length} recipient(s) held for the next day`,
    );
    return toSummary(
      await prisma.emailBlast.update({
        where: { id: campaign.id },
        data: { status: 'processing', completedAt: null },
      }),
    );
  }

  // Under a cap, send to the most-engaged contacts first — see
  // ./sending/warmup-ordering.ts for why that ordering is the point rather
  // than a nicety. Uncapped sends skip both the query and the sort.
  const recipients =
    warmupRemaining == null
      ? campaign.recipients
      : (await orderByEngagement(campaign.recipients)).slice(0, warmupRemaining);

  // Reserve the budget up front, then hand back whatever the send didn't
  // actually use. Counting only successes afterwards would let two concurrent
  // blasts read the same remaining budget and both spend it.
  const reserved = warmupRemaining == null ? 0 : recipients.length;
  if (reserved > 0) {
    for (const domain of warmupDomains) {
      await recordWarmupSends(domain, reserved);
    }
  }

  const uniqueAccountKeys = [...new Set(recipients.map((r) => r.accountKey))];
  // No `defaultFrom`: bulk blasts are NOT allowed on the shared SMTP
  // transport. See the dispatch block below for why.
  const senderByAccount = await buildSenderMap(uniqueAccountKeys, '');
  const metadata = parseCampaignMetadata(campaign.metadata);

  // Load the merge data + opt-out state for every recipient in one query
  // rather than one-per-send. Keyed by (accountKey, contactId) because a
  // contact id is only unique within its account.
  const contactById = await loadBlastContacts(
    recipients.map((r) => ({
      contactId: r.contactId,
      accountKey: r.accountKey,
    })),
  );

  // Re-read suppressions HERE, not just at schedule time. A blast scheduled
  // for next Tuesday is filtered when it's scheduled; anyone who
  // unsubscribes in between would still be in the pending set. Honouring an
  // opt-out only as of draft time is exactly the kind of thing that
  // generates spam complaints, so the send is the authoritative checkpoint.
  const suppressedAtSend = await loadSuppressionSet(
    recipients.map((r) => ({
      accountKey: r.accountKey,
      email: r.email || '',
    })),
  );

  const accountDataByKey = await loadBlastAccountData(uniqueAccountKeys);

  // The base HTML, before per-recipient mergetag substitution. UTM tagging
  // is applied once here since it rewrites campaign-level links, not
  // per-recipient ones.
  const baseHtml = applyUtmTags(
    withPreviewText(campaign.htmlContent, campaign.previewText || ''),
    metadata.utm,
  );
  const baseText = campaign.textContent?.trim() || stripHtml(campaign.htmlContent);

  // Reputation is spent by mail that LEAVES, so only a successful dispatch
  // counts against the warm-up day. Suppressed, opted-out and invalid
  // recipients reached no inbox and are released below. Single-threaded task
  // runner, so a plain counter is safe.
  let dispatched = 0;

  const tasks = recipients.map((recipient) => async () => {
    const recipientEmail = normalizeEmailAddress(recipient.email || '');
    if (!isLikelyDeliverableEmail(recipientEmail)) {
      await prisma.emailBlastRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'failed',
          error: INVALID_EMAIL_ERROR,
        },
      });
      return;
    }

    // Opt-out re-check, as of NOW. Both of these are recorded as `skipped`
    // rather than `failed`: nothing went wrong, we deliberately didn't send,
    // and the analytics treat the two differently.
    const suppressionReason = suppressedAtSend.get(
      `${recipient.accountKey}|${recipientEmail}`,
    );
    if (suppressionReason) {
      await prisma.emailBlastRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'skipped',
          error: `Suppressed (${suppressionReason})`,
        },
      });
      return;
    }

    const contact = contactById.get(
      `${recipient.accountKey}|${recipient.contactId}`,
    );

    // Contact.dnd is a hard, human-set opt-out ("do not email this person").
    // It was previously honoured only by the segment-eligibility helper that
    // computes the on-screen sendable count — never by the sender — so a
    // recipient list posted from the client could still carry an opted-out
    // contact all the way to a send.
    if (contact?.dndEmail) {
      await prisma.emailBlastRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'skipped',
          error: 'Suppressed (contact opted out of email)',
        },
      });
      return;
    }

    const sender = senderByAccount.get(recipient.accountKey) || {
      from: '',
      replyTo: null,
      senderEmail: null,
      senderName: null,
      sendgridApiKey: null,
      unsubscribeFooter: null,
      footerConfig: null,
    };

    // Dispatch is SendGrid-only for bulk blasts.
    //
    // There used to be a nodemailer/SMTP fallback here, and it was a
    // deliverability trap: it sent no unsubscribe footer, no
    // List-Unsubscribe header, and no physical mailing address (the footer
    // was built for both paths but only ever passed to SendGrid), and when
    // an account had no senderEmail it used the SHARED transactional From
    // address. A blast down that path is both a CAN-SPAM breach and a
    // reputation hit against the transactional domain. Transactional email
    // still uses SMTP elsewhere in the app — but blasts don't.
    const useSendGrid = Boolean(sender.sendgridApiKey && sender.senderEmail);
    if (!useSendGrid) {
      await prisma.emailBlastRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'failed',
          error:
            'Account is not configured for bulk email. Add a SendGrid API key and a From address in Settings → Email & Texts → Sending Config.',
        },
      });
      return;
    }

    try {
      // Per-recipient personalization. This has to happen inside the loop:
      // rendering once outside it is what previously shipped literal
      // {{contact.first_name}} tokens to every inbox.
      //
      // {{unsubscribe_link}} resolves to SendGrid's own substitution tag, so
      // a button the designer wired to that tag in the editor becomes a real
      // per-recipient unsubscribe URL at delivery.
      const mergeCtx = buildBlastMergetagContext({
        contact,
        account: accountDataByKey.get(recipient.accountKey) || null,
        recipientEmail,
        recipientFullName: recipient.fullName,
        unsubscribeToken: SENDGRID_UNSUBSCRIBE_TAG,
      });

      const mergedHtml = applyBlastMergetags(baseHtml, mergeCtx, {
        escape: true,
      });
      const mergedText = applyBlastMergetags(baseText, mergeCtx, {
        escape: false,
      });
      const personalizedSubject = applyBlastMergetags(
        campaign.subject,
        mergeCtx,
        { escape: false },
      );

      // CAN-SPAM footer goes in AFTER mergetags: the injector decides
      // whether to repeat the unsubscribe link by looking for the
      // already-substituted [%unsubscribe_url%] the designer placed. It
      // also lands after applyUtmTags(), which is what keeps UTM params
      // off the unsubscribe URL.
      const withFooter = sender.unsubscribeFooter
        ? injectUnsubscribeFooter({
            html: mergedHtml,
            text: mergedText,
            account: sender.unsubscribeFooter,
            config: sender.footerConfig,
          })
        : { html: mergedHtml, text: mergedText };
      const personalizedHtml = withFooter.html;
      const personalizedText = withFooter.text;

      const result = await sendEmailViaSendGrid({
        apiKey: sender.sendgridApiKey!,
        from: { email: sender.senderEmail!, name: sender.senderName || undefined },
        replyTo: sender.replyTo ? { email: sender.replyTo } : undefined,
        to: { email: recipientEmail, name: recipient.fullName || undefined },
        subject: personalizedSubject,
        html: personalizedHtml,
        text: personalizedText,
        categories: ['loomi', `campaign:${campaign.id}`],
        // Carry these through to the Event webhook so we can correlate
        // opens/clicks/bounces back to the originating row.
        customArgs: {
          campaignId: campaign.id,
          recipientId: recipient.id,
          accountKey: recipient.accountKey,
        },
        // CAN-SPAM: the footer (link + postal address) is already in the
        // body above. SendGrid's remaining job is to turn the tag into a
        // real URL and set the List-Unsubscribe headers. Preflight blocks
        // a send when the account has no complete mailing address, so by
        // the time we get here the footer is populated.
        ...(sender.unsubscribeFooter
          ? { unsubscribe: { substitutionTag: SENDGRID_UNSUBSCRIBE_TAG } }
          : {}),
      });

      dispatched += 1;
      await prisma.emailBlastRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'sent',
          messageId: result.messageId || null,
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
      await prisma.emailBlastRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'failed',
          error: errorMessage,
        },
      });
    }
  });

  await withConcurrencyLimit(tasks, concurrency);

  // Give back the reserved budget the send didn't use.
  //
  // `dispatched` counts messages SendGrid accepted, which is exactly the set
  // that reaches a mailbox provider and can affect reputation. A recipient that
  // was suppressed, opted out, had an unusable address, or that SendGrid
  // rejected outright never left, so it must not burn a warm-up day. A bounce
  // is a different thing and is correctly still counted: it is accepted first
  // and bounces afterwards, by which point the row is already 'sent'.
  if (reserved > dispatched) {
    for (const domain of warmupDomains) {
      await releaseWarmupSends(domain, reserved - dispatched);
    }
  }

  const counts = await summarizeCampaign(campaign.id);
  const nextStatus = resolveBlastStatus(counts);

  const updated = await prisma.emailBlast.update({
    where: { id: campaign.id },
    data: {
      sourceType: metadata.sourceType,
      status: nextStatus,
      totalRecipients: counts.total,
      sentCount: counts.sent,
      failedCount: counts.failed,
      completedAt: nextStatus === 'processing' ? null : new Date(),
      error: counts.firstError || null,
    },
  });

  // Queue the follow-up now that the initial send has finished. Must come
  // after the status update: scheduleResendIfDue reads sent counts to decide
  // whether there's anything to follow up on.
  if (nextStatus !== 'processing') {
    await scheduleResendIfDue(campaign.id);
  }

  return toSummary(updated);
}

export async function processDueEmailBlasts(options?: {
  limit?: number;
  accountKeys?: string[];
  concurrency?: number;
}): Promise<EmailBlastSummary[]> {
  const limit = Math.max(1, Math.min(20, options?.limit ?? 5));
  const now = new Date();

  const rows = await prisma.emailBlast.findMany({
    where: {
      status: { in: PROCESSABLE_STATUSES },
      // Never sweep a flow's wrapper shell. The flow engine owns those
      // rows: it creates the EmailBlastRecipient and sends the
      // per-contact, mergetag-rendered body itself. If this sweep picked
      // one up in the window between the recipient upsert and the send,
      // it would send the wrapper's stored htmlContent to that same
      // recipient — a duplicate email with the wrong personalization.
      ...blastSourceWhere('blasts'),
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

  const summaries: EmailBlastSummary[] = [];
  for (const row of queue) {
    const summary = await processEmailBlast(row.id, { concurrency: options?.concurrency });
    summaries.push(summary);
  }

  return summaries;
}
