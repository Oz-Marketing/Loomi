// Execute one audience sync: resolve → gate → diff → push → record.
//
// The diff is the reason membership is stored at all. Platforms want
// add/remove operations, and without a baseline every run would be a
// full re-upload — slow, quota-hungry, and it resets membership dates,
// which changes who the platform considers a current member.
//
// Every run writes an AudienceSyncRun row, including failures and
// skips. A sync that silently stopped running and a sync that ran and
// found nothing to do look identical from the outside otherwise, which
// is the classic silent-pipeline failure this codebase has been bitten
// by before.

import { prisma } from '@/lib/prisma';
import { resolveFilterFields } from '@/lib/services/audience-fields';
import type { FilterDefinition } from '@/lib/smart-list-types';
import { resolveEligibleForSync, type SyncChannel } from '../eligibility';
import { identityDedupeKey } from '../identity';
import { getDestination, type PushOperations } from './destination';

export interface SyncRunResult {
  runId: string;
  status: 'success' | 'failed' | 'skipped';
  added: number;
  removed: number;
  total: number;
  dryRun: boolean;
  skipReason?: string;
  error?: string;
}

/**
 * Read the platform's view of the list and attribute it to the upload it
 * belongs to.
 *
 * Deliberately backward-looking. Customer Match matching runs
 * asynchronously over hours, so asking right after an upload returns the
 * PREVIOUS state and would make every sync look like it matched nothing.
 * Instead this fills in the most recent completed upload that doesn't yet
 * have a match figure — which, on a daily schedule, means each run
 * records yesterday's outcome.
 *
 * Match rate is computed here rather than read: the platform reports how
 * many it matched, and we hold what we sent. Neither number means much
 * alone.
 */
export async function refreshAudienceSyncStatus(
  syncId: string,
): Promise<{ matched: number | null; matchRate: number | null }> {
  const sync = await prisma.audienceSync.findUnique({
    where: { id: syncId },
    include: {
      audience: { select: { name: true } },
      account: { select: { googleAdsCustomerId: true } },
    },
  });
  if (!sync?.externalId) return { matched: null, matchRate: null };

  const destination = getDestination(sync.provider);
  if (!destination) return { matched: null, matchRate: null };

  const pending = await prisma.audienceSyncRun.findFirst({
    where: { syncId, status: 'success', dryRun: false, matched: null },
    orderBy: { startedAt: 'desc' },
    select: { id: true, total: true },
  });
  if (!pending) return { matched: null, matchRate: null };

  try {
    const status = await destination.status({
      accountKey: sync.accountKey,
      externalAccountId: sync.account.googleAdsCustomerId,
      externalId: sync.externalId,
      audienceName: sync.audience.name,
      config: parseConfig(sync.config),
    });
    if (status.size === null) return { matched: null, matchRate: null };

    const matchRate = pending.total > 0 ? status.size / pending.total : null;
    await prisma.audienceSyncRun.update({
      where: { id: pending.id },
      data: { matched: status.size, matchRate },
    });
    return { matched: status.size, matchRate };
  } catch (err) {
    // A status read failing must never fail the sync — it's reporting,
    // not delivery.
    console.error(
      '[audience-sync] status refresh failed',
      syncId,
      err instanceof Error ? err.message : err,
    );
    return { matched: null, matchRate: null };
  }
}

export async function runAudienceSync(syncId: string): Promise<SyncRunResult> {
  const sync = await prisma.audienceSync.findUnique({
    where: { id: syncId },
    include: {
      audience: { select: { id: true, name: true, filters: true } },
      account: { select: { key: true, googleAdsCustomerId: true } },
    },
  });
  if (!sync) throw new Error(`AudienceSync ${syncId} not found`);

  // Attribute the previous upload's match result before starting a new
  // one, while its numbers are still the current state of the list.
  await refreshAudienceSyncStatus(syncId);

  const run = await prisma.audienceSyncRun.create({
    data: { syncId, status: 'running' },
    select: { id: true },
  });

  const finish = async (
    data: Parameters<typeof prisma.audienceSyncRun.update>[0]['data'],
  ) => {
    await prisma.audienceSyncRun.update({
      where: { id: run.id },
      data: { ...data, finishedAt: new Date() },
    });
  };

  try {
    const definition = JSON.parse(sync.audience.filters) as FilterDefinition;
    if (!definition?.groups?.length) {
      // An empty definition means "nobody" under the fail-closed engine.
      // Treating that as a legitimate instruction to empty the remote
      // list would be a very expensive misreading of a half-saved
      // segment, so refuse instead.
      await finish({ status: 'skipped', skipReason: 'segment_has_no_conditions' });
      return { runId: run.id, status: 'skipped', added: 0, removed: 0, total: 0, dryRun: false, skipReason: 'segment_has_no_conditions' };
    }

    const fields = await resolveFilterFields(sync.accountKey);
    const { contacts, breakdown } = await resolveEligibleForSync(
      sync.accountKey,
      definition,
      fields,
      { channel: sync.channel as SyncChannel },
    );

    // ── Diff against the last pushed membership ──
    const existing = await prisma.audienceSyncMember.findMany({
      where: { syncId },
      select: { contactId: true, dedupeKey: true },
    });
    const previous = new Map(existing.map((m) => [m.contactId, m.dedupeKey]));

    const ops: PushOperations = { add: [], remove: [] };
    const nextKeys = new Map<string, string | null>();

    for (const contact of contacts) {
      const key = identityDedupeKey(contact.identifiers);
      nextKeys.set(contact.contactId, key);
      const priorKey = previous.get(contact.contactId);
      // A contact whose identity changed (new email address) is a remove
      // of the old hash plus an add of the new one — the platform has no
      // idea they're the same person.
      if (priorKey === undefined) {
        ops.add.push({ contactId: contact.contactId, identifiers: contact.identifiers });
      } else if (priorKey !== key) {
        ops.remove.push({ contactId: contact.contactId, dedupeKey: priorKey });
        ops.add.push({ contactId: contact.contactId, identifiers: contact.identifiers });
      }
    }
    for (const [contactId, dedupeKey] of previous) {
      if (!nextKeys.has(contactId)) ops.remove.push({ contactId, dedupeKey });
    }

    const excluded = {
      excludedOptedOut: breakdown.excluded.optedOut,
      excludedSuppressed: breakdown.excluded.suppressed,
      excludedNoIdentifier: breakdown.excluded.noIdentifier,
      excludedDuplicate: breakdown.excluded.duplicate,
      excludedNoProvenance: breakdown.excluded.noProvenance,
      // Stored as JSON so a reviewer can see WHICH sources were dropped,
      // not just how many — that's the evidence for deciding whether a
      // given lead vendor should be allowed through.
      excludedSources: breakdown.excludedSources.length
        ? JSON.stringify(breakdown.excludedSources)
        : null,
    };

    if (ops.add.length === 0 && ops.remove.length === 0) {
      // Nothing changed — still record the run, so "ran and found
      // nothing" stays distinguishable from "stopped running".
      await finish({
        status: 'success',
        segmentSize: breakdown.segmentSize,
        eligible: breakdown.eligible,
        added: 0,
        removed: 0,
        total: previous.size,
        ...excluded,
      });
      await prisma.audienceSync.update({
        where: { id: syncId },
        data: { lastRunAt: new Date(), lastSuccessAt: new Date(), lastError: null },
      });
      return { runId: run.id, status: 'success', added: 0, removed: 0, total: previous.size, dryRun: false };
    }

    const destination = getDestination(sync.provider);
    if (!destination) {
      // Configured for a provider whose adapter doesn't exist yet. The
      // delta is real and worth recording; transmitting it isn't
      // possible. Inert, not noisy.
      await finish({
        status: 'skipped',
        skipReason: `no_adapter_for_${sync.provider}`,
        segmentSize: breakdown.segmentSize,
        eligible: breakdown.eligible,
        added: ops.add.length,
        removed: ops.remove.length,
        total: contacts.length,
        dryRun: true,
        ...excluded,
      });
      await prisma.audienceSync.update({
        where: { id: syncId },
        data: { lastRunAt: new Date() },
      });
      return {
        runId: run.id,
        status: 'skipped',
        added: ops.add.length,
        removed: ops.remove.length,
        total: contacts.length,
        dryRun: true,
        skipReason: `no_adapter_for_${sync.provider}`,
      };
    }

    const ctx = {
      accountKey: sync.accountKey,
      externalAccountId: sync.account.googleAdsCustomerId,
      externalId: sync.externalId,
      audienceName: sync.audience.name,
      config: parseConfig(sync.config),
    };
    const externalId = await destination.ensureRemoteList(ctx);
    const result = await destination.push({ ...ctx, externalId }, ops);

    // Only record membership AFTER a successful push. If the upload
    // fails we must not believe those members are live, or the next run
    // would compute a delta against a state the platform never reached
    // and never resend them.
    await persistMembership(syncId, ops, nextKeys);

    await finish({
      status: 'success',
      segmentSize: breakdown.segmentSize,
      eligible: breakdown.eligible,
      added: ops.add.length,
      removed: ops.remove.length,
      total: contacts.length,
      dryRun: result.dryRun,
      ...excluded,
    });
    await prisma.audienceSync.update({
      where: { id: syncId },
      data: {
        externalId: result.externalId ?? externalId,
        lastRunAt: new Date(),
        lastSuccessAt: new Date(),
        lastError: null,
      },
    });

    return {
      runId: run.id,
      status: 'success',
      added: ops.add.length,
      removed: ops.remove.length,
      total: contacts.length,
      dryRun: result.dryRun,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Audience sync failed';
    await finish({ status: 'failed', error: message });
    await prisma.audienceSync.update({
      where: { id: syncId },
      data: { lastRunAt: new Date(), lastError: message, status: 'error' },
    });
    return { runId: run.id, status: 'failed', added: 0, removed: 0, total: 0, dryRun: false, error: message };
  }
}

async function persistMembership(
  syncId: string,
  ops: PushOperations,
  nextKeys: Map<string, string | null>,
): Promise<void> {
  if (ops.remove.length > 0) {
    await prisma.audienceSyncMember.deleteMany({
      where: { syncId, contactId: { in: ops.remove.map((r) => r.contactId) } },
    });
  }
  if (ops.add.length > 0) {
    await prisma.audienceSyncMember.createMany({
      data: ops.add.map((a) => ({
        syncId,
        contactId: a.contactId,
        dedupeKey: nextKeys.get(a.contactId) ?? null,
      })),
      skipDuplicates: true,
    });
  }
}

function parseConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Run every sync due on the daily schedule. Each is isolated: one
 * account's failure (a missing consent basis, a provider outage) must
 * not stop the rest, and it's already recorded on its own run row.
 */
export async function runDueAudienceSyncs(): Promise<{
  processed: number;
  failed: number;
}> {
  const due = await prisma.audienceSync.findMany({
    where: { status: 'active', schedule: 'daily' },
    select: { id: true },
  });

  let failed = 0;
  for (const sync of due) {
    try {
      const result = await runAudienceSync(sync.id);
      if (result.status === 'failed') failed += 1;
    } catch (err) {
      failed += 1;
      console.error(
        '[audience-sync] run threw outside its own error handling',
        sync.id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { processed: due.length, failed };
}
