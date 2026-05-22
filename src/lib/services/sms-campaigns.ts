import { prisma } from '@/lib/prisma';
import {
  resolveTwilioConfig,
  sendSmsViaTwilio,
  TwilioError,
  type TwilioConfig,
} from '@/lib/sending/twilio';

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

type SmsCampaignStatus =
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

export interface CreateSmsCampaignInput {
  name?: string;
  message: string;
  channel?: OutboundMessageChannel;
  mediaUrls?: string[];
  recipients: SmsRecipientInput[];
  scheduledFor?: string | null;
  createdByUserId?: string;
  createdByRole?: string;
  sourceAudienceId?: string | null;
  sourceFilter?: string | null;
  metadata?: string | null;
}

export interface SmsCampaignSummary {
  id: string;
  name: string;
  message: string;
  status: SmsCampaignStatus;
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
  metadata: string;
  createdAt: string;
  updatedAt: string;
  error: string;
}

const PROCESSABLE_STATUSES: SmsCampaignStatus[] = ['queued', 'scheduled', 'processing'];
const TERMINAL_STATUSES: SmsCampaignStatus[] = ['completed', 'partial', 'failed', 'canceled'];

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

  const seenPhones = new Set<string>();
  const deduped: SmsRecipientInput[] = [];
  for (const recipient of byContactKey.values()) {
    if (!recipient.phone) {
      deduped.push(recipient);
      continue;
    }
    if (seenPhones.has(recipient.phone)) continue;
    seenPhones.add(recipient.phone);
    deduped.push(recipient);
  }
  return deduped;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function sanitizeMessage(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
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

function buildCampaignMetadata(input: CreateSmsCampaignInput): string | null {
  const payload = {
    channel: normalizeChannel(input.channel),
    mediaUrls: normalizeMediaUrls(input.mediaUrls),
    sourceMetadata: input.metadata || '',
  };
  return JSON.stringify(payload);
}

function parseCampaignMetadata(raw: string | null | undefined): {
  channel: OutboundMessageChannel;
  mediaUrls: string[];
} {
  if (!raw) {
    return { channel: 'SMS', mediaUrls: [] };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      channel: normalizeChannel(parsed.channel),
      mediaUrls: normalizeMediaUrls(parsed.mediaUrls),
    };
  } catch {
    return { channel: 'SMS', mediaUrls: [] };
  }
}

function toSummary(row: {
  id: string;
  name: string | null;
  message: string;
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
  metadata: string | null;
  createdAt: Date;
  updatedAt: Date;
  error: string | null;
}): SmsCampaignSummary {
  return {
    id: row.id,
    name: row.name || '',
    message: row.message,
    status: row.status as SmsCampaignStatus,
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
    metadata: row.metadata || '',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    error: row.error || '',
  };
}

const smsCampaignSummarySelect = {
  id: true,
  name: true,
  message: true,
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

/** Creates an empty SmsCampaign in 'draft' status for the builder flow. */
export async function createDraftSmsCampaign(input: {
  name?: string;
  accountKeys?: string[];
  createdByUserId?: string;
  createdByRole?: string;
}): Promise<SmsCampaignSummary> {
  const name = (input.name || '').trim() || defaultDraftName(new Date());
  const created = await prisma.smsCampaign.create({
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
export async function updateSmsCampaignDraft(
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
    status?: SmsCampaignStatus;
    metadata?: string | null;
  },
): Promise<SmsCampaignSummary> {
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

  const updated = await prisma.smsCampaign.update({
    where: { id: campaignId },
    data,
    select: smsCampaignSummarySelect,
  });
  return toSummary(updated);
}

const INVALID_PHONE_ERROR = 'Recipient phone is missing or blocked by hygiene policy';

/**
 * Transitions an SMS draft into 'scheduled' or 'queued' and persists
 * recipient rows. The pg-boss worker picks it up once scheduledFor passes.
 */
export async function scheduleSmsCampaignDraft(
  campaignId: string,
  input: {
    recipients: SmsRecipientInput[];
    scheduledFor: Date | null;
  },
): Promise<SmsCampaignSummary> {
  // Dedupe on (contactId, accountKey)
  const seen = new Set<string>();
  const recipients: SmsRecipientInput[] = [];
  for (const r of input.recipients || []) {
    const key = `${r.contactId}::${r.accountKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push(r);
  }
  if (recipients.length === 0) throw new Error('At least one recipient is required');
  const sendable = recipients.filter((r) => Boolean(r.phone));
  if (sendable.length === 0) {
    throw new Error('No recipients with valid phone numbers were provided');
  }

  // ── Suppression filter ──
  // Phones that opted out via STOP (or were manually suppressed) land
  // in SmsSuppression. We drop them into status='skipped' rather than
  // silently filtering, so the audit log shows why nothing got sent.
  const accountKeysInBatch = [
    ...new Set(sendable.map((r) => r.accountKey).filter(Boolean)),
  ];
  const phonesInBatch = [
    ...new Set(sendable.map((r) => (r.phone || '').trim()).filter(Boolean)),
  ];
  const suppressed =
    accountKeysInBatch.length > 0 && phonesInBatch.length > 0
      ? await prisma.smsSuppression.findMany({
          where: {
            accountKey: { in: accountKeysInBatch },
            phone: { in: phonesInBatch },
          },
          select: { accountKey: true, phone: true, reason: true },
        })
      : [];
  const suppressionKey = (accountKey: string, phone: string) =>
    `${accountKey}|${phone.trim()}`;
  const suppressedByKey = new Map(
    suppressed.map((s) => [suppressionKey(s.accountKey, s.phone), s.reason]),
  );

  const now = Date.now();
  const isImmediate = !input.scheduledFor || input.scheduledFor.getTime() <= now;
  const status: SmsCampaignStatus = isImmediate ? 'queued' : 'scheduled';

  const updated = await prisma.$transaction(async (tx) => {
    await tx.smsCampaignRecipient.deleteMany({ where: { campaignId } });

    await tx.smsCampaignRecipient.createMany({
      data: recipients.map((r) => {
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
        const reason = suppressedByKey.get(suppressionKey(r.accountKey, r.phone));
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
      }),
    });

    const accountKeys = [...new Set(recipients.map((r) => r.accountKey).filter(Boolean))];

    return tx.smsCampaign.update({
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
      select: smsCampaignSummarySelect,
    });
  });

  return toSummary(updated);
}

export async function createSmsCampaign(input: CreateSmsCampaignInput): Promise<SmsCampaignSummary> {
  const message = sanitizeMessage(input.message || '');
  const channel = normalizeChannel(input.channel);
  const mediaUrls = normalizeMediaUrls(input.mediaUrls);
  if (!message && mediaUrls.length === 0) throw new Error('Message or media URLs are required');
  if (message.length > 640) throw new Error(`${channel} must be 640 characters or fewer`);

  const recipients = dedupeRecipients(input.recipients || []);
  if (recipients.length === 0) throw new Error('At least one recipient is required');

  const scheduledDate = parseDate(input.scheduledFor || undefined);
  const now = Date.now();
  const status: SmsCampaignStatus =
    scheduledDate && scheduledDate.getTime() > now
      ? 'scheduled'
      : 'queued';
  const accountKeys = [...new Set(recipients.map((recipient) => recipient.accountKey))];

  const created = await prisma.$transaction(async (tx) => {
    const campaign = await tx.smsCampaign.create({
      data: {
        name: input.name?.trim() || null,
        message,
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

    await tx.smsCampaignRecipient.createMany({
      data: recipients.map((recipient) => ({
        campaignId: campaign.id,
        contactId: recipient.contactId,
        accountKey: recipient.accountKey,
        phone: recipient.phone || null,
        fullName: recipient.fullName || null,
      })),
    });

    return campaign;
  });

  return toSummary(created);
}

export async function getSmsCampaign(campaignId: string): Promise<SmsCampaignSummary | null> {
  const row = await prisma.smsCampaign.findUnique({
    where: { id: campaignId },
    select: smsCampaignSummarySelect,
  });
  return row ? toSummary(row) : null;
}

/**
 * Delete an SMS campaign + its recipient rows. Blocked while in-flight
 * (queued/processing) so we don't yank the row out from under the worker.
 */
export async function deleteSmsCampaign(campaignId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.smsCampaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    if (!row) return;
    if (row.status === 'queued' || row.status === 'processing') {
      throw new Error('Cannot delete a campaign that is currently sending.');
    }
    await tx.smsCampaignRecipient.deleteMany({ where: { campaignId } });
    await tx.smsCampaign.delete({ where: { id: campaignId } });
  });
}

/**
 * Toggle archive flag on an SMS campaign. Stored as
 * `metadata.archived = true` (no Prisma migration needed). List endpoint
 * filters archived rows out by default. In-flight campaigns can't be
 * archived.
 */
export async function setSmsCampaignArchived(
  campaignId: string,
  archived: boolean,
): Promise<SmsCampaignSummary> {
  const existing = await prisma.smsCampaign.findUnique({
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
  const updated = await prisma.smsCampaign.update({
    where: { id: campaignId },
    data: { metadata: JSON.stringify(meta) },
    select: smsCampaignSummarySelect,
  });
  return toSummary(updated);
}

/**
 * Clone an SMS campaign into a new draft. Status resets, recipient rows
 * are not copied — the user re-picks an audience in the Recipients step.
 */
export async function duplicateSmsCampaign(
  campaignId: string,
  options?: { createdByUserId?: string; createdByRole?: string },
): Promise<SmsCampaignSummary> {
  const source = await prisma.smsCampaign.findUnique({
    where: { id: campaignId },
    select: smsCampaignSummarySelect,
  });
  if (!source) {
    throw new Error('Source campaign not found');
  }

  const created = await prisma.smsCampaign.create({
    data: {
      name: source.name ? `${source.name} (Copy)` : defaultDraftName(new Date()),
      message: source.message || '',
      status: 'draft',
      accountKeys: source.accountKeys || JSON.stringify([]),
      sourceAudienceId: source.sourceAudienceId || null,
      sourceFilter: source.sourceFilter || null,
      sourceContactIds: source.sourceContactIds || null,
      metadata: source.metadata || null,
      createdByUserId: options?.createdByUserId || null,
      createdByRole: options?.createdByRole || null,
    },
    select: smsCampaignSummarySelect,
  });
  return toSummary(created);
}

export async function listSmsCampaigns(options?: {
  limit?: number;
  accountKeys?: string[];
}): Promise<SmsCampaignSummary[]> {
  const limit = Math.max(1, Math.min(100, options?.limit ?? 25));
  const rows = await prisma.smsCampaign.findMany({
    select: smsCampaignSummarySelect,
    orderBy: { createdAt: 'desc' },
    take: limit * 4,
  });

  const allowedAccountKeys = options?.accountKeys && options.accountKeys.length > 0
    ? new Set(options.accountKeys)
    : null;

  const summaries = rows
    .filter((row) => {
      if (!allowedAccountKeys) return true;
      const keys = parseAccountKeys(row.accountKeys);
      return keys.some((key) => allowedAccountKeys.has(key));
    })
    .slice(0, limit)
    .map(toSummary);

  return summaries;
}

async function summarizeCampaign(campaignId: string) {
  const recipients = await prisma.smsCampaignRecipient.findMany({
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

export async function processSmsCampaign(
  campaignId: string,
  options?: { concurrency?: number },
): Promise<SmsCampaignSummary> {
  const concurrency = Math.max(1, Math.min(8, options?.concurrency ?? 4));
  const campaign = await prisma.smsCampaign.findUnique({
    where: { id: campaignId },
    include: {
      recipients: {
        where: { status: 'pending' },
        select: { id: true, contactId: true, accountKey: true, phone: true },
      },
    },
  });

  if (!campaign) throw new Error('SMS campaign not found');
  if (TERMINAL_STATUSES.includes(campaign.status as SmsCampaignStatus)) {
    return toSummary(campaign);
  }
  if (campaign.recipients.length === 0) {
    const counts = await summarizeCampaign(campaign.id);
    const status: SmsCampaignStatus =
      counts.sent > 0 && counts.failed > 0
        ? 'partial'
        : counts.sent > 0
          ? 'completed'
          : counts.failed > 0
            ? 'failed'
            : 'queued';
    const updated = await prisma.smsCampaign.update({
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

  await prisma.smsCampaign.update({
    where: { id: campaign.id },
    data: {
      status: 'processing',
      startedAt: campaign.startedAt || new Date(),
      completedAt: null,
      error: null,
    },
  });

  const campaignMessageOptions = parseCampaignMetadata(campaign.metadata);
  const runtimeByAccount = new Map<string, ResolvedMessagingRuntime>();

  async function resolveMessagingRuntime(accountKey: string): Promise<ResolvedMessagingRuntime> {
    const cached = runtimeByAccount.get(accountKey);
    if (cached) return cached;

    // ── Twilio (the only SMS transport) ──
    // We send through the sub-account's Twilio creds directly for
    // proper deliverability, A2P 10DLC compliance, and status
    // callbacks via webhook.
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
      // Bad ciphertext / decryption failure. Don't silently fall back
      // — the user expects Twilio behaviour, surface the error.
      const message = err instanceof Error ? err.message : 'Failed to load Twilio config';
      const failed: ResolvedMessagingRuntime = {
        kind: 'error',
        error: `Twilio: ${message}`,
      };
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
  }

  const tasks = campaign.recipients.map((recipient) => async () => {
    const { id, accountKey } = recipient;

    const runtime = await resolveMessagingRuntime(accountKey);
    if (runtime.kind === 'error') {
      await prisma.smsCampaignRecipient.update({
        where: { id },
        data: { status: 'failed', error: runtime.error },
      });
      return;
    }

    // Twilio path: needs the recipient's phone (already persisted on
    // the row at schedule time). Missing phone = recipient was scheduled
    // before phone hygiene caught the bad value, which shouldn't happen
    // but we guard anyway.
    if (runtime.kind === 'twilio') {
      if (!recipient.phone) {
        await prisma.smsCampaignRecipient.update({
          where: { id },
          data: { status: 'failed', error: 'No phone number on file for this recipient.' },
        });
        return;
      }
      try {
        const sent = await sendSmsViaTwilio({
          accountSid: runtime.config.accountSid,
          authToken: runtime.config.authToken,
          from: {
            phoneNumber: runtime.config.phoneNumber,
            messagingServiceSid: runtime.config.messagingServiceSid,
          },
          to: recipient.phone,
          body: campaign.message,
          mediaUrls: campaignMessageOptions.mediaUrls,
          // Status callback routes the accountKey through the URL so the
          // webhook handler can resolve the right per-sub-account Auth
          // Token for signature verification.
          statusCallback: buildStatusCallbackUrl(accountKey),
        });
        await prisma.smsCampaignRecipient.update({
          where: { id },
          data: {
            status: 'sent',
            messageId: sent.messageSid,
            sentAt: new Date(),
            error: null,
          },
        });
      } catch (err) {
        const errorMessage =
          err instanceof TwilioError
            ? `Twilio: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Twilio send failed';
        await prisma.smsCampaignRecipient.update({
          where: { id },
          data: { status: 'failed', error: errorMessage },
        });
      }
      return;
    }

  });

  await withConcurrencyLimit(tasks, concurrency);

  const counts = await summarizeCampaign(campaign.id);
  const nextStatus: SmsCampaignStatus =
    counts.pending > 0
      ? 'processing'
      : counts.sent > 0 && counts.failed > 0
        ? 'partial'
        : counts.sent > 0
          ? 'completed'
          : counts.failed > 0
            ? 'failed'
            : 'queued';

  const updated = await prisma.smsCampaign.update({
    where: { id: campaign.id },
    data: {
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

export async function processDueSmsCampaigns(options?: {
  limit?: number;
  accountKeys?: string[];
  concurrency?: number;
}): Promise<SmsCampaignSummary[]> {
  const limit = Math.max(1, Math.min(20, options?.limit ?? 5));
  const now = new Date();

  const rows = await prisma.smsCampaign.findMany({
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

  const summaries: SmsCampaignSummary[] = [];
  for (const row of queue) {
    const summary = await processSmsCampaign(row.id, { concurrency: options?.concurrency });
    summaries.push(summary);
  }

  return summaries;
}
