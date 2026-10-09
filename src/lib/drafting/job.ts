import { prisma } from '@/lib/prisma';
import { getBoss } from '@/lib/queue/boss';
import { MondayError } from '@/lib/monday/client';
import { copyDesignAssets, imageType, sameCreative, type DraftAsset } from './assets';
import { getDeliverable, type Deliverable } from './monday-board';

/**
 * The drafting job: one DraftRequest, carried as far as the pipeline goes.
 *
 * A worker job, not a request handler: reading the creative and drafting take
 * longer than nginx's 60-second cut, the reason template sync moved to the
 * worker. The route creates (or re-queues) the request and returns; this runs
 * the stages and keeps the row current, so the queue page can show progress and
 * whoever comes back later can see what happened.
 *
 * Stages built so far: FETCH — read the deliverable and its request from monday,
 * check it's still approved, and copy the creative into Loomi. A request then
 * rests at `awaiting_extraction` until the extraction stage exists.
 */

export const DRAFTING_RUN_QUEUE = 'loomi.drafting.run';

export interface DraftingJob {
  requestId: string;
}

// One idempotent createQueue per process. The worker creates this queue too
// (and MUST — see queue-registration.test.ts); this covers the web process
// enqueueing before the worker has ever booted.
let queueEnsured = false;

async function ensureQueue(): Promise<void> {
  if (queueEnsured) return;
  const boss = await getBoss();
  await boss.createQueue(DRAFTING_RUN_QUEUE);
  queueEnsured = true;
}

/** Throws on failure, so the caller can fail the request rather than leave a `queued` row nothing will pick up. */
export async function enqueueDraftingJob(requestId: string): Promise<void> {
  await ensureQueue();
  const boss = await getBoss();
  const job: DraftingJob = { requestId };
  await boss.send(DRAFTING_RUN_QUEUE, job, {
    // No retry: a stage that failed has written why, and a person decides
    // whether to start it again — retrying blind would re-read monday and
    // re-upload the creative for a problem that needs fixing on monday.
    retryLimit: 0,
    expireInSeconds: 1800,
  });
}

function parseAssets(raw: string | null): DraftAsset[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as DraftAsset[]) : null;
  } catch {
    return null;
  }
}

/** Why a deliverable can't be drafted right now, in words for the person who started it. */
export function fetchProblem(d: Deliverable | null): string | null {
  if (!d) return 'monday no longer has this deliverable.';
  if (d.kind !== 'email') return `"${d.name}" isn't an email deliverable; only email is drafted so far.`;
  if (!d.assetsApproved) return 'Assets Approved on monday isn\'t "Approved" any more.';
  if (!d.project) return 'This deliverable has no parent project on monday.';
  if (d.designAssets.length === 0) return 'Design Assets on monday is empty.';
  if (!d.designAssets.some((f) => imageType(f))) {
    const names = d.designAssets.map((f) => f.name).join(', ');
    return `Design Assets has no PNG or JPG to draft from (found: ${names}). Export the approved creative as an image.`;
  }
  return null;
}

function failureMessage(err: unknown): string {
  if (err instanceof MondayError) {
    return err.code === 'not_configured'
      ? "monday isn't connected in this environment (MONDAY_API_TOKEN), so the deliverable can't be read."
      : err.message;
  }
  return `Drafting stopped unexpectedly: ${err instanceof Error ? err.message : String(err)}`;
}

export async function runDraftingJob(requestId: string): Promise<void> {
  const request = await prisma.draftRequest.findUnique({ where: { id: requestId } });
  if (!request) {
    console.warn(`[drafting-job] request ${requestId} not found`);
    return;
  }
  // Claim it: queued → fetching in one conditional write. A duplicate job (two
  // enqueues for one start) finds nothing to claim and stops, instead of racing
  // the job that owns the request.
  const claimed = await prisma.draftRequest.updateMany({
    where: { id: requestId, status: 'queued' },
    data: { status: 'fetching', error: null },
  });
  if (claimed.count === 0) {
    console.warn(`[drafting-job] request ${requestId} is already ${request.status}; skipping`);
    return;
  }

  try {
    const deliverable = await getDeliverable(request.mondaySubitemId);
    const problem = fetchProblem(deliverable);
    if (problem || !deliverable?.project) {
      await prisma.draftRequest.update({ where: { id: requestId }, data: { status: 'failed', error: problem } });
      return;
    }

    const assets = await copyDesignAssets(requestId, deliverable.designAssets);
    // A replaced creative invalidates everything read from the old one.
    const creativeChanged = !sameCreative(parseAssets(request.assets), assets);
    await prisma.draftRequest.update({
      where: { id: requestId },
      data: {
        status: 'awaiting_extraction',
        name: deliverable.name,
        mondayProjectId: deliverable.project.id,
        projectName: deliverable.project.name,
        coop: deliverable.project.coop,
        request: JSON.stringify({ ...deliverable.project, readAt: new Date().toISOString() }),
        assets: JSON.stringify(assets),
        ...(creativeChanged
          ? { extraction: null, extractionConfirmedAt: null, extractionConfirmedBy: null, conflicts: null }
          : {}),
        error: null,
      },
    });
  } catch (err) {
    console.error(`[drafting-job] request ${requestId} failed:`, err);
    await prisma.draftRequest
      .update({ where: { id: requestId }, data: { status: 'failed', error: failureMessage(err) } })
      .catch(() => {});
  }
}
