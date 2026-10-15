import { prisma } from '@/lib/prisma';
import { getBoss } from '@/lib/queue/boss';
import { MondayError } from '@/lib/monday/client';
import { pickEmailFiles } from './approved-files';
import { collectApprovedCreative, sameCreative, storeCreative, type DraftAsset } from './assets';
import { getDeliverable, type Deliverable } from './monday-board';
import { runDraftStages } from './draft';
import { cantDraftUpdate } from './notes';
import { noticeOnce } from './notice';

/**
 * The drafting job: one DraftRequest, carried as far as the pipeline goes.
 *
 * A worker job, not a request handler: reading the creative and drafting take
 * longer than nginx's 60-second cut, the reason template sync moved to the
 * worker. The route creates (or re-queues) the request and returns; this runs
 * the stages and keeps the row current, so the queue page can show progress and
 * whoever comes back later can see what happened.
 *
 * FETCH is here — read the deliverable and its request from monday, check it's
 * still approved, and copy the creative into Loomi. The rest (read, check,
 * draft, validate, publish) is `draft.ts::runDraftStages`, run straight after.
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

/** Why a deliverable can't be drafted right now, in words for the person reading the note. */
export function fetchProblem(d: Deliverable | null): string | null {
  if (!d) return 'monday no longer has this deliverable.';
  if (d.kind !== 'email') return `"${d.name}" isn't an email deliverable; only email is drafted so far.`;
  if (!d.project) return 'This deliverable has no parent project on monday.';
  if (d.project.approvedFiles.length === 0) {
    return "Approved Design on the project is empty: design hasn't uploaded the final graphics yet.";
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
      await failRequest(request, problem ?? 'This deliverable has no parent project on monday.');
      return;
    }

    // Every approved graphic, zips unpacked; then the email one(s) for this store.
    const collected = await collectApprovedCreative(deliverable.project.approvedFiles);
    const pick = pickEmailFiles({
      subitem: { id: deliverable.id, name: deliverable.name },
      siblings: deliverable.project.subitems,
      clients: deliverable.project.clients,
      files: collected,
      // What design uploaded, zips listed by their contents.
      available: [
        ...deliverable.project.approvedFiles.filter((f) => !/\.zip$/i.test(f.name)).map((f) => f.name),
        ...collected.filter((c) => c.id.includes('#')).map((c) => c.path),
      ],
    });
    if (pick.problem !== null) {
      await failRequest(request, pick.problem);
      return;
    }
    const assets = await storeCreative(requestId, pick.files);
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
    await failRequest(request, failureMessage(err)).catch(() => {});
    return;
  }
  // Records its own stops and failures.
  await runDraftStages(requestId);
}

/** Stop the request and say why on the subitem, once. */
async function failRequest(
  request: { id: string; mondaySubitemId: string; lastNotice: string | null },
  error: string,
): Promise<void> {
  await prisma.draftRequest.update({ where: { id: request.id }, data: { status: 'failed', error } });
  await noticeOnce(request, cantDraftUpdate(error));
}
