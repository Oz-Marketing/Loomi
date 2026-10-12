import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { chunk, DB_CHUNK } from '@/lib/db/chunk';
import { normalisePhone } from '@/lib/contacts/normalize';
import { loadSmsSuppressions, phoneMatchKey } from '@/lib/sending/suppression-lookup';
import { isSendStopRequested } from '@/lib/sending/send-control';
import { recordSmsOptOut } from '@/lib/sending/opt-outs';
import { loadBlastAccountData } from '@/lib/sending/blast-account-data';
import {
  attemptsSoFar,
  classifyTwilioFailure,
  MAX_ATTEMPTS,
  PreSendError,
  temporaryFailureNote,
} from '@/lib/sending/send-failures';
import {
  BlastNotDraftError,
  blastSourceWhere,
  LONG_TX_OPTIONS,
  MAX_LIST_LIMIT,
  type BlastSourceFilter,
} from './email-blasts';
import {
  resolveTwilioConfig,
  sendSmsViaTwilio,
  TwilioError,
  type TwilioConfig,
} from '@/lib/sending/twilio';
import {
  applyBlastMergetags,
  buildBlastMergetagContext,
  type BlastContactData,
} from '@/lib/sending/blast-mergetags';
import {
  isWithinQuietHours,
  nextPermittedInstant,
  resolveRecipientZones,
  MAX_DEFERRAL_MS,
  QUIET_HOURS_START_HOUR,
} from '@/lib/sending/sms-quiet-hours';
import {
  BLAST_CANCELED_ERROR,
  createCancelGate,
} from '@/lib/sending/blast-cancellation';

type OutboundMessageChannel = 'SMS' | 'MMS';

/**
 * Run async tasks with a concurrency limit. Inlined here (was previously
 * in a shared utils module) so the SMS worker has no cross-module dep.
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

/**
 * Build the public URL Twilio will POST status callbacks to. The
 * accountKey is routed through the query string so the webhook handler
 * can resolve the right Twilio Auth Token for signature verification
 * (one webhook endpoint, many sub-accounts).
 *
 * APP_PUBLIC_URL falls through to NEXTAUTH_URL since both point at the
 * production origin in deploy. Localhost dev sends don't get callbacks
 * unless the env var points at a tunnel (ngrok / Cloudflare) — that's
 * intentional; status callbacks are noise during local development.
 */
function buildStatusCallbackUrl(accountKey: string): string | undefined {
  const origin =
    process.env.APP_PUBLIC_URL ||
    process.env.NEXTAUTH_URL ||
    '';
  if (!origin) return undefined;
  return `${origin.replace(/\/$/, '')}/api/webhooks/twilio/status?accountKey=${encodeURIComponent(accountKey)}`;
}
import {
  isLikelyDialablePhone,
  normalizePhoneNumber,
} from '@/lib/contact-hygiene';

export type SmsBlastStatus =
  | 'draft'
  | 'queued'
  | 'scheduled'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'canceled';

export interface SmsRecipientInput {
  contactId: string;
  accountKey: string;
  phone?: string;
  fullName?: string;
}

export interface SmsBlastSummary {
  id: string;
  name: string;
  /** Non-empty only on the per-(flow, node) wrapper shells the flow
   *  engine creates — see BlastSourceFilter in email-blasts.ts. */
  flowNodeKey: string;
  message: string;
  status: SmsBlastStatus;
  scheduledFor: string;
  startedAt: string;
  completedAt: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  /** Twilio took it, a carrier refused it. Not a send failure. */
  undeliveredCount: number;
  accountKeys: string[];
  sourceAudienceId: string;
  sourceFilter: string;
  sourceListId: string;
  /** JSON-stringified array of Contact IDs for manual ad-hoc selections.
   *  Mutually exclusive with sourceListId and sourceAudienceId+sourceFilter. */
  sourceContactIds: string;
  metadata: string;
  createdAt: string;
  updatedAt: string;
  error: string;
}

const PROCESSABLE_STATUSES: SmsBlastStatus[] = ['queued', 'scheduled', 'processing'];
const TERMINAL_STATUSES: SmsBlastStatus[] = ['completed', 'partial', 'failed', 'canceled'];

type ResolvedMessagingRuntime =
  | {
      kind: 'twilio';
      provider: 'twilio';
      config: TwilioConfig;
    }
  | {
      kind: 'error';
      error: string;
    };

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

function normalizeRecipient(input: SmsRecipientInput): SmsRecipientInput | null {
  const contactId = String(input.contactId || '').trim();
  const accountKey = String(input.accountKey || '').trim();
  if (!contactId || !accountKey) return null;

  const normalizedPhone = normalizePhoneNumber(input.phone);

  return {
    contactId,
    accountKey,
    phone: isLikelyDialablePhone(normalizedPhone) ? normalizedPhone : '',
    fullName: input.fullName ? String(input.fullName).trim() : '',
  };
}

function dedupeRecipients(recipients: SmsRecipientInput[]): SmsRecipientInput[] {
  const byContactKey = new Map<string, SmsRecipientInput>();
  for (const recipient of recipients) {
    const normalized = normalizeRecipient(recipient);
    if (!normalized) continue;

    const key = `${normalized.accountKey}::${normalized.contactId}`;
    const existing = byContactKey.get(key);
    if (!existing) {
      byContactKey.set(key, normalized);
      continue;
    }

    // Prefer keeping the row that has a dialable phone when duplicates exist.
    if (!existing.phone && normalized.phone) {
      byContactKey.set(key, normalized);
    }
  }

  // One text per handset. Compared by phoneMatchKey, not the stored string:
  // "(801) 555-0101" and "+1 801 555 0101" are the same phone, and two
  // contacts in one household used to get the same text twice.
  const seenPhones = new Set<string>();
  const deduped: SmsRecipientInput[] = [];
  for (const recipient of byContactKey.values()) {
    if (!recipient.phone) {
      deduped.push(recipient);
      continue;
    }
    const key = phoneMatchKey(recipient.phone);
    if (seenPhones.has(key)) continue;
    seenPhones.add(key);
    deduped.push(recipient);
  }
  return deduped;
}

function normalizeChannel(value: unknown): OutboundMessageChannel {
  const text = String(value || '').trim().toUpperCase();
  return text === 'MMS' ? 'MMS' : 'SMS';
}

function normalizeMediaUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const urls = raw
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .filter((url) => /^https?:\/\/\S+$/i.test(url));
  return [...new Set(urls)];
}

function parseCampaignMetadata(raw: string | null | undefined): {
  channel: OutboundMessageChannel;
  mediaUrls: string[];
  /**
   * Set by the Schedule step's "send at 8am local time instead" option. When
   * true, a recipient inside their quiet period is HELD rather than blocking
   * the whole blast — see the send loop below.
   */
  deferOutsideQuietHours: boolean;
} {
  if (!raw) {
    return { channel: 'SMS', mediaUrls: [], deferOutsideQuietHours: false };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      channel: normalizeChannel(parsed.channel),
      mediaUrls: normalizeMediaUrls(parsed.mediaUrls),
      deferOutsideQuietHours: Boolean(parsed.deferOutsideQuietHours),
    };
  } catch {
    return { channel: 'SMS', mediaUrls: [], deferOutsideQuietHours: false };
  }
}

function toSummary(row: {
  id: string;
  name: string | null;
  // Optional: some call sites hand toSummary a row selected without it.
  flowNodeKey?: string | null;
  message: string;
  status: string;
  scheduledFor: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  /** Twilio took it, a carrier refused it. Not a send failure. */
  undeliveredCount: number;
  accountKeys: string;
  sourceAudienceId: string | null;
  sourceFilter: string | null;
  sourceListId: string | null;
  sourceContactIds: string | null;
  metadata: string | null;
  createdAt: Date;
  updatedAt: Date;
  error: string | null;
}): SmsBlastSummary {
  return {
    id: row.id,
    name: row.name || '',
    flowNodeKey: row.flowNodeKey || '',
    message: row.message,
    status: row.status as SmsBlastStatus,
    scheduledFor: row.scheduledFor?.toISOString() || '',
    startedAt: row.startedAt?.toISOString() || '',
    completedAt: row.completedAt?.toISOString() || '',
    totalRecipients: row.totalRecipients,
    sentCount: row.sentCount,
    failedCount: row.failedCount,
    undeliveredCount: row.undeliveredCount,
    accountKeys: parseAccountKeys(row.accountKeys),
    sourceAudienceId: row.sourceAudienceId || '',
    sourceFilter: row.sourceFilter || '',
    sourceListId: row.sourceListId || '',
    sourceContactIds: row.sourceContactIds || '',
    metadata: row.metadata || '',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    error: row.error || '',
  };
}

const smsCampaignSummarySelect = {
  id: true,
  name: true,
  flowNodeKey: true,
  message: true,
  status: true,
  scheduledFor: true,
  startedAt: true,
  completedAt: true,
  totalRecipients: true,
  sentCount: true,
  failedCount: true,
  undeliveredCount: true,
  accountKeys: true,
  sourceAudienceId: true,
  sourceFilter: true,
  sourceListId: true,
  sourceContactIds: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  error: true,
} as const;

function defaultDraftName(now: Date): string {
  return `Campaign ${now.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

/** Creates an empty SmsBlast in 'draft' status for the builder flow. */
export async function createDraftSmsBlast(input: {
  name?: string;
  accountKeys?: string[];
  createdByUserId?: string;
  createdByRole?: string;
}): Promise<SmsBlastSummary> {
  const name = (input.name || '').trim() || defaultDraftName(new Date());
  const created = await prisma.smsBlast.create({
    data: {
      name,
      message: '',
      status: 'draft',
      accountKeys: JSON.stringify(input.accountKeys || []),
      createdByUserId: input.createdByUserId || null,
      createdByRole: input.createdByRole || null,
    },
    select: smsCampaignSummarySelect,
  });
  return toSummary(created);
}

/** PATCH-style update for an in-flight SMS draft. */
export async function updateSmsBlastDraft(
  campaignId: string,
  patch: {
    name?: string;
    message?: string;
    accountKeys?: string[];
    sourceAudienceId?: string | null;
    sourceFilter?: string | null;
    sourceListId?: string | null;
    sourceContactIds?: string | null;
    scheduledFor?: Date | null;
    status?: SmsBlastStatus;
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
): Promise<SmsBlastSummary> {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.message !== undefined) data.message = patch.message;
  if (patch.accountKeys !== undefined) data.accountKeys = JSON.stringify(patch.accountKeys);
  if (patch.sourceAudienceId !== undefined) data.sourceAudienceId = patch.sourceAudienceId;
  if (patch.sourceFilter !== undefined) data.sourceFilter = patch.sourceFilter;
  if (patch.sourceListId !== undefined) data.sourceListId = patch.sourceListId;
  if (patch.sourceContactIds !== undefined) data.sourceContactIds = patch.sourceContactIds;
  if (patch.scheduledFor !== undefined) data.scheduledFor = patch.scheduledFor;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.metadata !== undefined) data.metadata = patch.metadata;

  if (options?.requireDraft) {
    const written = await prisma.smsBlast.updateMany({
      where: { id: campaignId, status: 'draft' },
      data,
    });
    if (written.count === 0) throw new BlastNotDraftError();
    return toSummary(
      await prisma.smsBlast.findUniqueOrThrow({ where: { id: campaignId }, select: smsCampaignSummarySelect }),
    );
  }
  const updated = await prisma.smsBlast.update({
    where: { id: campaignId },
    data,
    select: smsCampaignSummarySelect,
  });
  return toSummary(updated);
}

const INVALID_PHONE_ERROR = 'Recipient phone is missing or blocked by hygiene policy';

/** Everything an SMS schedule writes, worked out before the transaction opens. */
export interface SmsSchedulePlan {
  campaignId: string;
  status: SmsBlastStatus;
  scheduledFor: Date | null;
  rows: Prisma.SmsBlastRecipientCreateManyInput[];
  totalRecipients: number;
  accountKeys: string[];
}

/**
 * Build the recipient rows for an SMS schedule. Reads only — the write is
 * writeSmsBlastSchedule.
 *
 * Deduped on the normalized phone as well as the contact: a household where
 * two contacts share one number gets one text, not two.
 */
export async function planSmsBlastSchedule(
  campaignId: string,
  input: {
    recipients: SmsRecipientInput[];
    scheduledFor: Date | null;
  },
): Promise<SmsSchedulePlan> {
  const recipients = dedupeRecipients(input.recipients || []);
  if (recipients.length === 0) throw new Error('At least one recipient is required');
  const sendable = recipients.filter((r) => Boolean(r.phone));
  if (sendable.length === 0) {
    throw new Error('No recipients with valid phone numbers were provided');
  }

  // ── Suppression filter ──
  // Phones that opted out via STOP (or were manually suppressed) are written
  // as status='skipped' rather than silently dropped, so the audit log shows
  // why nothing got sent. Group-wide and format-insensitive — the same lookup
  // the send uses (see ./sending/suppression-lookup.ts).
  const isSuppressed = await loadSmsSuppressions(
    sendable.map((r) => ({ accountKey: r.accountKey, phone: r.phone })),
  );

  const isImmediate = !input.scheduledFor || input.scheduledFor.getTime() <= Date.now();

  const rows: Prisma.SmsBlastRecipientCreateManyInput[] = recipients.map((r) => {
    if (!r.phone) {
      return {
        campaignId,
        contactId: r.contactId,
        accountKey: r.accountKey,
        phone: null,
        fullName: r.fullName || null,
        status: 'failed',
        error: INVALID_PHONE_ERROR,
      };
    }
    const reason = isSuppressed(r.accountKey, r.phone);
    if (reason) {
      return {
        campaignId,
        contactId: r.contactId,
        accountKey: r.accountKey,
        phone: r.phone,
        fullName: r.fullName || null,
        status: 'skipped',
        error: `Suppressed (${reason})`,
      };
    }
    return {
      campaignId,
      contactId: r.contactId,
      accountKey: r.accountKey,
      phone: r.phone,
      fullName: r.fullName || null,
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
 * Commit a planned SMS schedule inside `tx`. Claims the draft first, exactly
 * as writeEmailBlastSchedule does and for the same reason: re-scheduling a
 * blast that is already sending would recreate its sent rows as pending.
 */
export async function writeSmsBlastSchedule(
  tx: Prisma.TransactionClient,
  plan: SmsSchedulePlan,
) {
  const claimed = await tx.smsBlast.updateMany({
    where: { id: plan.campaignId, status: 'draft' },
    data: { status: plan.status },
  });
  if (claimed.count === 0) throw new BlastNotDraftError();

  await tx.smsBlastRecipient.deleteMany({ where: { campaignId: plan.campaignId } });

  // Inserted in slices — one INSERT per slice keeps each statement under
  // Postgres's bind-parameter limit for audiences of any size.
  for (const slice of chunk(plan.rows, DB_CHUNK)) {
    await tx.smsBlastRecipient.createMany({ data: slice });
  }

  return tx.smsBlast.update({
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
    select: smsCampaignSummarySelect,
  });
}

/**
 * Transitions an SMS draft into 'scheduled' or 'queued' and persists
 * recipient rows. The pg-boss worker picks it up once scheduledFor passes.
 * Only a draft can be scheduled — see BlastNotDraftError.
 */
export async function scheduleSmsBlastDraft(
  campaignId: string,
  input: {
    recipients: SmsRecipientInput[];
    scheduledFor: Date | null;
  },
): Promise<SmsBlastSummary> {
  const plan = await planSmsBlastSchedule(campaignId, input);
  const updated = await prisma.$transaction(
    (tx) => writeSmsBlastSchedule(tx, plan),
    LONG_TX_OPTIONS,
  );
  return toSummary(updated);
}

export async function getSmsBlast(campaignId: string): Promise<SmsBlastSummary | null> {
  const row = await prisma.smsBlast.findUnique({
    where: { id: campaignId },
    select: smsCampaignSummarySelect,
  });
  return row ? toSummary(row) : null;
}

/**
 * Delete an SMS campaign + its recipient rows. Refused for anything that can
 * still send — queued, scheduled or processing; cancel first. (Mirror of
 * deleteEmailBlast.)
 */
export async function deleteSmsBlast(campaignId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.smsBlast.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    if (!row) return;
    if (PROCESSABLE_STATUSES.includes(row.status as SmsBlastStatus)) {
      throw new Error('This blast is scheduled or sending. Cancel it first, then delete it.');
    }
    await tx.smsBlastRecipient.deleteMany({ where: { campaignId } });
    await tx.smsBlast.delete({ where: { id: campaignId } });
  }, LONG_TX_OPTIONS);
}

/**
 * Stop an SMS blast that is scheduled, queued, or already sending.
 *
 * Mirror of cancelEmailBlast — see that function for why the row has to leave
 * PROCESSABLE_STATUSES and every pending recipient has to be resolved in the
 * same breath.
 *
 * Texts held by TCPA quiet hours are the case this matters most for: they sit
 * `pending` with a "holding until 8am local" note, sometimes overnight, and
 * until now there was no way to call one back before its window opened.
 *
 * Idempotent on an already-canceled row.
 */
export async function cancelSmsBlast(
  campaignId: string,
): Promise<SmsBlastSummary> {
  const existing = await prisma.smsBlast.findUnique({
    where: { id: campaignId },
    select: { id: true, status: true },
  });
  if (!existing) throw new Error('Campaign not found');

  if (existing.status === 'canceled') {
    const row = await prisma.smsBlast.findUniqueOrThrow({
      where: { id: campaignId },
      select: smsCampaignSummarySelect,
    });
    return toSummary(row);
  }
  if (TERMINAL_STATUSES.includes(existing.status as SmsBlastStatus)) {
    throw new Error(
      'This blast has already finished sending — there is nothing to cancel.',
    );
  }
  if (existing.status === 'draft') {
    throw new Error(
      'This blast is still a draft and is not scheduled to send. Delete it instead.',
    );
  }

  // Long timeout: a timed-out cancel rolls back and the blast keeps sending.
  await prisma.$transaction(async (tx) => {
    await tx.smsBlastRecipient.updateMany({
      where: { campaignId, status: 'pending' },
      data: { status: 'skipped', error: BLAST_CANCELED_ERROR },
    });
    await tx.smsBlast.update({
      where: { id: campaignId },
      data: { status: 'canceled', completedAt: new Date() },
    });
  }, LONG_TX_OPTIONS);

  const counts = await summarizeCampaign(campaignId);
  const updated = await prisma.smsBlast.update({
    where: { id: campaignId },
    data: {
      totalRecipients: counts.total,
      sentCount: counts.sent,
      failedCount: counts.failed,
      undeliveredCount: counts.undelivered,
    },
    select: smsCampaignSummarySelect,
  });
  return toSummary(updated);
}

/**
 * Toggle archive state on an SMS campaign. Same back-compat pattern
 * as email campaigns: writes both the legacy `metadata.archived` flag
 * and the new `archivedAt` timestamp. The timestamp drives the daily
 * 30-day purge job + the status filter on the campaigns table.
 * In-flight campaigns (queued/processing) can't be archived.
 */
export async function setSmsBlastArchived(
  campaignId: string,
  archived: boolean,
): Promise<SmsBlastSummary> {
  const existing = await prisma.smsBlast.findUnique({
    where: { id: campaignId },
    select: { status: true, metadata: true },
  });
  if (!existing) throw new Error('Campaign not found');
  // Scheduled included — see setEmailBlastArchived.
  if (archived && PROCESSABLE_STATUSES.includes(existing.status as SmsBlastStatus)) {
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
  const updated = await prisma.smsBlast.update({
    where: { id: campaignId },
    data: {
      metadata: JSON.stringify(meta),
      archivedAt: archived ? new Date() : null,
    },
    select: smsCampaignSummarySelect,
  });
  return toSummary(updated);
}

/**
 * Explicit restore — rejects rows that aren't currently archived so
 * the UI surfaces a clearer error than the toggle.
 */
export async function restoreSmsBlast(
  campaignId: string,
): Promise<SmsBlastSummary> {
  const existing = await prisma.smsBlast.findUnique({
    where: { id: campaignId },
    select: { archivedAt: true, metadata: true },
  });
  if (!existing) throw new Error('Campaign not found');
  const isArchived =
    existing.archivedAt !== null || parseArchivedMetadata(existing.metadata);
  if (!isArchived) {
    throw new Error('Campaign is not archived — nothing to restore.');
  }
  return setSmsBlastArchived(campaignId, false);
}

/**
 * Hard-delete archived SMS campaigns whose archivedAt is older than
 * the retention window. Daily worker job.
 */
export async function purgeOldArchivedSmsBlasts(
  retentionDays = 30,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.smsBlast.findMany({
    where: {
      archivedAt: { not: null, lt: cutoff },
      status: { notIn: PROCESSABLE_STATUSES },
    },
    select: { id: true },
  });
  if (rows.length === 0) return 0;
  // In slices with the long timeout — see purgeOldArchivedEmailBlasts.
  for (const slice of chunk(rows.map((r) => r.id), 50)) {
    await prisma.$transaction(async (tx) => {
      await tx.smsBlastRecipient.deleteMany({
        where: { campaignId: { in: slice } },
      });
      await tx.smsBlast.deleteMany({
        where: { id: { in: slice } },
      });
    }, LONG_TX_OPTIONS);
  }
  return rows.length;
}

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
 * Metadata an SMS copy inherits — the message's own settings, not the
 * original send's pairing, archive state, quiet-hours decision or saved send
 * time. See metadataForCopy in email-blasts.ts for what copying it all broke.
 */
const COPYABLE_SMS_METADATA_KEYS = ['channel', 'mediaUrls', 'sourceMetadata', 'campaignSource'] as const;

export function smsMetadataForCopy(raw: string | null | undefined): string | null {
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
  for (const key of COPYABLE_SMS_METADATA_KEYS) {
    if (source[key] !== undefined) copy[key] = source[key];
  }
  return Object.keys(copy).length > 0 ? JSON.stringify(copy) : null;
}

/**
 * Clone an SMS campaign into a new draft. Status resets, recipient rows are
 * not copied; the audience SELECTION is, every mode of it. A multi-channel
 * pair is copied as a pair by duplicateBlastWithLinkedChannels.
 */
export async function duplicateSmsBlast(
  campaignId: string,
  options?: { createdByUserId?: string; createdByRole?: string; metadata?: string | null },
): Promise<SmsBlastSummary> {
  const source = await prisma.smsBlast.findUnique({
    where: { id: campaignId },
    select: smsCampaignSummarySelect,
  });
  if (!source) {
    throw new Error('Source campaign not found');
  }

  const created = await prisma.smsBlast.create({
    data: {
      name: source.name ? `${source.name} (Copy)` : defaultDraftName(new Date()),
      message: source.message || '',
      status: 'draft',
      accountKeys: source.accountKeys || JSON.stringify([]),
      sourceAudienceId: source.sourceAudienceId || null,
      sourceFilter: source.sourceFilter || null,
      sourceListId: source.sourceListId || null,
      sourceContactIds: source.sourceContactIds || null,
      metadata:
        options?.metadata !== undefined ? options.metadata : smsMetadataForCopy(source.metadata),
      createdByUserId: options?.createdByUserId || null,
      createdByRole: options?.createdByRole || null,
    },
    select: smsCampaignSummarySelect,
  });
  return toSummary(created);
}

export type BlastStatusFilter = 'all' | 'archived';
// Re-exported rather than redefined so the two blast services can never
// disagree about what counts as a flow wrapper.
export type { BlastSourceFilter } from './email-blasts';

export async function listSmsBlasts(options?: {
  limit?: number;
  accountKeys?: string[];
  /** 'all' (default) hides archived rows. 'archived' returns only
   *  archived rows so the table can show them under the StatusFilter. */
  statusFilter?: BlastStatusFilter;
  /** Defaults to 'blasts' — flow wrapper rows are hidden. */
  source?: BlastSourceFilter;
}): Promise<SmsBlastSummary[]> {
  const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, options?.limit ?? 25));
  const statusFilter = options?.statusFilter ?? 'all';
  const accountKeys = (options?.accountKeys ?? []).filter(Boolean);
  // Account filter in the database — see listEmailBlasts for why it can't
  // run after the `take`.
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
  const rows = await prisma.smsBlast.findMany({
    where,
    select: smsCampaignSummarySelect,
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

/**
 * Apply a status/counts write unless the row has been canceled underneath us,
 * then return the row as it now stands. See the email twin for the reasoning:
 * a cancel leaves zero pending rows, so an unguarded write would resolve a
 * canceled blast to 'completed'.
 */
async function updateUnlessCanceled(
  campaignId: string,
  data: Parameters<typeof prisma.smsBlast.updateMany>[0]['data'],
) {
  await prisma.smsBlast.updateMany({
    where: { id: campaignId, status: { not: 'canceled' } },
    data,
  });
  return prisma.smsBlast.findUniqueOrThrow({
    where: { id: campaignId },
    select: smsCampaignSummarySelect,
  });
}

/**
 * Recipient counts for a blast, by status, in one grouped query. `skipped` is
 * terminal (a STOP is a decision, not unfinished work) and `undelivered` stays
 * out of `firstError` — see the email twin for both.
 */
async function summarizeCampaign(campaignId: string): Promise<SmsBlastCounts> {
  const groups = await prisma.smsBlastRecipient.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: { _all: true },
  });

  let total = 0;
  let pending = 0;
  let sent = 0;
  let failed = 0;
  let undelivered = 0;
  let skipped = 0;
  for (const group of groups) {
    const n = group._count._all;
    total += n;
    if (group.status === 'sent') sent += n;
    else if (group.status === 'undelivered') undelivered += n;
    else if (group.status === 'failed') failed += n;
    else if (group.status === 'skipped') skipped += n;
    else pending += n;
  }

  const firstFailure =
    failed > 0
      ? await prisma.smsBlastRecipient.findFirst({
          where: { campaignId, status: 'failed', error: { not: null } },
          select: { error: true },
          orderBy: { id: 'asc' },
        })
      : null;

  return { total, pending, sent, failed, undelivered, skipped, firstError: firstFailure?.error ?? '' };
}

export interface SmsBlastCounts {
  total: number;
  pending: number;
  sent: number;
  /** Messages Loomi could not hand to Twilio. The only kind anyone can act on. */
  failed: number;
  /** Twilio took it; a carrier refused it afterwards. A hygiene number. */
  undelivered: number;
  skipped: number;
  firstError: string;
}

/**
 * Collapse recipient counts into the blast's status.
 *
 * `pending` still means "processing" — that is what keeps a quiet-hours-held
 * blast in flight across the minutes or hours until its recipients' local
 * windows open. `skipped` counts as work DONE, so an all-opted-out blast
 * completes with zero sends instead of looping.
 */
export function resolveSmsBlastStatus(counts: SmsBlastCounts): SmsBlastStatus {
  if (counts.pending > 0) return 'processing';
  if (counts.sent > 0 && counts.failed > 0) return 'partial';
  if (counts.sent > 0) return 'completed';
  if (counts.failed > 0) return 'failed';
  // Carrier refusals are absent from the tests above on purpose — the mirror
  // of the bounce rule in email-blasts.ts. Twilio accepted the message, so the
  // blast did its job; a dead handset is a fact about the number, it
  // auto-suppresses, and it must not render the send as "Sent with errors".
  if (counts.undelivered > 0) return 'completed';
  if (counts.skipped > 0) return 'completed';
  return 'completed';
}

/** Mergetag + opt-out data for one recipient, keyed `accountKey|contactId`. */
type SmsContactRow = BlastContactData & { dndSms: boolean };

/** Load merge data + SMS opt-out state for a batch in one query. */
async function loadSmsContacts(
  refs: { contactId: string; accountKey: string }[],
): Promise<Map<string, SmsContactRow>> {
  const map = new Map<string, SmsContactRow>();
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
            city: true,
            state: true,
            vehicleYear: true,
            vehicleMake: true,
            vehicleModel: true,
            lastServiceDate: true,
            nextServiceDate: true,
            leaseEndDate: true,
            purchaseDate: true,
            customFields: true,
            dnd: true,
          },
        }),
      ),
    )
  ).flat();

  for (const row of rows) {
    let dndSms = false;
    if (row.dnd && typeof row.dnd === 'object' && !Array.isArray(row.dnd)) {
      dndSms = Boolean((row.dnd as Record<string, unknown>).sms);
    }
    map.set(`${row.accountKey}|${row.id}`, { ...row, dndSms });
  }
  return map;
}


/** Recipients one SMS blast sends in one pass. */
export const SMS_SEND_BATCH_SIZE = 500;
/** Wall-clock budget for one sweep across every due SMS blast. */
export const SMS_SWEEP_TIME_BUDGET_MS = 50_000;
/** Consecutive failures that say Twilio itself is unwell. */
const SMS_BREAKER_THRESHOLD = 10;

/**
 * Close out an SMS blast with nothing left pending.
 */
async function finalizeSmsBlast(campaignId: string): Promise<SmsBlastSummary> {
  const counts = await summarizeCampaign(campaignId);
  const status = resolveSmsBlastStatus(counts);
  const updated = await updateUnlessCanceled(campaignId, {
    status,
    totalRecipients: counts.total,
    sentCount: counts.sent,
    failedCount: counts.failed,
    undeliveredCount: counts.undelivered,
    completedAt: status === 'processing' ? null : new Date(),
    error: counts.firstError || null,
  });
  return toSummary(updated);
}

/**
 * Record that Twilio accepted a text. Guarded so a status callback that beat
 * this write (an `undelivered` from the carrier) isn't flipped back to `sent`;
 * retried briefly — see recordSent in email-blasts.ts.
 */
async function recordSmsSent(recipientId: string, messageSid: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const updated = await prisma.smsBlastRecipient.updateMany({
        where: { id: recipientId, status: { not: 'undelivered' } },
        data: { status: 'sent', messageId: messageSid, sentAt: new Date(), error: null },
      });
      if (updated.count === 0) {
        await prisma.smsBlastRecipient.update({
          where: { id: recipientId },
          data: { messageId: messageSid, sentAt: new Date() },
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
 * Send one pass of an SMS blast: up to `batchSize` recipients whose local
 * quiet hours are over. Same pass model as processEmailBlast.
 *
 * Quiet hours make the batch selection different from email's: a pass loads
 * the (lightweight) pending list, holds the rows still inside their local
 * window, and sends up to `batchSize` of the rest. Taking the first N pending
 * rows instead would let a batch of held Eastern numbers block Pacific ones
 * whose window is open. A hold note is only rewritten when it changes, rather
 * than on every held row every minute.
 */
interface SmsSendPassOptions {
  concurrency?: number;
  batchSize?: number;
  deadline?: number;
}

export async function processSmsBlast(
  campaignId: string,
  options?: SmsSendPassOptions,
): Promise<SmsBlastSummary> {
  return (await processSmsBlastPass(campaignId, options)).summary;
}

/** One pass, plus whether it got anywhere — see processEmailBlastPass. */
async function processSmsBlastPass(
  campaignId: string,
  options?: SmsSendPassOptions,
): Promise<{ summary: SmsBlastSummary; progressed: boolean }> {
  const concurrency = Math.max(1, Math.min(8, options?.concurrency ?? 4));
  const batchSize = Math.max(1, options?.batchSize ?? SMS_SEND_BATCH_SIZE);
  const deadline = options?.deadline ?? Number.POSITIVE_INFINITY;

  const campaign = await prisma.smsBlast.findUnique({
    where: { id: campaignId },
    select: smsCampaignSummarySelect,
  });
  if (!campaign) throw new Error('SMS campaign not found');
  if (
    campaign.status === 'draft' ||
    TERMINAL_STATUSES.includes(campaign.status as SmsBlastStatus)
  ) {
    return { summary: toSummary(campaign), progressed: false };
  }

  const pending = await prisma.smsBlastRecipient.findMany({
    where: { campaignId, status: 'pending' },
    select: {
      id: true,
      contactId: true,
      accountKey: true,
      phone: true,
      error: true,
      // Needed to cap how long a quiet-hours hold can last.
      createdAt: true,
    },
    orderBy: { id: 'asc' },
  });
  if (pending.length === 0) {
    return { summary: await finalizeSmsBlast(campaignId), progressed: false };
  }

  // Claim the blast. Guarded so a cancel landing between the read above and
  // this write isn't put straight back into 'processing' — see the email twin.
  const claimed = await prisma.smsBlast.updateMany({
    where: { id: campaignId, status: { in: PROCESSABLE_STATUSES } },
    data: {
      status: 'processing',
      startedAt: campaign.startedAt || new Date(),
      completedAt: null,
    },
  });
  if (claimed.count === 0) {
    return {
      summary: toSummary(
        await prisma.smsBlast.findUniqueOrThrow({
          where: { id: campaignId },
          select: smsCampaignSummarySelect,
        }),
      ),
      progressed: false,
    };
  }

  // The shared loader: account custom values, branding and timezone, the
  // same data an email blast's merge tags read.
  const accountDataByKey = await loadBlastAccountData([
    ...new Set(pending.map((r) => r.accountKey)),
  ]);
  const sendInstant = new Date();

  // ── TCPA quiet hours ──
  // The window is the recipient's local one, derived from their area code, so
  // a single blast across four timezones has four different legal windows.
  // Outside it the row is HELD as pending rather than failed: the sweep runs
  // every minute, so each tranche goes out the moment its own window opens.
  const eligible: typeof pending = [];
  for (const recipient of pending) {
    const accountData = accountDataByKey.get(recipient.accountKey) || null;
    const { zones } = resolveRecipientZones({
      phone: recipient.phone,
      accountTimezone: accountData?.timezone ?? null,
    });
    if (isWithinQuietHours(sendInstant, zones)) {
      if (eligible.length < batchSize) eligible.push(recipient);
      continue;
    }
    const heldFor = sendInstant.getTime() - recipient.createdAt.getTime();
    if (heldFor > MAX_DEFERRAL_MS) {
      // Without this cap a row whose window somehow never opens would keep the
      // blast in `processing` and re-swept forever.
      await prisma.smsBlastRecipient.updateMany({
        where: { id: recipient.id, status: 'pending' },
        data: {
          status: 'failed',
          error:
            'Not sent: still inside TCPA quiet hours 48h after being queued. Reschedule this blast.',
        },
      });
      continue;
    }
    const resume = nextPermittedInstant(sendInstant, zones);
    const note = resume
      ? `Holding until ${QUIET_HOURS_START_HOUR}am local (quiet hours) — next attempt ${resume.toISOString()}`
      : 'Holding until local quiet hours end';
    if (recipient.error !== note) {
      await prisma.smsBlastRecipient.updateMany({
        where: { id: recipient.id, status: 'pending' },
        // Stays pending on purpose — this is a hold, not an outcome.
        data: { error: note },
      });
    }
  }

  const campaignMessageOptions = parseCampaignMetadata(campaign.metadata);
  let consecutiveFailures = 0;
  let pausedReason: string | null = null;
  // Recipients brought to an outcome this pass — see processEmailBlastPass.
  let resolved = 0;

  if (eligible.length > 0) {
    const runtimeByAccount = new Map<string, ResolvedMessagingRuntime>();
    const contactById = await loadSmsContacts(eligible);

    // Re-read opt-outs HERE, for every batch. A STOP reply is a legal opt-out;
    // honoring it only as of the moment a blast was scheduled means texting
    // someone who told you to stop three days ago — or ten minutes ago, on a
    // blast that takes an hour to send. Group-wide and format-insensitive (see
    // ./sending/suppression-lookup.ts).
    const suppressedAtSend = await loadSmsSuppressions(
      eligible.map((r) => ({ accountKey: r.accountKey, phone: r.phone })),
    );

    // Polled between sends so a cancel stops the loop rather than only the
    // next sweep. One query per second at most, shared across the tasks.
    const isCanceled = createCancelGate(async () => {
      const row = await prisma.smsBlast.findUnique({
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

    const resolveMessagingRuntime = async (
      accountKey: string,
    ): Promise<ResolvedMessagingRuntime> => {
      const cached = runtimeByAccount.get(accountKey);
      if (cached) return cached;

      // ── Twilio (the only SMS transport) ──
      try {
        const twilio = await resolveTwilioConfig(accountKey);
        if (twilio && (twilio.phoneNumber || twilio.messagingServiceSid)) {
          const resolved: ResolvedMessagingRuntime = {
            kind: 'twilio',
            provider: 'twilio',
            config: twilio,
          };
          runtimeByAccount.set(accountKey, resolved);
          return resolved;
        }
      } catch (err) {
        // Bad ciphertext / decryption failure. Don't silently fall back — the
        // user expects Twilio behavior, surface the error.
        const message = err instanceof Error ? err.message : 'Failed to load Twilio config';
        const failed: ResolvedMessagingRuntime = { kind: 'error', error: `Twilio: ${message}` };
        runtimeByAccount.set(accountKey, failed);
        return failed;
      }

      // No Twilio creds = no SMS. There's no other transport.
      const missingTwilio: ResolvedMessagingRuntime = {
        kind: 'error',
        error: `Twilio is not configured for ${accountKey}. Add credentials in Email & SMS settings.`,
      };
      runtimeByAccount.set(accountKey, missingTwilio);
      return missingTwilio;
    };

    const skip = async (recipientId: string, error: string) => {
      resolved += 1;
      await prisma.smsBlastRecipient.updateMany({
        where: { id: recipientId, status: 'pending' },
        data: { status: 'skipped', error },
      });
    };

    const handleFailure = async (
      recipient: (typeof eligible)[number],
      err: unknown,
    ): Promise<void> => {
      const kind = classifyTwilioFailure(err);
      const message =
        err instanceof TwilioError
          ? `Twilio: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Twilio send failed';

      if (kind === 'optout') {
        // Twilio refused because this handset replied STOP to the sender. That
        // is a legal opt-out whether or not our inbound webhook saw it —
        // record it, group-wide, so no later blast tries again.
        consecutiveFailures = 0;
        await skip(recipient.id, 'Suppressed (opted out at the carrier)');
        if (recipient.phone) {
          await recordSmsOptOut({
            accountKey: recipient.accountKey,
            phone: recipient.phone,
            reason: 'stop',
            source: 'twilio',
          }).catch((err) =>
            console.error(`[sms-blasts] ${campaignId}: could not record a carrier opt-out`, err),
          );
        }
        return;
      }
      if (kind === 'auth') {
        pausedReason ??=
          `Paused: Twilio rejected this account's credentials (${message}). Update them in ` +
          'Settings → Email & Texts; sending resumes on its own.';
        return;
      }
      if (kind === 'retry') {
        consecutiveFailures += 1;
        const attempt = attemptsSoFar(recipient.error) + 1;
        if (attempt >= MAX_ATTEMPTS) resolved += 1;
        await prisma.smsBlastRecipient.updateMany({
          where: { id: recipient.id, status: 'pending' },
          data:
            attempt >= MAX_ATTEMPTS
              ? { status: 'failed', error: `${message} (gave up after ${attempt} attempts)` }
              : { error: temporaryFailureNote(attempt, message) },
        });
      } else if (kind === 'ambiguous') {
        consecutiveFailures += 1;
        resolved += 1;
        await prisma.smsBlastRecipient.updateMany({
          where: { id: recipient.id, status: 'pending' },
          data: {
            status: 'failed',
            error:
              `${message} — Twilio didn't confirm this text, so it may or may not have ` +
              'been sent. It was not retried, to avoid sending it twice.',
          },
        });
      } else {
        consecutiveFailures = 0;
        resolved += 1;
        await prisma.smsBlastRecipient.updateMany({
          where: { id: recipient.id, status: 'pending' },
          data: { status: 'failed', error: message },
        });
      }

      if (consecutiveFailures >= SMS_BREAKER_THRESHOLD) {
        pausedReason ??=
          `Paused: Twilio stopped accepting texts (${message}). ` +
          'The rest of this blast is waiting and will retry on its own.';
      }
    };

    const tasks = eligible.map((recipient) => async () => {
      if (await shouldStop()) return;
      const { id, accountKey } = recipient;

      // ── Opt-out re-checks, as of NOW ──
      // Recorded as `skipped`, not `failed`: nothing went wrong, we
      // deliberately did not send.
      const suppressionReason = recipient.phone
        ? suppressedAtSend(accountKey, recipient.phone)
        : null;
      if (suppressionReason) {
        await skip(id, `Suppressed (${suppressionReason})`);
        return;
      }

      const contact = contactById.get(`${accountKey}|${recipient.contactId}`);
      // Deleted after the blast was scheduled — removed on purpose.
      if (!contact) {
        await skip(id, 'Skipped (contact no longer exists)');
        return;
      }
      // Contact.dnd.sms is a hard, human-set opt-out.
      if (contact.dndSms) {
        await skip(id, 'Suppressed (contact opted out of SMS)');
        return;
      }

      const runtime = await resolveMessagingRuntime(accountKey);
      if (runtime.kind === 'error') {
        // A configuration problem, not this recipient's: failing the whole
        // audience one by one meant re-creating the blast once Twilio was
        // fixed. Pause with everyone still pending instead.
        pausedReason ??= `Paused: ${runtime.error} Sending resumes on its own once this is fixed.`;
        return;
      }
      if (runtime.kind !== 'twilio') return;

      // Missing phone = the row was scheduled before phone hygiene caught the
      // bad value; shouldn't happen, guarded anyway.
      if (!recipient.phone) {
        resolved += 1;
        await prisma.smsBlastRecipient.updateMany({
          where: { id, status: 'pending' },
          data: { status: 'failed', error: 'No phone number on file for this recipient.' },
        });
        return;
      }

      let body: string;
      try {
        // Per-recipient personalization: a {{contact.first_name}} carried over
        // from the email editor used to ship to the handset with its braces.
        const mergeCtx = buildBlastMergetagContext({
          contact,
          account: accountDataByKey.get(accountKey) || null,
          recipientEmail: contact.email ?? null,
          // SMS opts out by replying STOP; there is no unsubscribe URL.
          unsubscribeToken: '',
        });
        // No HTML here — escaping would put &amp; on someone's phone.
        body = applyBlastMergetags(campaign.message, mergeCtx, { escape: false });
      } catch (err) {
        await handleFailure(
          recipient,
          new PreSendError(
            `Couldn't build this text: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        return;
      }

      let sent: { messageSid: string };
      try {
        sent = await sendSmsViaTwilio({
          accountSid: runtime.config.accountSid,
          authToken: runtime.config.authToken,
          from: {
            phoneNumber: runtime.config.phoneNumber,
            messagingServiceSid: runtime.config.messagingServiceSid,
          },
          // E.164, so Twilio never has to guess the country.
          to: normalisePhone(recipient.phone) || recipient.phone,
          body,
          mediaUrls: campaignMessageOptions.mediaUrls,
          // Status callback routes the accountKey through the URL so the
          // webhook handler can resolve the right Auth Token for signature
          // verification.
          statusCallback: buildStatusCallbackUrl(accountKey),
        });
      } catch (err) {
        await handleFailure(recipient, err);
        return;
      }

      consecutiveFailures = 0;
      resolved += 1;
      try {
        await recordSmsSent(id, sent.messageSid);
      } catch (err) {
        console.error(
          `[sms-blasts] ${campaignId}: sent to recipient ${id} but could not record it`,
          err,
        );
        pausedReason ??=
          'Paused: Loomi could not record a sent text (database error). Sending resumes on the next pass.';
      }
    });

    await withConcurrencyLimit(tasks, concurrency);
  }

  const counts = await summarizeCampaign(campaignId);
  const nextStatus = resolveSmsBlastStatus(counts);
  const updated = await updateUnlessCanceled(campaignId, {
    status: nextStatus,
    totalRecipients: counts.total,
    sentCount: counts.sent,
    failedCount: counts.failed,
    undeliveredCount: counts.undelivered,
    completedAt: nextStatus === 'processing' ? null : new Date(),
    error: pausedReason ?? (counts.firstError || null),
  });

  if (updated.status === 'canceled') {
    // Record what this pass's in-flight texts did after the cancel's own
    // count write — counts only, status stays canceled.
    const final = await prisma.smsBlast.update({
      where: { id: campaignId },
      data: {
        totalRecipients: counts.total,
        sentCount: counts.sent,
        failedCount: counts.failed,
        undeliveredCount: counts.undelivered,
      },
      select: smsCampaignSummarySelect,
    });
    return { summary: toSummary(final), progressed: false };
  }

  return {
    summary: toSummary(updated),
    progressed: resolved > 0 && pausedReason === null,
  };
}

/**
 * One SMS sweep: rotate passes across every due blast until the time budget
 * runs out. Same rotation, rounds and isolation as processDueEmailBlasts; a
 * blast whose remaining texts are all inside quiet hours sits out the rest of
 * the tick.
 */
export async function processDueSmsBlasts(options?: {
  limit?: number;
  accountKeys?: string[];
  concurrency?: number;
  timeBudgetMs?: number;
}): Promise<SmsBlastSummary[]> {
  const limit = Math.max(1, Math.min(200, options?.limit ?? 50));
  const deadline = Date.now() + (options?.timeBudgetMs ?? SMS_SWEEP_TIME_BUDGET_MS);
  const allowedAccountKeys = options?.accountKeys && options.accountKeys.length > 0
    ? new Set(options.accountKeys)
    : null;

  const summaries: SmsBlastSummary[] = [];
  const sittingOut = new Set<string>();

  while (Date.now() < deadline && !isSendStopRequested()) {
    const now = new Date();
    const rows = await prisma.smsBlast.findMany({
      where: {
        status: { in: PROCESSABLE_STATUSES },
        archivedAt: null,
        // Never sweep a flow's wrapper shell — see the email equivalent in
        // processDueEmailBlasts. The flow engine owns the send.
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
        const pass = await processSmsBlastPass(row.id, {
          concurrency: options?.concurrency,
          deadline,
        });
        summaries.push(pass.summary);
        if (pass.progressed) progressed = true;
        else sittingOut.add(row.id);
      } catch (err) {
        console.error(`[sms-blasts] ${row.id}: send pass failed`, err);
        sittingOut.add(row.id);
      }
    }
    if (!progressed) break;
  }

  return summaries;
}
