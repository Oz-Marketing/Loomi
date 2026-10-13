import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { chunk, DB_CHUNK } from '@/lib/db/chunk';
import {
  isLikelyDeliverableEmail,
  normalizeEmailAddress,
} from '@/lib/contact-hygiene';
import { decryptToken } from '@/lib/crypto/encryption';
import { sendEmailViaSendGrid, SendGridError } from '@/lib/sending/sendgrid';
import { getRelatedAccountKeys } from '@/lib/services/accounts';
import {
  getAllowances,
  getCombinedRemaining,
  recordWarmupSends,
  releaseWarmupSends,
  sendingDomain,
} from '@/lib/sending/warmup';
import { orderByEngagement } from '@/lib/sending/warmup-ordering';
import { resolveDomainMx, domainOf } from '@/lib/sending/mx-check';
import {
  injectUnsubscribeFooter,
  UNSUBSCRIBE_TOKEN,
  type UnsubscribeFooterConfig,
  type UnsubscribeFooterInput,
} from '@/lib/sending/unsubscribe-footer';
import { resolveAccountFooters } from '@/lib/sending/account-footer';
import { applyUtmTags, type BlastUtmSettings } from '@/lib/sending/blast-utm';
import { stripFrontmatter } from '@/lib/email/compile-template';
import {
  applyBlastMergetags,
  buildBlastMergetagContext,
  type BlastContactData,
} from '@/lib/sending/blast-mergetags';
import {
  BLAST_CANCELED_ERROR,
  createCancelGate,
} from '@/lib/sending/blast-cancellation';
import {
  formatPreflightBlockers,
  preflightEmailBlast,
} from '@/lib/sending/blast-preflight';
import { loadEmailSuppressions } from '@/lib/sending/suppression-lookup';
import { loadBlastAccountData } from '@/lib/sending/blast-account-data';
import { applyPreviewText } from '@/lib/sending/preheader';
import { htmlToText } from '@/lib/sending/html-to-text';
import { fromDisplayName } from '@/lib/messaging/blast-sender';
import { cloneTemplate } from '@/lib/services/templates';
import {
  recomputeEmailBlastCounters,
  writeEmailSuppressions,
} from '@/lib/sending/email-delivery-state';
import { isSendStopRequested } from '@/lib/sending/send-control';
import {
  attemptsSoFar,
  classifySendFailure,
  isRecipientAddressRefusal,
  MAX_ATTEMPTS,
  PreSendError,
  sanitizeDisplayName,
  temporaryFailureNote,
} from '@/lib/sending/send-failures';

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

export type EmailBlastStatus =
  | 'draft'
  | 'queued'
  | 'scheduled'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'canceled';

// Drafts are NOT processable — they live until the user explicitly
// schedules them, at which point status transitions to queued/scheduled.
const PROCESSABLE_STATUSES: EmailBlastStatus[] = ['queued', 'scheduled', 'processing'];
const TERMINAL_STATUSES: EmailBlastStatus[] = ['completed', 'failed', 'canceled'];
// An address we deliberately never attempt: missing, or on a domain that
// cannot receive mail (see lib/sending/email-domains.ts). Recorded as
// `skipped`, the same as a suppression — we made a choice, nothing failed.
// It used to be `failed`, which is how a blast to an old list with a handful
// of placeholder addresses reported itself as a send with errors.
const INVALID_EMAIL_ERROR = 'Skipped (address cannot receive mail)';

export interface EmailRecipientInput {
  contactId: string;
  accountKey: string;
  email?: string;
  fullName?: string;
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
/**
 * The follow-up subject the pre-send check must vet, or null when no follow-up
 * is configured or it reuses the blast's own subject. A typo'd merge tag here
 * used to go out literally to every non-opener — it was never checked.
 */
export function resendSubjectToCheck(metadata: string | null | undefined): string | null {
  const resend = parseCampaignMetadata(metadata).resend;
  if (!resend?.enabled) return null;
  return resend.subject.trim() || null;
}

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
      // The same rule the builder displays (lib/messaging/blast-sender.ts):
      // the sender name, else the account's name — never a bare address.
      const displayName = fromDisplayName(account) || null;
      map.set(key, {
        from: formatFromHeader(account.senderEmail, displayName),
        replyTo: account.replyToEmail || null,
        senderEmail: account.senderEmail,
        senderName: displayName,
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
  options?: {
    /**
     * Only write if the blast is still a draft — atomically, in the update
     * itself. A status check before the write leaves a window in which a
     * schedule commits and the edit then lands on a blast that is sending.
     */
    requireDraft?: boolean;
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

  if (options?.requireDraft) {
    const written = await prisma.emailBlast.updateMany({
      where: { id: campaignId, status: 'draft' },
      data,
    });
    if (written.count === 0) throw new BlastNotDraftError();
    return toSummary(
      await prisma.emailBlast.findUniqueOrThrow({ where: { id: campaignId }, select: emailCampaignSummarySelect }),
    );
  }
  const updated = await prisma.emailBlast.update({
    where: { id: campaignId },
    data,
    select: emailCampaignSummarySelect,
  });
  return toSummary(updated);
}

/**
 * Thrown when a blast that is no longer a draft is scheduled again.
 *
 * Scheduling replaces the recipient rows wholesale. Run against a blast that is
 * queued, sending or sent, that would delete the rows already marked `sent` and
 * recreate them as `pending` — and the worker would mail everyone a second
 * time. So scheduling claims the draft, and anything else is refused.
 */
export class BlastNotDraftError extends Error {
  constructor() {
    super(
      'This blast has already been scheduled or sent, so it can no longer be scheduled. ' +
        'Refresh the Blasts list to see where it stands.',
    );
    this.name = 'BlastNotDraftError';
  }
}

/**
 * Interactive-transaction limits for anything sized by an audience: writing a
 * schedule, canceling, deleting, purging. Tens of thousands of rows take far
 * longer than Prisma's 5s default, and a timed-out transaction rolls back —
 * a schedule that didn't happen, or a cancel that left the blast sending.
 */
export const LONG_TX_OPTIONS = { timeout: 120_000, maxWait: 10_000 } as const;

/** Everything a schedule writes, worked out before the transaction opens. */
export interface EmailSchedulePlan {
  campaignId: string;
  status: EmailBlastStatus;
  scheduledFor: Date | null;
  rows: Prisma.EmailBlastRecipientCreateManyInput[];
  totalRecipients: number;
  accountKeys: string[];
}

/**
 * Build the recipient rows for a schedule: dedupe, then mark suppressed and
 * address-less recipients `skipped` so they are kept for audit but never sent.
 * Reads only — the write is writeEmailBlastSchedule.
 *
 * Hard bounces and spam reports from the SendGrid Event webhook are the main
 * producers of suppression rows.
 */
export async function planEmailBlastSchedule(
  campaignId: string,
  input: {
    recipients: EmailRecipientInput[];
    scheduledFor: Date | null; // null = send immediately
  },
): Promise<EmailSchedulePlan> {
  const recipients = dedupeRecipients(input.recipients);
  if (recipients.length === 0) {
    throw new Error('At least one recipient is required');
  }
  const sendableRecipients = recipients.filter((r) => Boolean(r.email));
  if (sendableRecipients.length === 0) {
    throw new Error('No recipients with valid email addresses were provided');
  }

  // Suppressed addresses are written as `skipped` so they're kept for audit
  // but never sent. Group-wide and case-insensitive — the same lookup the send
  // uses (see ./sending/suppression-lookup.ts).
  const isSuppressed = await loadEmailSuppressions(
    sendableRecipients.map((r) => ({ accountKey: r.accountKey, email: r.email })),
  );

  const isImmediate = !input.scheduledFor || input.scheduledFor.getTime() <= Date.now();

  const rows: Prisma.EmailBlastRecipientCreateManyInput[] = recipients.map((recipient) => {
    if (!recipient.email) {
      return {
        campaignId,
        contactId: recipient.contactId,
        accountKey: recipient.accountKey,
        email: null,
        fullName: recipient.fullName || null,
        status: 'skipped',
        error: INVALID_EMAIL_ERROR,
      };
    }
    const suppressionReason = isSuppressed(recipient.accountKey, recipient.email);
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
  });

  return {
    campaignId,
    status: isImmediate ? 'queued' : 'scheduled',
    scheduledFor: isImmediate ? null : input.scheduledFor,
    rows,
    totalRecipients: recipients.length,
    accountKeys: [...new Set(recipients.map((r) => r.accountKey).filter(Boolean))],
  };
}

/**
 * Commit a planned schedule inside `tx`: claim the draft, replace its
 * recipient rows, and stamp the send time.
 *
 * The claim comes first and is conditional on `status = 'draft'`, so it takes
 * the row lock — a double-submitted Schedule click, or a retry after one half
 * of a multi-channel schedule failed, waits for the first write and then finds
 * a blast that is no longer a draft. See BlastNotDraftError.
 */
export async function writeEmailBlastSchedule(
  tx: Prisma.TransactionClient,
  plan: EmailSchedulePlan,
) {
  const claimed = await tx.emailBlast.updateMany({
    where: { id: plan.campaignId, status: 'draft' },
    data: { status: plan.status },
  });
  if (claimed.count === 0) throw new BlastNotDraftError();

  // A draft has no recipient rows of its own; this clears anything a
  // previous, failed attempt might have left.
  await tx.emailBlastRecipient.deleteMany({ where: { campaignId: plan.campaignId } });

  // Inserted in slices — one INSERT per slice keeps each statement under
  // Postgres's bind-parameter limit for audiences of any size.
  for (const slice of chunk(plan.rows, DB_CHUNK)) {
    await tx.emailBlastRecipient.createMany({ data: slice });
  }

  return tx.emailBlast.update({
    where: { id: plan.campaignId },
    data: {
      status: plan.status,
      scheduledFor: plan.scheduledFor,
      totalRecipients: plan.totalRecipients,
      accountKeys: JSON.stringify(plan.accountKeys),
      startedAt: null,
      completedAt: null,
      error: null,
    },
    select: emailCampaignSummarySelect,
  });
}

/**
 * Transitions a draft into 'scheduled' (or 'queued' to send immediately) and
 * creates its EmailBlastRecipient rows in the same transaction, so the pg-boss
 * worker has everything it needs once scheduledFor passes. Only a draft can be
 * scheduled — see BlastNotDraftError.
 */
export async function scheduleEmailBlastDraft(
  campaignId: string,
  input: {
    recipients: EmailRecipientInput[];
    scheduledFor: Date | null; // null = send immediately
  },
): Promise<EmailBlastSummary> {
  const plan = await planEmailBlastSchedule(campaignId, input);
  const updated = await prisma.$transaction(
    (tx) => writeEmailBlastSchedule(tx, plan),
    LONG_TX_OPTIONS,
  );
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
 * Delete a campaign + its recipient rows.
 *
 * Refused for anything that can still send — queued, scheduled or processing.
 * A scheduled blast used to be deletable here even though the list's menu
 * disabled it: cancel first, which records what (if anything) went out, then
 * delete.
 */
export async function deleteEmailBlast(campaignId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.emailBlast.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    if (!row) return;
    if (PROCESSABLE_STATUSES.includes(row.status as EmailBlastStatus)) {
      throw new Error('This blast is scheduled or sending. Cancel it first, then delete it.');
    }
    await tx.emailBlastRecipient.deleteMany({ where: { campaignId } });
    await tx.emailBlast.delete({ where: { id: campaignId } });
  }, LONG_TX_OPTIONS);
}

/**
 * Stop a blast that is scheduled, queued, or already sending.
 *
 * Three things have to happen together or the sweep undoes the cancel:
 *  1. the row leaves PROCESSABLE_STATUSES, so `processDueEmailBlasts` stops
 *     picking it up;
 *  2. every still-`pending` recipient becomes `skipped`, so the counts on the
 *     row describe what actually went out rather than what was planned; and
 *  3. an in-flight `processEmailBlast` notices — it polls this status through
 *     a cancel gate between sends (see ./sending/blast-cancellation.ts).
 *
 * Recipients already marked `sent` stay sent. Mail that has left cannot be
 * recalled, and pretending otherwise in the numbers would be worse than
 * useless — someone reading a canceled blast needs to know exactly how many
 * people did receive it.
 *
 * The transaction gets the long timeout: flipping tens of thousands of pending
 * rows can take longer than Prisma's 5s default, and a timed-out cancel rolls
 * back — leaving the blast sending with no way to stop it.
 *
 * Idempotent on an already-canceled row so a double-click is not an error.
 */
export async function cancelEmailBlast(
  campaignId: string,
): Promise<EmailBlastSummary> {
  const existing = await prisma.emailBlast.findUnique({
    where: { id: campaignId },
    select: { id: true, status: true },
  });
  if (!existing) throw new Error('Campaign not found');

  if (existing.status === 'canceled') {
    const row = await prisma.emailBlast.findUniqueOrThrow({
      where: { id: campaignId },
      select: emailCampaignSummarySelect,
    });
    return toSummary(row);
  }
  if (TERMINAL_STATUSES.includes(existing.status as EmailBlastStatus)) {
    throw new Error(
      'This blast has already finished sending — there is nothing to cancel.',
    );
  }
  if (existing.status === 'draft') {
    throw new Error(
      'This blast is still a draft and is not scheduled to send. Delete it instead.',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.emailBlastRecipient.updateMany({
      where: { campaignId, status: 'pending' },
      data: { status: 'skipped', error: BLAST_CANCELED_ERROR },
    });
    await tx.emailBlast.update({
      where: { id: campaignId },
      data: { status: 'canceled', completedAt: new Date() },
    });
  }, LONG_TX_OPTIONS);

  // Counts are recomputed AFTER the transaction so they reflect anything an
  // in-flight send landed while it was open. (The send pass recounts once
  // more when its last in-flight message lands — see processEmailBlast.)
  await recountBlast(campaignId);
  return readSummary(campaignId);
}

/**
 * Toggle the archive state on a campaign. Stores the archive flag in
 * two places for back-compat during the migration to a dedicated
 * column: the existing `metadata.archived` flag (legacy callers) and
 * the new `archivedAt` timestamp (drives the 30-day purge job +
 * status filter on the campaigns table).
 *
 * Archiving anything that can still send is refused — queued, processing,
 * AND scheduled. A scheduled blast used to be archivable, which hid it from
 * the list while it still went out on time, and one scheduled more than 30
 * days out was purged before it ever sent. Cancel first.
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
  if (archived && PROCESSABLE_STATUSES.includes(existing.status as EmailBlastStatus)) {
    throw new Error('This blast is scheduled or sending. Cancel it first, then archive it.');
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
 *
 * In slices, each with the long transaction timeout: one archived blast can
 * carry tens of thousands of recipient rows, and a purge that times out
 * deletes nothing — every night.
 */
export async function purgeOldArchivedEmailBlasts(
  retentionDays = 30,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.emailBlast.findMany({
    where: {
      archivedAt: { not: null, lt: cutoff },
      // Belt and braces: archiving is refused for these, but never purge a
      // blast that could still send.
      status: { notIn: PROCESSABLE_STATUSES },
    },
    select: { id: true },
  });
  if (rows.length === 0) return 0;
  for (const slice of chunk(rows.map((r) => r.id), 50)) {
    await prisma.$transaction(async (tx) => {
      await tx.emailBlastRecipient.deleteMany({
        where: { campaignId: { in: slice } },
      });
      await tx.emailBlast.deleteMany({
        where: { id: { in: slice } },
      });
    }, LONG_TX_OPTIONS);
  }
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
 * The metadata a copy inherits from its source.
 *
 * Only what describes the CONTENT carries over. Everything else describes the
 * original SEND — its pairing with a text blast, its archive state, its place
 * in a follow-up chain, the send time it saved — and copying those wholesale
 * made a duplicated "Email + Text" blast edit and send the ORIGINAL's text,
 * made a copy of an archived blast invisible in both list views, and made a
 * copy of a follow-up ignore its own follow-up toggle.
 */
const COPYABLE_METADATA_KEYS = [
  'sourceType',
  'sourceMetadata',
  'campaignSource',
  'templateSlug',
  // What the template last supplied for subject/preheader, so the copy keeps
  // following template edits the same way the original did.
  'templateSubject',
  'templatePreheader',
  'utm',
  'resend',
  // Deliberately NOT 'audienceConfirmed': a copy's audience is confirmed
  // again on its own Recipients step.
] as const;

export function metadataForCopy(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const key of COPYABLE_METADATA_KEYS) {
    if (source[key] !== undefined) copy[key] = source[key];
  }
  return Object.keys(copy).length > 0 ? JSON.stringify(copy) : null;
}

/**
 * Create a new draft email campaign by cloning an existing one. Status
 * resets to 'draft', schedule + timestamps clear, name gets a "(Copy)"
 * suffix, and recipient rows are NOT copied — the audience SELECTION is,
 * every mode of it (a list-targeted blast used to lose its list and fall back
 * to "all contacts"). A multi-channel pair is copied as a pair by
 * duplicateBlastWithLinkedChannels, which calls this for the email half.
 */
export async function duplicateEmailBlast(
  campaignId: string,
  options?: { createdByUserId?: string; createdByRole?: string; metadata?: string | null },
): Promise<EmailBlastSummary> {
  const source = await prisma.emailBlast.findUnique({
    where: { id: campaignId },
    select: emailCampaignSummarySelect,
  });
  if (!source) {
    throw new Error('Source campaign not found');
  }

  const copyName = source.name ? `${source.name} (Copy)` : defaultDraftName(new Date());
  const metadata = await withOwnTemplateCopy(
    options?.metadata !== undefined ? options.metadata : metadataForCopy(source.metadata),
    parseAccountKeys(source.accountKeys)[0] ?? null,
    copyName,
    options?.createdByUserId,
  );

  const created = await prisma.emailBlast.create({
    data: {
      name: copyName,
      subject: source.subject || '',
      previewText: source.previewText || null,
      htmlContent: source.htmlContent || '',
      textContent: source.textContent || null,
      sourceType: source.sourceType || 'drag-drop',
      status: 'draft',
      accountKeys: source.accountKeys || JSON.stringify([]),
      sourceAudienceId: source.sourceAudienceId || null,
      sourceFilter: source.sourceFilter || null,
      sourceListId: source.sourceListId || null,
      sourceContactIds: source.sourceContactIds || null,
      metadata,
      createdByUserId: options?.createdByUserId || null,
      createdByRole: options?.createdByRole || null,
    },
    select: emailCampaignSummarySelect,
  });
  return toSummary(created);
}

/**
 * Give a copy its OWN template when the original's is one the account owns.
 *
 * Applying a library template forks it into an account-owned copy for that
 * blast, and the builder only forks again for templates the account doesn't
 * own — so a duplicate would otherwise share its original's fork, and editing
 * the copy's design would silently change the original's (a draft re-syncs
 * from its template). Library and group templates are left alone: the builder
 * forks those on first edit.
 */
async function withOwnTemplateCopy(
  metadata: string | null,
  accountKey: string | null,
  blastName: string,
  userId?: string,
): Promise<string | null> {
  if (!metadata || !accountKey) return metadata;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(metadata) as Record<string, unknown>;
  } catch {
    return metadata;
  }
  const slug = typeof parsed.templateSlug === 'string' ? parsed.templateSlug : '';
  if (!slug) return metadata;
  const template = await prisma.template.findUnique({
    where: { slug },
    select: { accountKey: true, title: true },
  });
  if (!template || template.accountKey !== accountKey) return metadata;

  const copy = await cloneTemplate(slug, undefined, userId, accountKey);
  const base = (template.title || 'Template').replace(/\s+—\s+.*$/, '');
  await prisma.template.update({
    where: { slug: copy.slug },
    data: { title: `${base} — ${blastName}`.slice(0, 120) },
  });
  return JSON.stringify({ ...parsed, templateSlug: copy.slug });
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
  const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, options?.limit ?? 25));
  const statusFilter = options?.statusFilter ?? 'all';
  const accountKeys = (options?.accountKeys ?? []).filter(Boolean);
  // The account filter runs in the database. It used to run after a
  // platform-wide `take`, so once the platform had more blasts than the cap,
  // an account's own scheduled blast could drop off its own list — and nobody
  // could find it to cancel it. accountKeys is a JSON array string, so a
  // quoted-key `contains` is an exact element match.
  const where = {
    ...(statusFilter === 'archived'
      ? { archivedAt: { not: null } }
      : { archivedAt: null }),
    ...blastSourceWhere(options?.source ?? 'blasts'),
    ...(accountKeys.length > 0
      ? {
          OR: [
            ...accountKeys.map((key) => ({ accountKeys: { contains: JSON.stringify(key) } })),
          ],
        }
      : {}),
  };
  const rows = await prisma.emailBlast.findMany({
    where,
    select: emailCampaignSummarySelect,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const allowedAccountKeys = accountKeys.length > 0 ? new Set(accountKeys) : null;
  return rows
    .filter((row) => {
      if (!allowedAccountKeys) return true;
      const keys = parseAccountKeys(row.accountKeys);
      return keys.some((key) => allowedAccountKeys.has(key));
    })
    .map(toSummary);
}

/** Upper bound on one list read — far above any one account's history. */
export const MAX_LIST_LIMIT = 2000;

/** Why a blast is sitting in `processing` without putting mail on the wire. */
export interface WarmupHold {
  /** Sending domain whose daily cap is spent. */
  domain: string;
  /** 1-based position on the ramp, and the ramp's length. */
  day: number | null;
  totalDays: number;
  /** Today's cap for `domain`. */
  dailyCap: number | null;
  /** Recipients still waiting on tomorrow's budget. */
  pending: number;
}

/**
 * For each of `campaignIds` parked by a spent warm-up budget, the domain and
 * ramp position behind the pause.
 *
 * A warm-up pause is deliberately indistinguishable from any other
 * part-processed blast in the data: `processing` with `pending` recipients is
 * the entire representation (see processEmailBlast, which reuses the ordinary
 * sweep rather than inventing scheduling machinery). That keeps the worker
 * simple, but it left the UI showing a bare "Processing" for hours with no
 * indication that anything would ever happen — so recompute the reason for
 * display. Three queries for the whole list, never one per row.
 */
export async function getWarmupHolds(
  campaignIds: string[],
): Promise<Map<string, WarmupHold>> {
  const holds = new Map<string, WarmupHold>();
  if (campaignIds.length === 0) return holds;

  const pending = await prisma.emailBlastRecipient.groupBy({
    by: ['campaignId', 'accountKey'],
    where: { campaignId: { in: campaignIds }, status: 'pending' },
    _count: { _all: true },
  });
  if (pending.length === 0) return holds;

  const senders = await buildSenderMap(
    [...new Set(pending.map((row) => row.accountKey))],
    '',
  );
  const domainByAccount = new Map<string, string>();
  for (const [accountKey, sender] of senders) {
    const domain = sendingDomain(sender.senderEmail);
    if (domain) domainByAccount.set(accountKey, domain);
  }

  const allowances = await getAllowances([...new Set(domainByAccount.values())]);

  for (const row of pending) {
    const domain = domainByAccount.get(row.accountKey);
    if (!domain) continue;
    const allowance = allowances.get(domain);
    // Only a spent budget is a hold. A send with headroom left is simply
    // mid-flight, and an established domain reports no limit at all
    // (remaining === null), which must never read as "held".
    if (!allowance || allowance.status !== 'active') continue;
    if (allowance.remaining === null || allowance.remaining > 0) continue;

    const existing = holds.get(row.campaignId);
    holds.set(row.campaignId, {
      domain,
      day: allowance.day,
      totalDays: allowance.totalDays,
      dailyCap: allowance.dailyCap,
      pending: (existing?.pending ?? 0) + row._count._all,
    });
  }

  return holds;
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

  const rows = (
    await Promise.all(
      chunk(ids, DB_CHUNK).map((slice) =>
        prisma.contact.findMany({
          where: { id: { in: slice } },
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
        }),
      ),
    )
  ).flat();

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

export interface BlastCounts {
  total: number;
  pending: number;
  sent: number;
  /** Messages Loomi could not dispatch. The only kind anyone can act on. */
  failed: number;
  /** Dispatched fine, then refused by the mailbox. A hygiene number. */
  bounced: number;
  skipped: number;
  firstError: string;
}

/**
 * Collapse recipient counts into the blast's status.
 *
 * There is no "sent with errors". If the blast reached anyone, it was sent.
 * Recipients Loomi could not dispatch to are recorded on their own rows (and
 * a bad address is suppressed so it is never attempted again — see
 * handleFailure in processEmailBlast), but they do not change what the blast
 * itself did. The only failure a blast reports is the one where nothing went
 * out at all.
 *
 * `skipped` counts as work DONE. A blast whose entire audience turned out to
 * be suppressed is finished — 'completed' with zero sends — not stuck.
 * Returning 'queued' there (the old behaviour) made the sweep re-pick it
 * forever.
 */
export function resolveBlastStatus(counts: BlastCounts): EmailBlastStatus {
  if (counts.pending > 0) return 'processing';
  if (counts.sent > 0) return 'completed';
  if (counts.failed > 0) return 'failed';
  // Bounces are NOT in either test above. A bounce happens after a successful
  // dispatch, so it says nothing about whether the blast worked: a blast that
  // dispatched everything and bounced on half is 'completed'.
  // The bounces are reported as their own number, and each one suppresses its
  // address so the next blast never attempts it.
  if (counts.bounced > 0) return 'completed';
  if (counts.skipped > 0) return 'completed';
  // Genuinely nothing to do — no recipients at all.
  return 'completed';
}

/**
 * Apply a status/counts write unless the row has been canceled underneath us,
 * then return the row as it now stands.
 *
 * `resolveBlastStatus` derives its answer from recipient counts, and a cancel
 * leaves zero pending rows — so an unguarded write at the end of a send would
 * resolve a canceled blast to 'completed' and erase the fact that someone
 * stopped it.
 */
async function updateUnlessCanceled(
  campaignId: string,
  data: Parameters<typeof prisma.emailBlast.updateMany>[0]['data'],
) {
  await prisma.emailBlast.updateMany({
    where: { id: campaignId, status: { not: 'canceled' } },
    data,
  });
  return prisma.emailBlast.findUniqueOrThrow({
    where: { id: campaignId },
    select: emailCampaignSummarySelect,
  });
}

/**
 * Recipient counts for a blast, by status — one grouped query rather than
 * reading every row, since a send pass recounts after every batch.
 *
 * `skipped` is TERMINAL, not pending: a suppressed/opted-out recipient is a
 * decision, not unfinished work. Counting it as pending used to leave a
 * fully-suppressed blast permanently un-completable — the sweep re-picked it
 * every minute while its pending query came back empty.
 *
 * `bounced` is kept out of `firstError`: that string becomes the blast's
 * `error` column and the headline of the failure banner, and a bounce message
 * ("550 the account does not exist") reads as a system fault when it is a fact
 * about one stale address.
 */
async function summarizeCampaign(campaignId: string): Promise<BlastCounts> {
  const groups = await prisma.emailBlastRecipient.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: { _all: true },
  });

  let total = 0;
  let pending = 0;
  let sent = 0;
  let failed = 0;
  let bounced = 0;
  let skipped = 0;
  for (const group of groups) {
    const n = group._count._all;
    total += n;
    if (group.status === 'sent') sent += n;
    else if (group.status === 'bounced') bounced += n;
    else if (group.status === 'failed') failed += n;
    else if (group.status === 'skipped') skipped += n;
    else pending += n;
  }

  const firstFailure =
    failed > 0
      ? await prisma.emailBlastRecipient.findFirst({
          where: { campaignId, status: 'failed', error: { not: null } },
          select: { error: true },
          orderBy: { id: 'asc' },
        })
      : null;

  return {
    total,
    pending,
    sent,
    failed,
    bounced,
    skipped,
    firstError: firstFailure?.error ?? '',
  };
}

/**
 * Rewrite the blast's sent/failed/bounced counters from its recipient rows,
 * under the blast's row lock (see recomputeEmailBlastCounters). The send path
 * no longer writes the counts it read at the start of its own write: the
 * bounce webhook recounts concurrently, and an unlocked write of an earlier
 * read could put stale numbers over a fresh recount.
 */
async function recountBlast(campaignId: string): Promise<void> {
  await prisma.$transaction((tx) => recomputeEmailBlastCounters(tx, campaignId));
}

async function readSummary(campaignId: string): Promise<EmailBlastSummary> {
  return toSummary(
    await prisma.emailBlast.findUniqueOrThrow({
      where: { id: campaignId },
      select: emailCampaignSummarySelect,
    }),
  );
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

/**
 * Marks a blast as a follow-up to `parentId` inside its metadata blob. The
 * parent's UTM settings carry over — a follow-up used to ship untagged, so its
 * clicks never showed up in the campaign's analytics.
 */
function resendMetadata(
  sourceType: string,
  parentId: string,
  utm: BlastUtmSettings | null,
): string {
  return JSON.stringify({ sourceType, resendOf: parentId, ...(utm ? { utm } : {}) });
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

  // Idempotency: finishing can be observed more than once for one blast, and
  // we must not stack a new follow-up each time. The marker lives in the
  // child's metadata.
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
      metadata: resendMetadata(parent.sourceType, parent.id, meta.utm),
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
 * Events that take a recipient OUT of a follow-up's audience: they engaged
 * (a real open — machine opens are stored as 'machine_open' and don't count —
 * or a click), or they asked not to hear from us again. Unsubscribes and spam
 * reports used to be left in, relying on the send-time suppression check to
 * catch them; that check only works if the webhook recorded the suppression,
 * so they are excluded here as well.
 */
const RESEND_EXCLUDING_EVENTS = [
  'open',
  'click',
  'unsubscribe',
  'group_unsubscribe',
  'spamreport',
];

/**
 * Fill in a follow-up blast's recipients from its parent's engagement.
 *
 * No-op for anything that isn't an unpopulated follow-up, so it's safe to
 * call unconditionally at the top of processEmailBlast.
 *
 * "Non-engaged" = we successfully sent to them, and no open, click,
 * unsubscribe or spam report has arrived since. Bounces are excluded because
 * those rows aren't status='sent' on the parent, and the sender re-checks the
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

  const excluded = await prisma.emailEvent.findMany({
    where: {
      campaignId: meta.resendOf,
      eventType: { in: RESEND_EXCLUDING_EVENTS },
    },
    select: { email: true },
    distinct: ['email'],
  });
  const excludedEmails = new Set(
    excluded
      .map((e) => (e.email || '').toLowerCase().trim())
      .filter(Boolean),
  );

  const targets = parentSends.filter((r) => {
    const email = (r.email || '').toLowerCase().trim();
    return email && !excludedEmails.has(email);
  });

  if (targets.length === 0) {
    await prisma.emailBlast.update({
      where: { id: campaignId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        totalRecipients: 0,
        error: 'Follow-up skipped: everyone opened, clicked, or opted out of the original.',
      },
    });
    return;
  }

  for (const slice of chunk(targets, DB_CHUNK)) {
    await prisma.emailBlastRecipient.createMany({
      data: slice.map((r) => ({
        campaignId,
        contactId: r.contactId,
        accountKey: r.accountKey,
        email: r.email,
        fullName: r.fullName,
        status: 'pending',
        error: null,
      })),
      skipDuplicates: true,
    });
  }
  await prisma.emailBlast.update({
    where: { id: campaignId },
    data: { totalRecipients: targets.length },
  });

  console.log(
    `[email-blasts] follow-up ${campaignId}: ${targets.length} non-engaged of ` +
      `${parentSends.length} sent on ${meta.resendOf}`,
  );
}

// ─────────────────────────────────────────────────────
// Sending
// ─────────────────────────────────────────────────────
//
// A blast is sent in PASSES. Each worker sweep gives every due blast at most
// SEND_BATCH_SIZE recipients — least-recently-progressed blast first — until
// the sweep's time budget runs out; whatever is left waits for the next tick.
//
// It used to be one pass per blast: load every pending recipient and every
// contact behind them, then send them all before moving to the next blast.
// With the 5,000-recipient cap gone (2026-10-12) that meant one large blast
// held every other account's blasts — and every text — for an hour or more,
// held its whole audience in memory on a 2GB host, and outlived pg-boss's job
// expiry. Passes keep memory flat, let blasts interleave, and keep each sweep
// short, so a deploy or crash can only ever interrupt one small batch.

/** Recipients one blast sends in one pass. */
export const SEND_BATCH_SIZE = 500;
/** Wall-clock budget for one sweep across every due blast. */
export const SWEEP_TIME_BUDGET_MS = 50_000;
/**
 * Consecutive failures that say SendGrid itself is unwell rather than one
 * address being bad. The pass stops there and the rest wait for a later one,
 * instead of failing a whole audience against an outage.
 */
const BREAKER_THRESHOLD = 10;

/**
 * Record that SendGrid accepted a message.
 *
 * Guarded on status: a bounce or drop webhook can land before this write, and
 * an unguarded update flipped that recipient back to `sent`. A row the cancel
 * flipped to `skipped` while the message was in flight IS updated — it went
 * out, and the counts should say so.
 *
 * Retried briefly. If it still can't be written the message has gone and we
 * failed to note it; the caller stops the pass rather than carrying on with a
 * database that is refusing writes.
 */
async function recordSent(recipientId: string, messageId: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const updated = await prisma.emailBlastRecipient.updateMany({
        where: { id: recipientId, status: { not: 'bounced' } },
        data: { status: 'sent', messageId: messageId || null, sentAt: new Date(), error: null },
      });
      if (updated.count === 0) {
        await prisma.emailBlastRecipient.update({
          where: { id: recipientId },
          data: { messageId: messageId || null, sentAt: new Date() },
        });
      }
      return;
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
}

/**
 * Close out a blast with nothing left pending: final status, counts, and the
 * follow-up if one is configured. Reached both at the end of the last pass and
 * by a pass that finds nothing to do — the latter used to skip the follow-up,
 * so a worker restart right after the final send meant it was never created.
 */
async function finalizeEmailBlast(campaignId: string): Promise<EmailBlastSummary> {
  const counts = await summarizeCampaign(campaignId);
  const status = resolveBlastStatus(counts);
  const updated = await updateUnlessCanceled(campaignId, {
    status,
    totalRecipients: counts.total,
    completedAt: status === 'processing' ? null : new Date(),
    error: counts.firstError || null,
  });
  await recountBlast(campaignId);
  // Must come after the recount: scheduleResendIfDue reads the sent count.
  if (status !== 'processing' && updated.status !== 'canceled') {
    await scheduleResendIfDue(campaignId);
  }
  return readSummary(campaignId);
}

interface SendPassOptions {
  concurrency?: number;
  batchSize?: number;
  deadline?: number;
}

/**
 * Send one pass of a blast: up to `batchSize` of its pending recipients.
 *
 * Callers loop over passes (processDueEmailBlasts). A pass that leaves
 * recipients pending returns the blast still `processing`.
 */
export async function processEmailBlast(
  campaignId: string,
  options?: SendPassOptions,
): Promise<EmailBlastSummary> {
  return (await processEmailBlastPass(campaignId, options)).summary;
}

/**
 * One pass, plus whether it got anywhere: false when the blast was held by
 * its warm-up cap, paused, already finished, or had nothing to send — the
 * sweep stops offering it more passes this tick.
 */
async function processEmailBlastPass(
  campaignId: string,
  options?: SendPassOptions,
): Promise<{ summary: EmailBlastSummary; progressed: boolean }> {
  const concurrency = Math.max(1, Math.min(8, options?.concurrency ?? 3));
  const batchSize = Math.max(1, options?.batchSize ?? SEND_BATCH_SIZE);
  const deadline = options?.deadline ?? Number.POSITIVE_INFINITY;

  // A follow-up blast is created with an empty audience — its non-engaged set
  // can't be known until the delay has elapsed. Build it now, just before the
  // send. No-op for every other blast.
  await materializeResendRecipients(campaignId);

  const campaign = await prisma.emailBlast.findUnique({
    where: { id: campaignId },
    select: emailCampaignSummarySelect,
  });
  if (!campaign) throw new Error('Email campaign not found');
  // A draft never sends — only a schedule route moves a blast out of draft.
  if (
    campaign.status === 'draft' ||
    TERMINAL_STATUSES.includes(campaign.status as EmailBlastStatus)
  ) {
    return { summary: toSummary(campaign), progressed: false };
  }

  const pendingAccounts = await prisma.emailBlastRecipient.findMany({
    where: { campaignId, status: 'pending' },
    select: { accountKey: true },
    distinct: ['accountKey'],
  });
  if (pendingAccounts.length === 0) {
    return { summary: await finalizeEmailBlast(campaignId), progressed: false };
  }
  const pendingAccountKeys = pendingAccounts.map((r) => r.accountKey);

  // ── Send-time gate ──
  //
  // Scheduling ran the full preflight, but a blast can wait days for its send
  // time — and a follow-up is created without ever being scheduled by a
  // person. Someone clearing the postal address or swapping the From to an
  // unauthenticated domain in the meantime must stop the send, not ride on a
  // check that passed last Friday. Account and content checks only; the
  // audience was judged when it was chosen. A blocked blast pauses with the
  // reason on the row and resumes on its own once it's fixed.
  const gate = await preflightEmailBlast({
    subject: campaign.subject || '',
    htmlContent: campaign.htmlContent || '',
    textContent: campaign.textContent,
    previewText: campaign.previewText,
    resendSubject: resendSubjectToCheck(campaign.metadata),
    accountKeys: pendingAccountKeys,
  });
  if (!gate.ok) {
    const reason = `Paused: ${formatPreflightBlockers(gate)} Sending resumes on its own once this is fixed.`;
    console.warn(`[email-blasts] ${campaignId}: ${reason}`);
    return {
      summary: toSummary(await updateUnlessCanceled(campaignId, { error: reason })),
      progressed: false,
    };
  }

  // ── Warm-up budget ──
  //
  // Resolved BEFORE any recipient is loaded, from the accounts that still have
  // pending rows, because the answer decides how many to load — and a blast
  // whose budget is spent shouldn't load anything at all. Domains with no
  // warm-up row report no limit, which is every established domain.
  const warmupSenders = await buildSenderMap(pendingAccountKeys, '');
  const warmupDomains = [
    ...new Set(
      [...warmupSenders.values()]
        .map((sender) => sendingDomain(sender.senderEmail))
        .filter((domain): domain is string => Boolean(domain)),
    ),
  ];
  const warmupRemaining = await getCombinedRemaining(warmupDomains);

  // Claim the blast. `updateMany` with a status guard rather than `update`,
  // because a cancel can land between the read above and this write — an
  // unguarded write would put a canceled blast straight back into
  // 'processing' and the sweep would happily finish sending it.
  const claimed = await prisma.emailBlast.updateMany({
    where: { id: campaignId, status: { in: PROCESSABLE_STATUSES } },
    data: {
      status: 'processing',
      startedAt: campaign.startedAt || new Date(),
      completedAt: null,
    },
  });
  if (claimed.count === 0) {
    return { summary: await readSummary(campaignId), progressed: false };
  }

  // Today's allowance is spent: leave every recipient `pending` and stop. The
  // blast keeps status 'processing', so the sweep picks it up again — tomorrow
  // it will have budget. The write also moves it to the back of the sweep's
  // queue, so held blasts can't take every slot from blasts that can send.
  if (warmupRemaining === 0) {
    console.log(
      `[email-blasts] ${campaignId}: warm-up budget spent for ` +
        `${warmupDomains.join(', ') || 'sending domain'} — held for the next day`,
    );
    return {
      summary: toSummary(
        await updateUnlessCanceled(campaignId, { status: 'processing', completedAt: null, error: null }),
      ),
      progressed: false,
    };
  }

  const take =
    warmupRemaining == null ? batchSize : Math.min(batchSize, warmupRemaining);
  const recipientSelect = {
    id: true,
    email: true,
    fullName: true,
    accountKey: true,
    contactId: true,
    // A retryable failure keeps the row pending and records its attempt count
    // here (see ./sending/send-failures.ts).
    error: true,
  } as const;
  // Fresh recipients before ones that already failed once, so an outage
  // spreads a single attempt across the audience instead of spending one
  // unlucky batch's five attempts.
  const batch =
    warmupRemaining == null
      ? await prisma.emailBlastRecipient.findMany({
          where: { campaignId, status: 'pending' },
          select: recipientSelect,
          orderBy: [{ error: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
          take,
        })
      : // Under a cap, send to the most-engaged contacts first — see
        // ./sending/warmup-ordering.ts for why that ordering is the point.
        (
          await orderByEngagement(
            await prisma.emailBlastRecipient.findMany({
              where: { campaignId, status: 'pending' },
              select: recipientSelect,
            }),
          )
        ).slice(0, take);

  const metadata = parseCampaignMetadata(campaign.metadata);

  // Reserve the budget up front, then hand back whatever the pass didn't use
  // — in a `finally`, so a pass that throws can't leak its reservation and
  // hold the domain until midnight. Counting only successes afterwards would
  // let two concurrent senders read the same remaining budget and both spend
  // it.
  const reserved = warmupRemaining == null ? 0 : batch.length;
  if (reserved > 0) {
    for (const domain of warmupDomains) {
      await recordWarmupSends(domain, reserved);
    }
  }

  // Reputation is spent by mail that LEAVES, so only a successful dispatch
  // counts against the warm-up day. Single-threaded task runner, so plain
  // counters are safe.
  let dispatched = 0;
  let consecutiveFailures = 0;
  let pausedReason: string | null = null;
  // Recipients this pass brought to an outcome — sent, skipped, or failed for
  // good. A pass that only produced temporary failures made no progress, and
  // the sweep must not hand it the same recipients again seconds later.
  let resolved = 0;

  try {
    const batchAccountKeys = [...new Set(batch.map((r) => r.accountKey))];
    // No `defaultFrom`: bulk blasts are NOT allowed on the shared SMTP
    // transport. See the dispatch block below for why.
    const senderByAccount = await buildSenderMap(batchAccountKeys, '');

    // Merge data + opt-out state for this batch's contacts in one query.
    const contactById = await loadBlastContacts(batch);

    // Re-read opt-outs HERE, for every batch — not just at schedule time and
    // not just once per blast. A blast can take hours to send; someone who
    // unsubscribes from an earlier message mid-run must not get this one.
    // Group-wide and case-insensitive (see ./sending/suppression-lookup.ts).
    const suppressedAtSend = await loadEmailSuppressions(
      batch.map((r) => ({ accountKey: r.accountKey, email: r.email })),
    );

    const accountDataByKey = await loadBlastAccountData(batchAccountKeys);

    // ── Don't knock on doors that aren't there ──
    //
    // A domain publishing no MX (and no A record to fall back on) cannot
    // receive mail from anyone. Sending anyway earns a guaranteed hard bounce,
    // charged to OUR sending domain's reputation. Fails open — a resolver that
    // times out returns `unknown` and the address is sent to.
    const mxByDomain = await resolveDomainMx(batch.map((r) => r.email));

    // The base HTML, before per-recipient mergetag substitution. UTM tagging
    // is applied once here since it rewrites campaign-level links. Blasts
    // compiled before /api/preview stripped a template's frontmatter block
    // still carry it in htmlContent, so strip again at dispatch.
    const sendHtml = stripFrontmatter(campaign.htmlContent);
    // The blast's preview text REPLACES the template's own preheader rather
    // than stacking a second one in front of it (the inbox snippet used to
    // show both).
    const baseHtml = applyUtmTags(applyPreviewText(sendHtml, campaign.previewText), metadata.utm);
    // The plain-text part, generated from the final HTML so it carries the
    // same (UTM-tagged) links — the old tag-stripper dropped every URL, the
    // unsubscribe link included, and left entities and the hidden preheader in.
    const baseText = campaign.textContent?.trim() || htmlToText(baseHtml);

    // Polled between sends so a cancel stops the loop rather than only the
    // next sweep. One query per second at most, shared across the tasks.
    const isCanceled = createCancelGate(async () => {
      const row = await prisma.emailBlast.findUnique({
        where: { id: campaignId },
        select: { status: true },
      });
      return row?.status === 'canceled';
    });
    const shouldStop = async () =>
      pausedReason !== null ||
      Date.now() >= deadline ||
      isSendStopRequested() ||
      (await isCanceled());

    const skip = async (recipientId: string, error: string) => {
      resolved += 1;
      // Guarded: a cancel may already have resolved this row.
      await prisma.emailBlastRecipient.updateMany({
        where: { id: recipientId, status: 'pending' },
        data: { status: 'skipped', error },
      });
    };

    const markBadAddress = async (
      recipient: (typeof batch)[number],
      message: string,
    ): Promise<void> => {
      const email = normalizeEmailAddress(recipient.email || '');
      const accountKeys = [recipient.accountKey, ...(await getRelatedAccountKeys(recipient.accountKey))];
      await prisma.$transaction(async (tx) => {
        await tx.emailBlastRecipient.updateMany({
          where: { id: recipient.id, status: 'pending' },
          data: { status: 'bounced', error: `bounce: ${message}` },
        });
        if (email) {
          await writeEmailSuppressions(tx, {
            accountKeys,
            email,
            reason: 'bounce',
            source: 'send-refusal',
            raw: message,
          });
        }
      });
    };

    const handleFailure = async (
      recipient: (typeof batch)[number],
      err: unknown,
    ): Promise<void> => {
      const kind = classifySendFailure(err);
      const message =
        err instanceof SendGridError
          ? `SendGrid: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Failed to send email';

      if (kind === 'auth') {
        // Not this recipient's fault. Leave everyone pending and pause.
        pausedReason ??=
          `Paused: SendGrid rejected this account's API key (${message}). Update it in ` +
          'Settings → Email & Texts → Sending Config; sending resumes on its own.';
        return;
      }

      if (kind === 'retry') {
        consecutiveFailures += 1;
        const attempt = attemptsSoFar(recipient.error) + 1;
        if (attempt >= MAX_ATTEMPTS) resolved += 1;
        await prisma.emailBlastRecipient.updateMany({
          where: { id: recipient.id, status: 'pending' },
          data:
            attempt >= MAX_ATTEMPTS
              ? { status: 'failed', error: `${message} (gave up after ${attempt} attempts)` }
              : { error: temporaryFailureNote(attempt, message) },
        });
      } else if (kind === 'ambiguous') {
        consecutiveFailures += 1;
        resolved += 1;
        await prisma.emailBlastRecipient.updateMany({
          where: { id: recipient.id, status: 'pending' },
          data: {
            status: 'failed',
            error:
              `${message} — SendGrid didn't confirm this message, so it may or may not ` +
              'have arrived. It was not retried, to avoid sending it twice.',
          },
        });
      } else if (isRecipientAddressRefusal(err)) {
        // SendGrid refused the ADDRESS. That is a fact about the contact, not
        // a fault in the send: record it as a bad address alongside the
        // bounces and suppress it group-wide, so no later blast attempts it.
        consecutiveFailures = 0;
        resolved += 1;
        await markBadAddress(recipient, message);
      } else {
        // A definite per-message refusal: SendGrid is up and answering.
        consecutiveFailures = 0;
        resolved += 1;
        await prisma.emailBlastRecipient.updateMany({
          where: { id: recipient.id, status: 'pending' },
          data: { status: 'failed', error: message },
        });
      }

      if (consecutiveFailures >= BREAKER_THRESHOLD) {
        pausedReason ??=
          `Paused: SendGrid stopped accepting mail (${message}). ` +
          'The rest of this blast is waiting and will retry on its own.';
      }
    };

    const tasks = batch.map((recipient) => async () => {
      // Stop starting new sends the moment a cancel, a pause, the sweep's
      // time budget or a shutdown says so. The row itself is left alone.
      if (await shouldStop()) return;

      const recipientEmail = normalizeEmailAddress(recipient.email || '');
      if (!isLikelyDeliverableEmail(recipientEmail)) {
        await skip(recipient.id, INVALID_EMAIL_ERROR);
        return;
      }

      // Opt-out re-check, as of NOW. Recorded as `skipped` rather than
      // `failed`: nothing went wrong, we deliberately didn't send.
      const suppressionReason = suppressedAtSend(recipient.accountKey, recipientEmail);
      if (suppressionReason) {
        await skip(recipient.id, `Suppressed (${suppressionReason})`);
        return;
      }

      // Dead domain — skip rather than attempt. Only a definitive `no-mx`
      // counts; `unknown` and a missing entry both mean the lookup told us
      // nothing, so the message goes out.
      const recipientDomain = domainOf(recipientEmail);
      if (recipientDomain && mxByDomain.get(recipientDomain) === 'no-mx') {
        await skip(recipient.id, `Skipped (${recipientDomain} does not accept mail)`);
        return;
      }

      const contact = contactById.get(`${recipient.accountKey}|${recipient.contactId}`);
      // The contact was deleted after the blast was scheduled. Someone removed
      // them from the account on purpose; don't mail them from a stale list.
      if (!contact) {
        await skip(recipient.id, 'Skipped (contact no longer exists)');
        return;
      }

      // Contact.dnd is a hard, human-set opt-out ("do not email this person").
      if (contact.dndEmail) {
        await skip(recipient.id, 'Suppressed (contact opted out of email)');
        return;
      }

      const sender = senderByAccount.get(recipient.accountKey);
      // Dispatch is SendGrid-only for bulk blasts. A nodemailer/SMTP fallback
      // used to live here and sent with no unsubscribe footer, no
      // List-Unsubscribe header, no postal address, and — with no senderEmail —
      // the SHARED transactional From address. Transactional email still uses
      // SMTP elsewhere in the app; blasts don't.
      if (!sender?.sendgridApiKey || !sender.senderEmail) {
        // The send-time gate normally catches this first. A configuration
        // problem isn't this recipient's: pause with everyone still pending
        // rather than failing the audience one by one.
        pausedReason ??=
          'Paused: this account is not configured for bulk email. Add a SendGrid API key and a ' +
          'From address in Settings → Email & Texts → Sending Config; sending resumes on its own.';
        return;
      }
      const account = accountDataByKey.get(recipient.accountKey) || null;

      // Build the message. Per-recipient: rendering once outside the loop is
      // what previously shipped literal {{contact.first_name}} tokens to every
      // inbox. A failure here happens before any request, so it's safe to
      // retry (PreSendError → 'retry').
      let message: { subject: string; html: string; text: string };
      try {
        // {{unsubscribe_link}} resolves to SendGrid's own substitution tag, so
        // a button the designer wired to it becomes a real per-recipient
        // unsubscribe URL at delivery.
        const mergeCtx = buildBlastMergetagContext({
          contact,
          account,
          recipientEmail,
          recipientFullName: recipient.fullName,
          unsubscribeToken: SENDGRID_UNSUBSCRIBE_TAG,
        });
        const mergedHtml = applyBlastMergetags(baseHtml, mergeCtx, { escape: true });
        const mergedText = applyBlastMergetags(baseText, mergeCtx, { escape: false });
        // CAN-SPAM footer goes in AFTER mergetags: the injector decides whether
        // to repeat the unsubscribe link by looking for the already-substituted
        // [%unsubscribe_url%] the designer placed. It also lands after
        // applyUtmTags(), which keeps UTM params off the unsubscribe URL.
        const withFooter = sender.unsubscribeFooter
          ? injectUnsubscribeFooter({
              html: mergedHtml,
              text: mergedText,
              account: sender.unsubscribeFooter,
              config: sender.footerConfig,
            })
          : { html: mergedHtml, text: mergedText };
        message = {
          subject: applyBlastMergetags(campaign.subject, mergeCtx, { escape: false }),
          html: withFooter.html,
          text: withFooter.text,
        };
      } catch (err) {
        await handleFailure(
          recipient,
          new PreSendError(
            `Couldn't build this email: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        return;
      }

      let result: { messageId: string };
      try {
        result = await sendEmailViaSendGrid({
          apiKey: sender.sendgridApiKey,
          // The From name falls back to the account's name — the builder shows
          // it that way, and a bare address in the inbox reads as spam.
          from: {
            email: sender.senderEmail,
            name: sanitizeDisplayName(sender.senderName || account?.dealer),
          },
          replyTo: sender.replyTo ? { email: sender.replyTo } : undefined,
          to: { email: recipientEmail, name: sanitizeDisplayName(recipient.fullName) },
          subject: message.subject,
          html: message.html,
          text: message.text,
          categories: ['loomi', `campaign:${campaignId}`],
          // Carried through to the Event webhook so opens/clicks/bounces
          // correlate back to the originating row.
          customArgs: {
            campaignId,
            recipientId: recipient.id,
            accountKey: recipient.accountKey,
          },
          // CAN-SPAM: the footer (link + postal address) is already in the body.
          // SendGrid's remaining job is to turn the tag into a real URL and set
          // the List-Unsubscribe headers.
          ...(sender.unsubscribeFooter
            ? { unsubscribe: { substitutionTag: SENDGRID_UNSUBSCRIBE_TAG } }
            : {}),
        });
      } catch (err) {
        await handleFailure(recipient, err);
        return;
      }

      dispatched += 1;
      resolved += 1;
      consecutiveFailures = 0;
      try {
        await recordSent(recipient.id, result.messageId);
      } catch (err) {
        // SendGrid has the message; we couldn't write that down. Never mark it
        // failed — it went out. Stop the pass: carrying on against a database
        // refusing writes would only widen the gap. The row stays pending, so
        // this one recipient may be sent again on the next pass.
        console.error(
          `[email-blasts] ${campaignId}: sent to recipient ${recipient.id} but could not record it`,
          err,
        );
        pausedReason ??=
          'Paused: Loomi could not record a sent message (database error). Sending resumes on the next pass.';
      }
    });

    await withConcurrencyLimit(tasks, concurrency);
  } finally {
    // Give back the reserved budget the pass didn't use. `dispatched` counts
    // messages SendGrid accepted — exactly the set that reaches a mailbox
    // provider and can affect reputation. A bounce is still counted: it was
    // accepted first and bounced afterwards.
    if (reserved > dispatched) {
      for (const domain of warmupDomains) {
        await releaseWarmupSends(domain, reserved - dispatched).catch((err) =>
          console.error(`[email-blasts] ${campaignId}: warm-up release failed`, err),
        );
      }
    }
  }

  const counts = await summarizeCampaign(campaignId);
  const nextStatus = resolveBlastStatus(counts);
  const updated = await updateUnlessCanceled(campaignId, {
    sourceType: metadata.sourceType,
    status: nextStatus,
    totalRecipients: counts.total,
    completedAt: nextStatus === 'processing' ? null : new Date(),
    error: pausedReason ?? (counts.firstError || null),
  });

  // The counters, under the row lock — including on a blast canceled
  // mid-pass, whose own count was written before this pass's in-flight
  // messages finished. (The status stays canceled; only counts move.)
  await recountBlast(campaignId);

  // Queue the follow-up once the blast has finished. Must come after the
  // recount: scheduleResendIfDue reads the sent count. A canceled blast gets
  // no follow-up.
  if (nextStatus !== 'processing' && updated.status !== 'canceled') {
    await scheduleResendIfDue(campaignId);
  }

  return {
    summary: await readSummary(campaignId),
    progressed: resolved > 0 && pausedReason === null && updated.status !== 'canceled',
  };
}

/**
 * One sweep: rotate passes across every due blast until the time budget runs
 * out — least-recently-progressed first, round after round.
 *
 * Ordering by `updatedAt` makes it a rotation — every pass ends with a write
 * to the blast, which sends it to the back — so a blast held by the warm-up
 * cap can't take every slot, and a "send now" blast isn't stuck behind
 * scheduled ones. (It used to order by `scheduledFor`, which Postgres sorts
 * NULL — every "send now" — LAST, behind held blasts that could sit in front
 * for days.) Rounds repeat within the budget so a lone large blast keeps
 * sending all tick rather than one batch a minute; a blast that is held,
 * paused or finished sits out the rest of the tick, so an outage isn't
 * retried every few seconds.
 *
 * Each blast is isolated: one that throws is logged and the sweep moves on,
 * where before it stopped every blast queued behind it.
 */
export async function processDueEmailBlasts(options?: {
  limit?: number;
  accountKeys?: string[];
  concurrency?: number;
  timeBudgetMs?: number;
}): Promise<EmailBlastSummary[]> {
  const limit = Math.max(1, Math.min(200, options?.limit ?? 50));
  const deadline = Date.now() + (options?.timeBudgetMs ?? SWEEP_TIME_BUDGET_MS);
  const allowedAccountKeys = options?.accountKeys && options.accountKeys.length > 0
    ? new Set(options.accountKeys)
    : null;

  const summaries: EmailBlastSummary[] = [];
  const sittingOut = new Set<string>();

  while (Date.now() < deadline && !isSendStopRequested()) {
    const now = new Date();
    const rows = await prisma.emailBlast.findMany({
      where: {
        status: { in: PROCESSABLE_STATUSES },
        // Archiving is refused for anything that can still send; this keeps a
        // legacy archived row from going out hidden.
        archivedAt: null,
        // Never sweep a flow's wrapper shell. The flow engine owns those rows:
        // it creates the EmailBlastRecipient and sends the per-contact body
        // itself. If this sweep picked one up between the recipient upsert
        // and the send, it would send the wrapper's stored htmlContent to that
        // same recipient — a duplicate email with the wrong personalization.
        ...blastSourceWhere('blasts'),
        ...(sittingOut.size > 0 ? { id: { notIn: [...sittingOut] } } : {}),
        OR: [
          { scheduledFor: null },
          { scheduledFor: { lte: now } },
        ],
      },
      orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      select: { id: true, accountKeys: true },
    });
    const queue = rows.filter((row) => {
      if (!allowedAccountKeys) return true;
      const keys = parseAccountKeys(row.accountKeys);
      return keys.some((key) => allowedAccountKeys.has(key));
    });
    if (queue.length === 0) break;

    let progressed = false;
    for (const row of queue) {
      if (Date.now() >= deadline || isSendStopRequested()) break;
      try {
        const pass = await processEmailBlastPass(row.id, {
          concurrency: options?.concurrency,
          deadline,
        });
        summaries.push(pass.summary);
        if (pass.progressed) progressed = true;
        else sittingOut.add(row.id);
      } catch (err) {
        console.error(`[email-blasts] ${row.id}: send pass failed`, err);
        sittingOut.add(row.id);
      }
    }
    if (!progressed) break;
  }

  return summaries;
}
