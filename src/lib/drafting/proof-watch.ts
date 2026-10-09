import { prisma } from '@/lib/prisma';
import { isMondayConfigured } from '@/lib/monday/client';
import { getProofStates, type ProofState } from './monday-board';
import { PROOFING_STATUSES, isDraftStatus, type DraftStatus } from './status';

/**
 * Following a draft's proof on monday.
 *
 * A person starts the proof from the subitem; the monday ↔ PageProof
 * integration writes Proof Status, Proof URL and Proof Approval Date back. This
 * sweep READS those columns for every request with a proof out and moves the
 * request along. "Approved" is final: the version that was in Draft Files
 * becomes the frozen artifact. Nothing here writes to monday.
 */

export const DRAFTING_PROOF_QUEUE = 'loomi.drafting.proof-status';

/** Proof Status labels that mean the proof is still open. */
const STILL_PROOFING = new Set(['In proofing', 'Has new version', 'Awaiting new version']);

/**
 * What a request becomes given its proof. Labels that say nothing about the
 * draft — "No proof", "Canceled", "Archived", blank — leave it where it is.
 *
 * Pure.
 */
export function nextStatusForProof(current: DraftStatus, proof: ProofState): DraftStatus {
  if (proof.approved) return 'approved';
  if (proof.status === 'To-dos requested') return 'changes_requested';
  if (proof.status && STILL_PROOFING.has(proof.status)) return 'in_proofing';
  return current;
}

export async function runProofStatusSweep(): Promise<void> {
  const open = await prisma.draftRequest.findMany({
    where: { status: { in: [...PROOFING_STATUSES] } },
    select: { id: true, mondaySubitemId: true, status: true },
  });
  // Nothing out for proof is the common case — no reason to call monday at all.
  if (open.length === 0 || !isMondayConfigured()) return;

  const states = await getProofStates(open.map((r) => r.mondaySubitemId));
  const now = new Date();
  for (const request of open) {
    const proof = states.get(request.mondaySubitemId);
    if (!proof || !isDraftStatus(request.status)) continue;
    const status = nextStatusForProof(request.status, proof);
    const proofFields = {
      proofStatus: proof.status,
      proofUrl: proof.url,
      proofApprovedOn: proof.approvedOn,
      proofCheckedAt: now,
    };

    if (status !== 'approved') {
      await prisma.draftRequest.update({ where: { id: request.id }, data: { status, ...proofFields } });
      continue;
    }

    // The proof was started from the files in Draft Files, which are the most
    // recently uploaded version's.
    const final = await prisma.draftVersion.findFirst({
      where: { requestId: request.id, uploadedAt: { not: null } },
      orderBy: { number: 'desc' },
      select: { id: true, finalAt: true },
    });
    await prisma.$transaction([
      ...(final && !final.finalAt
        ? [prisma.draftVersion.update({ where: { id: final.id }, data: { finalAt: now } })]
        : []),
      prisma.draftRequest.update({ where: { id: request.id }, data: { status, ...proofFields } }),
    ]);
  }
}
