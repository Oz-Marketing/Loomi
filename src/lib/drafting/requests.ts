import { Prisma, type DraftRequest } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isMondayConfigured } from '@/lib/monday/client';
import { enqueueDraftingJob, fetchProblem } from './job';
import { getDeliverable } from './monday-board';
import { isRunning } from './status';

/**
 * Starting a draft for one monday deliverable — one subitem, one client, one
 * template — and recording one that can't start yet.
 */

const NOT_CONNECTED = "monday isn't connected in this environment (MONDAY_API_TOKEN).";

/** Running, or approved and final, can't be started again. */
export function canStart(status: string): boolean {
  return !isRunning(status) && status !== 'approved';
}

/**
 * Why a start didn't happen: `busy` and `final` mean leave it alone, `not_ready`
 * means monday is missing something a person has to fix, `unavailable` means
 * try again on a later pass.
 */
export type StartFailure = 'busy' | 'final' | 'not_ready' | 'unavailable';

export type StartResult =
  | { ok: true; requestId: string }
  | { ok: false; status: number; error: string; code: StartFailure };

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
  /** The client as monday names it, for notes. */
  clientName?: string | null;
  /** What the poller drafted from; see `DraftRequest.intakeFingerprint`. */
  fingerprint?: string | null;
  startedByUserId?: string | null;
}): Promise<StartResult> {
  const account = await prisma.account.findUnique({ where: { key: input.accountKey }, select: { key: true } });
  if (!account) return { ok: false, status: 404, error: `No Loomi account "${input.accountKey}".`, code: 'not_ready' };
  if (!isMondayConfigured()) return { ok: false, status: 503, error: NOT_CONNECTED, code: 'unavailable' };

  const existing = await prisma.draftRequest.findUnique({ where: { mondaySubitemId: input.subitemId } });
  if (existing && !canStart(existing.status)) {
    return existing.status === 'approved'
      ? { ok: false, status: 409, error: 'This draft is approved and final.', code: 'final' }
      : { ok: false, status: 409, error: 'This deliverable is already being drafted.', code: 'busy' };
  }

  let deliverable;
  try {
    deliverable = await getDeliverable(input.subitemId);
  } catch (err) {
    return { ok: false, status: 502, error: err instanceof Error ? err.message : 'Could not read the deliverable.', code: 'unavailable' };
  }
  const problem = fetchProblem(deliverable);
  if (problem || !deliverable) {
    return { ok: false, status: 409, error: problem ?? 'monday no longer has this deliverable.', code: 'not_ready' };
  }

  const fields = {
    accountKey: account.key,
    clientName: input.clientName ?? existing?.clientName ?? null,
    name: deliverable.name,
    projectName: deliverable.project?.name ?? null,
    mondayProjectId: deliverable.project?.id ?? null,
    coop: deliverable.project?.coop ?? 'unset',
    intakeFingerprint: input.fingerprint ?? existing?.intakeFingerprint ?? null,
    startedByUserId: input.startedByUserId ?? null,
    error: null,
  };

  let id: string;
  if (existing) {
    const moved = await prisma.draftRequest.updateMany({
      where: { id: existing.id, status: existing.status },
      data: { ...fields, status: 'queued', attempts: { increment: 1 } },
    });
    if (moved.count === 0) return { ok: false, status: 409, error: 'This deliverable is already being drafted.', code: 'busy' };
    id = existing.id;
  } else {
    try {
      id = (
        await prisma.draftRequest.create({
          data: { ...fields, mondaySubitemId: input.subitemId, kind: deliverable.kind, status: 'queued', attempts: 1 },
          select: { id: true },
        })
      ).id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { ok: false, status: 409, error: 'This deliverable is already being drafted.', code: 'busy' };
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
    return { ok: false, status: 503, error: 'Could not reach the background worker to start drafting.', code: 'unavailable' };
  }
  return { ok: true, requestId: id };
}

/**
 * Record a deliverable that can't be drafted yet — its client doesn't resolve
 * to one Loomi account, or monday is missing something — so the poller knows
 * it already looked, and notices are posted once rather than every pass.
 */
export async function holdRequest(input: {
  subitemId: string;
  name: string;
  projectName: string | null;
  clientName: string | null;
  status: 'needs_account' | 'failed';
  error: string;
  fingerprint: string;
}): Promise<DraftRequest> {
  const data = {
    name: input.name,
    projectName: input.projectName,
    clientName: input.clientName,
    status: input.status,
    error: input.error,
    intakeFingerprint: input.fingerprint,
    ...(input.status === 'needs_account' ? { accountKey: null } : {}),
  };
  // A failure is an attempt — it's what bounds the poller's quiet retries. A
  // missing account isn't retried until monday changes, so it counts nothing.
  const failed = input.status === 'failed';
  return prisma.draftRequest.upsert({
    where: { mondaySubitemId: input.subitemId },
    create: { ...data, mondaySubitemId: input.subitemId, attempts: failed ? 1 : 0 },
    update: { ...data, ...(failed ? { attempts: { increment: 1 } } : {}) },
  });
}
