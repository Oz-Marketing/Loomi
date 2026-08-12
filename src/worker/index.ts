/**
 * Loomi Studio worker process.
 *
 * Runs pg-boss alongside the web server (separate PM2 process) and fires
 * recurring jobs that move scheduled campaigns through their pipeline.
 *
 * Start locally: `npm run worker:start`
 * PM2 in prod:  see ecosystem.config.js
 *
 * `./boot` MUST be the first import: it loads .env / .env.local before
 * ESM resolves the rest of the module graph, which transitively pulls in
 * `src/lib/prisma.ts` whose PrismaClient reads DATABASE_URL at module
 * load time. Re-ordering these imports will silently fall back to the
 * dev DATABASE_URL default and break production sends.
 */
import './boot';

import { getBoss, stopBoss } from '@/lib/queue/boss';
import {
  processDueEmailBlasts,
} from '@/lib/services/email-blasts';
import {
  processDueSmsBlasts,
} from '@/lib/services/sms-blasts';
import {
  processDueFlowEnrollments,
  processFlowTriggers,
  purgeOldArchivedFlows,
} from '@/lib/services/loomi-flows';
import { purgeOldArchivedEmails } from '@/lib/services/account-emails';
import { purgeOldArchivedEmailBlasts } from '@/lib/services/email-blasts';
import { purgeOldArchivedSmsBlasts } from '@/lib/services/sms-blasts';
import {
  DELIVER_CRM_LEAD_QUEUE,
  type DeliverCrmLeadJob,
} from '@/lib/integrations/crm/dispatch';
import { deliverCrmLead } from '@/lib/integrations/crm/deliver';
import { pollAllAccounts } from '@/lib/ad-generator/automation/poll-offers';
import { syncAllInventoryFeeds } from '@/lib/ad-generator/automation/sync-inventory';
import { generateAllAccounts } from '@/lib/ad-generator/automation/generate-ads';
import { expireStaleAds } from '@/lib/ad-generator/automation/expire-ads';
import { sweepMediaExpiration } from '@/lib/services/media-expiration';
import { refreshGuidelineDocs } from '@/lib/ad-generator/guideline-docs';

const PROCESS_DUE_CAMPAIGNS_QUEUE = 'loomi.process-due-campaigns';
const PROCESS_FLOW_ENROLLMENTS_QUEUE = 'loomi.process-flow-enrollments';
const PROCESS_FLOW_TRIGGERS_QUEUE = 'loomi.process-flow-triggers';
// Daily archive-retention purge. Hard-deletes archived rows older
// than 30 days across every model that supports archiving (flows,
// emails). Runs at 02:00 UTC to avoid overlapping with peak send
// windows. Tweak ARCHIVE_RETENTION_DAYS if the global rule changes.
const PURGE_ARCHIVED_QUEUE = 'loomi.purge-archived';
const ARCHIVE_RETENTION_DAYS = 30;
// Ad Generator autonomous generation — PHASE 1, SHADOW MODE. These two jobs
// record state and generate nothing: no creatives, no renders, no notifications.
// They run so we accumulate real offer + inventory history before anything is
// produced unattended.
//
// Inventory syncs first (05:30 UTC), then the offer poll (06:00 UTC) reads the
// stock it just landed to decide what to watch. Both are daily: OEM regional
// programmes change on the order of days, and MarketCheck caches 24h anyway, so
// a tighter cadence would just burn quota.
const ADGEN_SYNC_INVENTORY_QUEUE = 'loomi.adgen.sync-inventory';
const ADGEN_POLL_OFFERS_QUEUE = 'loomi.adgen.poll-offers';
// Phase 3: turn watched offers into DRAFT creatives. Runs after the poll so it
// works from offers landed the same morning. Drafts only — publishing stays a
// human action, and `ready` additionally requires a verified co-op pack.
const ADGEN_GENERATE_QUEUE = 'loomi.adgen.generate';
// Retire ads whose offer has ended. Runs FIRST in the daily chain, before the
// poll and generate steps, so a dead offer's ad is pulled before anything new is
// built on top of it.
const ADGEN_EXPIRE_QUEUE = 'loomi.adgen.expire';
// Re-fetch the co-op guideline documents and compare content hashes. This is the
// whole "keep the rules current" mechanism: it does not re-derive any rule, it
// only detects that a manufacturer reissued a document and tells someone. Runs
// well clear of the generate chain because nothing downstream depends on it.
const ADGEN_GUIDELINES_QUEUE = 'loomi.adgen.guidelines';
// Media asset rights: retire assets past their licence/effective date and warn
// ahead of the ones approaching it. Independent of the ad chain — it governs the
// source material, not the ads built from it — so it runs on its own slot.
const MEDIA_RIGHTS_QUEUE = 'loomi.media.rights-sweep';

async function runProcessDueCampaigns(): Promise<void> {
  const startedAt = Date.now();
  try {
    const emailResults = await processDueEmailBlasts({ limit: 5, concurrency: 3 });
    if (emailResults.length > 0) {
      console.log(
        `[worker] processed ${emailResults.length} email campaign(s) in ${Date.now() - startedAt}ms`,
      );
    }
  } catch (err) {
    console.error('[worker] processDueEmailBlasts failed', err);
  }
  try {
    const smsResults = await processDueSmsBlasts({ limit: 5, concurrency: 3 });
    if (smsResults.length > 0) {
      console.log(
        `[worker] processed ${smsResults.length} sms campaign(s) in ${Date.now() - startedAt}ms`,
      );
    }
  } catch (err) {
    console.error('[worker] processDueSmsBlasts failed', err);
  }
}

async function runProcessFlowEnrollments(): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await processDueFlowEnrollments({ limit: 25 });
    if (result.processed > 0) {
      console.log(
        `[worker] advanced ${result.processed} flow enrollment(s) in ${Date.now() - startedAt}ms`,
      );
    }
  } catch (err) {
    console.error('[worker] processDueFlowEnrollments failed', err);
  }
}

async function runProcessFlowTriggers(): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await processFlowTriggers();
    if (result.enrolled > 0 || result.triggersProcessed > 0) {
      console.log(
        `[worker] flow triggers: ${result.triggersProcessed} polled, ${result.enrolled} new enrollment(s) in ${Date.now() - startedAt}ms`,
      );
    }
  } catch (err) {
    console.error('[worker] processFlowTriggers failed', err);
  }
}

async function runPurgeArchived(): Promise<void> {
  const startedAt = Date.now();
  try {
    const [flowsPurged, emailsPurged, emailCampaignsPurged, smsCampaignsPurged] =
      await Promise.all([
        purgeOldArchivedFlows(ARCHIVE_RETENTION_DAYS),
        purgeOldArchivedEmails(ARCHIVE_RETENTION_DAYS),
        purgeOldArchivedEmailBlasts(ARCHIVE_RETENTION_DAYS),
        purgeOldArchivedSmsBlasts(ARCHIVE_RETENTION_DAYS),
      ]);
    const total =
      flowsPurged + emailsPurged + emailCampaignsPurged + smsCampaignsPurged;
    if (total > 0) {
      console.log(
        `[worker] purged ${flowsPurged} flow(s), ${emailsPurged} email(s), ${emailCampaignsPurged} email campaign(s), ${smsCampaignsPurged} sms campaign(s) older than ${ARCHIVE_RETENTION_DAYS}d in ${Date.now() - startedAt}ms`,
      );
    }
  } catch (err) {
    console.error('[worker] purgeArchived failed', err);
  }
}

async function runAdgenSyncInventory(): Promise<void> {
  const startedAt = Date.now();
  try {
    const { feeds } = await syncAllInventoryFeeds();
    if (feeds.length > 0) {
      const bad = feeds.filter((f) => f.status !== 'ok');
      console.log(
        `[worker] adgen inventory: ${feeds.length} feed(s), ${feeds.reduce((n, f) => n + f.vehicles, 0)} vehicle(s)` +
          `${bad.length ? `, ${bad.length} FAILED: ${bad.map((f) => f.name).join(', ')}` : ''}` +
          ` in ${Date.now() - startedAt}ms`,
      );
    }
  } catch (err) {
    console.error('[worker] adgen syncAllInventoryFeeds failed', err);
  }
}

async function runAdgenPollOffers(): Promise<void> {
  const startedAt = Date.now();
  try {
    const results = await pollAllAccounts();
    if (results.length > 0) {
      const now = results.reduce(
        (acc, r) => ({
          scopes: acc.scopes + r.scopes.length,
          fresh: acc.fresh + r.offersNew,
          ended: acc.ended + r.offersEnded,
        }),
        { scopes: 0, fresh: 0, ended: 0 },
      );
      // Surface the month-boundary state explicitly — "everything expires and
      // nothing new is published" must never read as "no offers exist".
      const unrenewed = results
        .flatMap((r) => r.scopes)
        .filter((s) => s.cycleState === 'expiring_unrenewed').length;
      console.log(
        `[worker] adgen offer poll: ${results.length} account(s), ${now.scopes} scope(s), ` +
          `${now.fresh} new / ${now.ended} ended` +
          `${unrenewed ? `, ${unrenewed} awaiting next OEM cycle` : ''}` +
          ` in ${Date.now() - startedAt}ms`,
      );
    }
  } catch (err) {
    console.error('[worker] adgen pollAllAccounts failed', err);
  }
}

async function runAdgenGenerate(): Promise<void> {
  const startedAt = Date.now();
  try {
    const results = await generateAllAccounts();
    const made = results.reduce((n, r) => n + r.generated.filter((g) => !g.updated).length, 0);
    const refreshed = results.reduce((n, r) => n + r.generated.filter((g) => g.updated).length, 0);
    const skipped = results.reduce((n, r) => n + r.skipped.length, 0);
    if (results.length > 0 && (made || refreshed || skipped)) {
      console.log(
        `[worker] adgen generate: ${made} new draft(s), ${refreshed} refreshed, ${skipped} skipped ` +
          `across ${results.length} account(s) in ${Date.now() - startedAt}ms`,
      );
    }
  } catch (err) {
    console.error('[worker] adgen generateAllAccounts failed', err);
  }
}

async function runAdgenExpire(): Promise<void> {
  const startedAt = Date.now();
  try {
    const r = await expireStaleAds();
    if (r.demoted.length || r.annotated) {
      console.log(
        `[worker] adgen expire: ${r.demoted.length} approved ad(s) DEMOTED to draft, ` +
          `${r.annotated} draft(s) annotated in ${Date.now() - startedAt}ms`,
      );
    }
  } catch (err) {
    console.error('[worker] adgen expireStaleAds failed', err);
  }
}

async function runMediaRightsSweep(): Promise<void> {
  const startedAt = Date.now();
  try {
    const r = await sweepMediaExpiration();
    if (r.expired.length || r.warned.length) {
      console.log(
        `[worker] media rights: ${r.expired.length} asset(s) EXPIRED, ` +
          `${r.warned.length} warned, ${r.scanned} scanned in ${Date.now() - startedAt}ms`,
      );
    }
  } catch (err) {
    console.error('[worker] sweepMediaExpiration failed', err);
  }
}

async function runAdgenGuidelines(): Promise<void> {
  const startedAt = Date.now();
  try {
    const r = await refreshGuidelineDocs();
    // Log failures even when nothing changed: a document that has quietly become
    // unreachable is the case where the register looks healthy and isn't.
    if (r.changed.length || r.failed.length) {
      console.log(
        `[worker] adgen guidelines: ${r.checked} checked, ${r.changed.length} CHANGED` +
          `${r.changed.length ? ` (${r.changed.join('; ')})` : ''}, ` +
          `${r.failed.length} unreachable${r.failed.length ? ` (${r.failed.join('; ')})` : ''} ` +
          `in ${Date.now() - startedAt}ms`,
      );
    }
  } catch (err) {
    console.error('[worker] adgen refreshGuidelineDocs failed', err);
  }
}

async function main(): Promise<void> {
  const boss = await getBoss();
  console.log('[worker] pg-boss started');

  await boss.createQueue(PROCESS_DUE_CAMPAIGNS_QUEUE);
  await boss.work(PROCESS_DUE_CAMPAIGNS_QUEUE, async () => {
    await runProcessDueCampaigns();
  });

  await boss.createQueue(PROCESS_FLOW_ENROLLMENTS_QUEUE);
  await boss.work(PROCESS_FLOW_ENROLLMENTS_QUEUE, async () => {
    await runProcessFlowEnrollments();
  });

  await boss.createQueue(PROCESS_FLOW_TRIGGERS_QUEUE);
  await boss.work(PROCESS_FLOW_TRIGGERS_QUEUE, async () => {
    await runProcessFlowTriggers();
  });

  await boss.createQueue(PURGE_ARCHIVED_QUEUE);
  await boss.work(PURGE_ARCHIVED_QUEUE, async () => {
    await runPurgeArchived();
  });

  await boss.createQueue(ADGEN_SYNC_INVENTORY_QUEUE);
  await boss.work(ADGEN_SYNC_INVENTORY_QUEUE, async () => {
    await runAdgenSyncInventory();
  });

  await boss.createQueue(ADGEN_POLL_OFFERS_QUEUE);
  await boss.work(ADGEN_POLL_OFFERS_QUEUE, async () => {
    await runAdgenPollOffers();
  });

  await boss.createQueue(ADGEN_GENERATE_QUEUE);
  await boss.work(ADGEN_GENERATE_QUEUE, async () => {
    await runAdgenGenerate();
  });

  await boss.createQueue(ADGEN_EXPIRE_QUEUE);
  await boss.work(ADGEN_EXPIRE_QUEUE, async () => {
    await runAdgenExpire();
  });

  await boss.work(MEDIA_RIGHTS_QUEUE, async () => {
    await runMediaRightsSweep();
  });

  await boss.createQueue(ADGEN_GUIDELINES_QUEUE);
  await boss.work(ADGEN_GUIDELINES_QUEUE, async () => {
    await runAdgenGuidelines();
  });

  // Form → CRM lead delivery (ADF email). Event-driven (no schedule):
  // submitForm enqueues one job per enabled destination. Retries/backoff
  // are carried on the job itself (see dispatch.ts), so a failing mail
  // provider reschedules without blocking the submit path.
  await boss.createQueue(DELIVER_CRM_LEAD_QUEUE);
  // Assumes the default batchSize of 1 (one job per invocation): deliverCrmLead
  // THROWS on a transient failure so pg-boss retries that job. If batchSize is
  // ever raised, a throw here fails the WHOLE batch (pg-boss fails all jobIds),
  // re-running already-sent jobs — so batching would need per-job error
  // isolation that still surfaces a retry signal, not a blanket try/catch
  // (which would swallow the throw and silently kill retries).
  await boss.work<DeliverCrmLeadJob>(
    DELIVER_CRM_LEAD_QUEUE,
    async (jobs) => {
      for (const job of jobs) {
        await deliverCrmLead(job.data.deliveryId);
      }
    },
  );

  // Recurring schedule: every minute. pg-boss is idempotent on schedule
  // creation, so this is safe to call on every boot.
  await boss.schedule(PROCESS_DUE_CAMPAIGNS_QUEUE, '* * * * *');
  console.log('[worker] scheduled', PROCESS_DUE_CAMPAIGNS_QUEUE, 'every minute');

  // Flow enrollments tick every minute (matches the wait-node minimum
  // resolution); trigger polling every 5 minutes since list/audience
  // membership changes are coarse and we don't want to thrash the DB.
  await boss.schedule(PROCESS_FLOW_ENROLLMENTS_QUEUE, '* * * * *');
  console.log('[worker] scheduled', PROCESS_FLOW_ENROLLMENTS_QUEUE, 'every minute');

  await boss.schedule(PROCESS_FLOW_TRIGGERS_QUEUE, '*/5 * * * *');
  console.log('[worker] scheduled', PROCESS_FLOW_TRIGGERS_QUEUE, 'every 5 minutes');

  // Archive retention sweep — runs daily at 02:00 UTC. Hard-deletes
  // rows archived more than ARCHIVE_RETENTION_DAYS ago across every
  // model that supports archiving.
  await boss.schedule(PURGE_ARCHIVED_QUEUE, '0 2 * * *');
  console.log('[worker] scheduled', PURGE_ARCHIVED_QUEUE, 'daily at 02:00 UTC');

  // 05:00 — first in the daily chain, so an ad for a dead offer is pulled before
  // the day's new work is built.
  await boss.schedule(ADGEN_EXPIRE_QUEUE, '0 5 * * *');
  console.log('[worker] scheduled', ADGEN_EXPIRE_QUEUE, 'daily at 05:00 UTC');

  // Shadow mode: inventory first so the offer poll can read fresh stock to
  // decide what to watch. Neither job produces an ad.
  await boss.schedule(ADGEN_SYNC_INVENTORY_QUEUE, '30 5 * * *');
  console.log('[worker] scheduled', ADGEN_SYNC_INVENTORY_QUEUE, 'daily at 05:30 UTC');

  await boss.schedule(ADGEN_POLL_OFFERS_QUEUE, '0 6 * * *');
  console.log('[worker] scheduled', ADGEN_POLL_OFFERS_QUEUE, 'daily at 06:00 UTC');

  // 06:30 — half an hour after the poll, so a programme published overnight
  // becomes a draft the same morning. Rendering is the expensive step, hence the
  // gap rather than chaining directly.
  await boss.schedule(ADGEN_GENERATE_QUEUE, '30 6 * * *');
  console.log('[worker] scheduled', ADGEN_GENERATE_QUEUE, 'daily at 06:30 UTC');

  // 07:00 — deliberately AFTER generation rather than before. A guideline that
  // changed overnight needs a human to interpret it, so blocking the morning's
  // drafts on it would trade a small compliance risk for a guaranteed outage.
  // The alert lands while the drafts are still unapproved, which is the window
  // that matters.
  await boss.schedule(ADGEN_GUIDELINES_QUEUE, '0 7 * * *');
  console.log('[worker] scheduled', ADGEN_GUIDELINES_QUEUE, 'daily at 07:00 UTC');

  // 07:30 UTC — clear of the ad chain. Nothing downstream depends on it, and a
  // rights warning is a planning signal rather than something that has to land
  // before the day's generation runs.
  await boss.schedule(MEDIA_RIGHTS_QUEUE, '30 7 * * *');
  console.log('[worker] scheduled', MEDIA_RIGHTS_QUEUE, 'daily at 07:30 UTC');

  // Also run once immediately so the first send doesn't have to wait up
  // to a minute after boot.
  await runProcessDueCampaigns();
  await runProcessFlowTriggers();
  await runProcessFlowEnrollments();

  const shutdown = async (signal: string) => {
    console.log(`[worker] received ${signal}, shutting down`);
    try {
      await stopBoss();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[worker] fatal', err);
  process.exit(1);
});
