import { prisma } from '@/lib/prisma';
import '@/lib/esp/init';
import { getAdapterForAccount } from '@/lib/esp/registry';
import { withConcurrencyLimit } from '@/lib/esp/utils';
import type { OutboundMessageChannel, MessagesAdapter } from '@/lib/esp/types';
import { providerUnsupportedMessage } from '@/lib/esp/provider-display';
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
  metadata: string;
  createdAt: string;
  updatedAt: string;
  error: string;
}

const PROCESSABLE_STATUSES: SmsCampaignStatus[] = ['queued', 'scheduled', 'processing'];
const TERMINAL_STATUSES: SmsCampaignStatus[] = ['completed', 'partial', 'failed', 'canceled'];

type ResolvedMessagingRuntime =
  | {
      adapter: MessagesAdapter;
      provider: string;
      token: string;
      locationId: string;
    }
  | {
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

  const now = Date.now();
  const isImmediate = !input.scheduledFor || input.scheduledFor.getTime() <= now;
  const status: SmsCampaignStatus = isImmediate ? 'queued' : 'scheduled';

  const updated = await prisma.$transaction(async (tx) => {
    await tx.smsCampaignRecipient.deleteMany({ where: { campaignId } });

    await tx.smsCampaignRecipient.createMany({
      data: recipients.map((r) => ({
        campaignId,
        contactId: r.contactId,
        accountKey: r.accountKey,
        phone: r.phone || null,
        fullName: r.fullName || null,
        status: r.phone ? 'pending' : 'failed',
        error: r.phone ? null : INVALID_PHONE_ERROR,
      })),
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
        select: { id: true, contactId: true, accountKey: true },
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

    try {
      const adapter = await getAdapterForAccount(accountKey);
      if (!adapter.contacts) {
        const unsupported = {
          error: providerUnsupportedMessage(adapter.provider, 'contacts'),
        } satisfies ResolvedMessagingRuntime;
        runtimeByAccount.set(accountKey, unsupported);
        return unsupported;
      }
      if (!adapter.messages) {
        const unsupported = {
          error: providerUnsupportedMessage(adapter.provider, 'direct messaging'),
        } satisfies ResolvedMessagingRuntime;
        runtimeByAccount.set(accountKey, unsupported);
        return unsupported;
      }

      const credentials = await adapter.contacts.resolveCredentials(accountKey);
      if (!credentials) {
        const disconnected = {
          error: `ESP not connected for recipient account (${adapter.provider})`,
        } satisfies ResolvedMessagingRuntime;
        runtimeByAccount.set(accountKey, disconnected);
        return disconnected;
      }

      const resolved = {
        adapter: adapter.messages,
        provider: adapter.provider,
        token: credentials.token,
        locationId: credentials.locationId,
      } satisfies ResolvedMessagingRuntime;
      runtimeByAccount.set(accountKey, resolved);
      return resolved;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resolve messaging provider';
      const failed = { error: message } satisfies ResolvedMessagingRuntime;
      runtimeByAccount.set(accountKey, failed);
      return failed;
    }
  }

  const tasks = campaign.recipients.map((recipient) => async () => {
    const { id, contactId, accountKey } = recipient;

    const runtime = await resolveMessagingRuntime(accountKey);
    if ('error' in runtime) {
      await prisma.smsCampaignRecipient.update({
        where: { id },
        data: {
          status: 'failed',
          error: runtime.error,
        },
      });
      return;
    }

    try {
      const sent = await runtime.adapter.sendMessageToContact({
        token: runtime.token,
        locationId: runtime.locationId,
        contactId,
        message: campaign.message,
        channel: campaignMessageOptions.channel,
        mediaUrls: campaignMessageOptions.mediaUrls,
      });

      await prisma.smsCampaignRecipient.update({
        where: { id },
        data: {
          status: 'sent',
          messageId: sent.id || null,
          conversationId: sent.conversationId || null,
          sentAt: new Date(),
          error: null,
        },
      });
    } catch (err) {
      await prisma.smsCampaignRecipient.update({
        where: { id },
        data: {
          status: 'failed',
          error: err instanceof Error ? err.message : `Failed to send message (${runtime.provider})`,
        },
      });
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
