import { prisma } from '@/lib/prisma';
import { getBoss } from '@/lib/queue/boss';
import { createNotification } from '@/lib/notifications/service';
import type { TemplateDoc } from './doc-types';
import {
  applyTemplateDocToCreatives,
  summarizeApplyResults,
  type ApplyResult,
  type ApplyTally,
} from './template-sync-apply';

/**
 * Template → ad design sync, as a background job.
 *
 * ── Why this is not an HTTP request ──
 *
 * It used to be, and it returned 504. Production nginx sets no
 * `proxy_read_timeout`, so an upstream request is cut off at its 60-second
 * default, and one apply is far past that: a 9-size template used by 214 ads is
 * 214 Chromium renders plus 214 uploads, each render waiting on a remote vehicle
 * photo. The old route declared `maxDuration = 300` and the dialog chunked
 * itself into 10-ad requests to "stay inside the timeout", but `maxDuration` is
 * a Vercel setting with no effect on the droplet and the real ceiling was never
 * 300 seconds. No batch size fixes that, because the work per ad already
 * exceeded the budget.
 *
 * So the route now creates an `AdTemplateSyncRun` and returns its id, and this
 * runs on the worker where nothing is watching a clock. The row carries progress
 * for the dialog to poll and the outcome for whoever comes back later.
 */

export const ADGEN_TEMPLATE_SYNC_QUEUE = 'loomi.adgen.template-sync';

export interface TemplateSyncJob {
  runId: string;
}

// One idempotent createQueue per process, as with the CRM delivery queue. The
// worker creates this queue too (and MUST — see queue-registration.test.ts);
// this covers the web process enqueueing before the worker has ever booted.
let queueEnsured = false;

async function ensureQueue(): Promise<void> {
  if (queueEnsured) return;
  const boss = await getBoss();
  await boss.createQueue(ADGEN_TEMPLATE_SYNC_QUEUE);
  queueEnsured = true;
}

/**
 * Hand a created run to the worker.
 *
 * Throws on failure so the caller can mark the run failed rather than leaving a
 * `queued` row with no backing job — a run nobody will ever pick up looks
 * identical to a slow one from the dialog's side.
 */
export async function enqueueTemplateSyncJob(runId: string): Promise<void> {
  await ensureQueue();
  const boss = await getBoss();
  const job: TemplateSyncJob = { runId };
  await boss.send(ADGEN_TEMPLATE_SYNC_QUEUE, job, {
    // No retry. A re-run would redo every ad that already took the change, and
    // applying is idempotent per ad but the notification and the counters are
    // not — a retried run would double-report. Individual ad failures are
    // already carried per ad in `results`, which is the level a person acts on.
    retryLimit: 0,
    // Generous: this is minutes of work by design. pg-boss expires a job that
    // outlives this so a killed worker doesn't leave the run `running` forever.
    expireInSeconds: 3600,
  });
}

function safeJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Run one sync to completion, keeping the row current as it goes.
 *
 * The doc comes from the RUN, never re-read from `AdTemplateDoc`. The builder
 * autosaves every 1.2 seconds, so by the time the worker starts the template row
 * may already hold edits made after the person approved this push — writing
 * those into their ads would be applying a design nobody said yes to.
 */
export async function runTemplateSyncJob(runId: string): Promise<void> {
  const run = await prisma.adTemplateSyncRun.findUnique({ where: { id: runId } });
  if (!run) {
    console.warn(`[template-sync-job] run ${runId} not found`);
    return;
  }
  if (run.status !== 'queued') {
    // Already handled. Since jobs don't retry this means a duplicate enqueue,
    // and re-running would re-render every ad for nothing.
    console.warn(`[template-sync-job] run ${runId} is already ${run.status}; skipping`);
    return;
  }

  const ids = safeJson<string[]>(run.creativeIds) ?? [];
  const doc = safeJson<TemplateDoc>(run.doc);
  if (!doc || !Array.isArray(doc.sizes) || !Array.isArray(doc.elements) || !doc.layouts) {
    await prisma.adTemplateSyncRun.update({
      where: { id: runId },
      data: { status: 'failed', error: 'The saved design could not be read.', finishedAt: new Date() },
    });
    return;
  }

  await prisma.adTemplateSyncRun.update({
    where: { id: runId },
    data: { status: 'running', total: ids.length },
  });

  const results: ApplyResult[] = [];
  try {
    await applyTemplateDocToCreatives(ids, doc, {
      // Written after every ad rather than in blocks, because the whole point of
      // the row is that the dialog can show real movement instead of a spinner.
      // One small UPDATE per ad against hundreds of milliseconds of Chromium is
      // not the expensive part of this loop.
      onResult: async (result) => {
        results.push(result);
        const tally = summarizeApplyResults(results);
        await prisma.adTemplateSyncRun.update({
          where: { id: runId },
          data: {
            processed: results.length,
            updated: tally.updated,
            blocked: tally.blocked,
            failedAds: tally.failed,
            skipped: tally.skipped,
            results: JSON.stringify(results),
          },
        });
      },
    });
  } catch (err) {
    // The per-ad path already reports its own failures, so reaching here means
    // the run itself broke. Keep whatever landed: a partial run is still worth
    // reading, and the ads that missed out can be pulled up individually.
    await prisma.adTemplateSyncRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
        results: JSON.stringify(results),
        finishedAt: new Date(),
      },
    });
    throw err;
  }

  const tally = summarizeApplyResults(results);
  await prisma.adTemplateSyncRun.update({
    where: { id: runId },
    data: { status: 'done', finishedAt: new Date() },
  });

  await notifyFinished(run.startedByUserId, run.templateId, tally);
}

/**
 * Tell the person who started it that it finished.
 *
 * They can close the dialog, and for a 200-ad run they should be able to — so
 * without this the outcome is only visible to whoever happens to still have the
 * tab open. Best-effort: a notification failure must not fail a completed run.
 */
async function notifyFinished(
  userId: string | null,
  templateId: string,
  tally: ApplyTally,
): Promise<void> {
  if (!userId) return;
  const kept = tally.blocked + tally.failed;
  try {
    await createNotification({
      userId,
      type: 'template_sync_finished',
      severity: kept > 0 ? 'warning' : 'info',
      title: `${tally.updated} ad(s) updated from your template change`,
      body:
        kept > 0
          ? `${kept} ad(s) kept their current design and need a look.`
          : 'Every ad that follows the template took the change.',
      link: `/ad-generator/builder?template=${encodeURIComponent(templateId)}`,
      meta: { templateId, ...tally },
    });
  } catch (err) {
    console.warn('[template-sync-job] completion notification failed:', err);
  }
}
