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
  processDueEmailCampaigns,
} from '@/lib/services/email-campaigns';
import {
  processDueSmsCampaigns,
} from '@/lib/services/sms-campaigns';
import {
  processDueFlowEnrollments,
  processFlowTriggers,
  purgeOldArchivedFlows,
} from '@/lib/services/loomi-flows';
import { purgeOldArchivedEmails } from '@/lib/services/account-emails';
import { purgeOldArchivedEmailCampaigns } from '@/lib/services/email-campaigns';
import { purgeOldArchivedSmsCampaigns } from '@/lib/services/sms-campaigns';
import {
  DELIVER_CRM_LEAD_QUEUE,
  type DeliverCrmLeadJob,
} from '@/lib/integrations/crm/dispatch';
import { deliverCrmLead } from '@/lib/integrations/crm/deliver';

const PROCESS_DUE_CAMPAIGNS_QUEUE = 'loomi.process-due-campaigns';
const PROCESS_FLOW_ENROLLMENTS_QUEUE = 'loomi.process-flow-enrollments';
const PROCESS_FLOW_TRIGGERS_QUEUE = 'loomi.process-flow-triggers';
// Daily archive-retention purge. Hard-deletes archived rows older
// than 30 days across every model that supports archiving (flows,
// emails). Runs at 02:00 UTC to avoid overlapping with peak send
// windows. Tweak ARCHIVE_RETENTION_DAYS if the global rule changes.
const PURGE_ARCHIVED_QUEUE = 'loomi.purge-archived';
const ARCHIVE_RETENTION_DAYS = 30;

async function runProcessDueCampaigns(): Promise<void> {
  const startedAt = Date.now();
  try {
    const emailResults = await processDueEmailCampaigns({ limit: 5, concurrency: 3 });
    if (emailResults.length > 0) {
      console.log(
        `[worker] processed ${emailResults.length} email campaign(s) in ${Date.now() - startedAt}ms`,
      );
    }
  } catch (err) {
    console.error('[worker] processDueEmailCampaigns failed', err);
  }
  try {
    const smsResults = await processDueSmsCampaigns({ limit: 5, concurrency: 3 });
    if (smsResults.length > 0) {
      console.log(
        `[worker] processed ${smsResults.length} sms campaign(s) in ${Date.now() - startedAt}ms`,
      );
    }
  } catch (err) {
    console.error('[worker] processDueSmsCampaigns failed', err);
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
        purgeOldArchivedEmailCampaigns(ARCHIVE_RETENTION_DAYS),
        purgeOldArchivedSmsCampaigns(ARCHIVE_RETENTION_DAYS),
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
