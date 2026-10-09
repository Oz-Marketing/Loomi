import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isMondayConfigured } from '@/lib/monday/client';
import { enqueueDraftingJob, fetchProblem } from './job';
import { getDeliverable } from './monday-board';
import { isRunning } from './status';

/**
 * Starting a draft for one monday deliverable — the single entry point,
 * whatever decides to start it.
 */

const NOT_CONNECTED = "monday isn't connected in this environment (MONDAY_API_TOKEN).";

/** Running, or approved and final, can't be started again. */
export function canStart(status: string): boolean {
  return !isRunning(status) && status !== 'approved';
}

export type StartResult =
  | { ok: true; requestId: string }
  | { ok: false; status: number; error: string };

/**
 * Create the DraftRequest for a deliverable (or queue an existing one again)
 * and hand it to the worker.
 *
 * The status only moves with a conditional update keyed on the status that was
 * read, so two starts racing for one deliverable can never queue two jobs:
 * whoever loses gets a 409.
 */
export async function startDraftRequest(input: {
  subitemId: string;
  accountKey: string;
  startedByUserId?: string | null;
}): Promise<StartResult> {
  const account = await prisma.account.findUnique({ where: { key: input.accountKey }, select: { key: true } });
  if (!account) return { ok: false, status: 404, error: 'No such account.' };
  if (!isMondayConfigured()) return { ok: false, status: 503, error: NOT_CONNECTED };

  const existing = await prisma.draftRequest.findUnique({ where: { mondaySubitemId: input.subitemId } });
  if (existing && !canStart(existing.status)) {
    return {
      ok: false,
      status: 409,
      error: existing.status === 'approved' ? 'This draft is approved and final.' : 'This deliverable is already being drafted.',
    };
  }

  let deliverable;
  try {
    deliverable = await getDeliverable(input.subitemId);
  } catch (err) {
    return { ok: false, status: 400, error: err instanceof Error ? err.message : 'Could not read the deliverable.' };
  }
  const problem = fetchProblem(deliverable);
  if (problem || !deliverable) return { ok: false, status: 409, error: problem ?? 'monday no longer has this deliverable.' };

  const fields = {
    accountKey: account.key,
    name: deliverable.name,
    projectName: deliverable.project?.name ?? null,
    mondayProjectId: deliverable.project?.id ?? null,
    coop: deliverable.project?.coop ?? 'unset',
    startedByUserId: input.startedByUserId ?? null,
    error: null,
  };

  let id: string;
  if (existing) {
    const moved = await prisma.draftRequest.updateMany({
      where: { id: existing.id, status: existing.status },
      data: { ...fields, status: 'queued' },
    });
    if (moved.count === 0) return { ok: false, status: 409, error: 'This deliverable is already being drafted.' };
    id = existing.id;
  } else {
    try {
      id = (
        await prisma.draftRequest.create({
          data: { ...fields, mondaySubitemId: input.subitemId, kind: deliverable.kind, status: 'queued' },
          select: { id: true },
        })
      ).id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { ok: false, status: 409, error: 'This deliverable is already being drafted.' };
      }
      throw err;
    }
  }

  try {
    await enqueueDraftingJob(id);
  } catch (err) {
    // Fail it rather than leave a `queued` row no worker will ever pick up.
    console.error('[drafting] enqueue failed:', err);
    await prisma.draftRequest
      .update({ where: { id }, data: { status: 'failed', error: 'Could not reach the background worker to start drafting.' } })
      .catch(() => {});
    return { ok: false, status: 503, error: 'Could not reach the background worker to start drafting.' };
  }
  return { ok: true, requestId: id };
}
