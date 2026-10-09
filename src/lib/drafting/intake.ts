import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { isMondayConfigured } from '@/lib/monday/client';
import { suggestAccount, type AccountOption } from './accounts';
import { listReadyDeliverables, type ReadyDeliverable } from './monday-board';
import { cantDraftUpdate } from './notes';
import { noticeOnce } from './notice';
import { holdRequest, startDraftRequest } from './requests';

/**
 * The drafting trigger: every five minutes, find email deliverables whose
 * Assets Approved reads "Approved" and start the ones Loomi hasn't.
 *
 * There is no drafting screen — a person starts a draft on monday by approving
 * the creative, and everything Loomi has to say comes back as an update on the
 * subitem. So this pass has to be quiet: it starts each deliverable once,
 * retries one that couldn't start only when someone has changed what it's made
 * from, and never posts the same notice twice.
 */

export const DRAFTING_INTAKE_QUEUE = 'loomi.drafting.intake';

/**
 * Off unless `DRAFTING_INTAKE_ENABLED=true`. `MONDAY_API_TOKEN` alone isn't
 * consent: the help desk needs the token too, and setting it for that must not
 * start copying creatives and posting notices on real subitems before the
 * drafter can finish what the intake starts.
 */
export function intakeEnabled(): boolean {
  return process.env.DRAFTING_INTAKE_ENABLED === 'true' && isMondayConfigured();
}

/** Quiet retries of a failure with nothing changed on monday — a monday or S3 hiccup. */
export const MAX_ATTEMPTS = 3;
export const RETRY_AFTER_MS = 30 * 60 * 1000;

/** What a draft is made from on monday. A fix on monday changes it; Loomi's own writes don't. */
export function intakeFingerprint(d: Pick<ReadyDeliverable, 'designAssetIds' | 'clients'>): string {
  const basis = JSON.stringify({ assets: [...d.designAssetIds].sort(), clients: d.clients });
  return createHash('sha256').update(basis).digest('hex').slice(0, 32);
}

export type IntakeAction = { kind: 'start' } | { kind: 'skip'; why: string };

/**
 * What to do with one ready deliverable, given the request Loomi already has
 * for it, if any.
 *
 * Pure.
 */
export function intakeAction(
  d: ReadyDeliverable,
  prior: { status: string; attempts: number; intakeFingerprint: string | null; updatedAt: Date } | null,
  fingerprint: string,
  now: Date,
): IntakeAction {
  if (d.kind !== 'email') return { kind: 'skip', why: 'not an email deliverable' };
  if (!prior) {
    // Someone built it by hand before Loomi got to it.
    if (d.hasDraftFiles || d.hasTemplateLink) return { kind: 'skip', why: 'already has a draft' };
    return { kind: 'start' };
  }
  if (prior.status !== 'needs_account' && prior.status !== 'failed') return { kind: 'skip', why: `already ${prior.status}` };
  if (prior.intakeFingerprint !== fingerprint) return { kind: 'start' };
  if (
    prior.status === 'failed'
    && prior.attempts < MAX_ATTEMPTS
    && now.getTime() - prior.updatedAt.getTime() >= RETRY_AFTER_MS
  ) {
    return { kind: 'start' };
  }
  return { kind: 'skip', why: 'waiting for a change on monday' };
}

/**
 * The one client a deliverable is for. Read from the parent request until
 * monday carries the client on each subitem; a request naming several clients
 * can't say which subitem is whose until then.
 */
export function clientFor(d: Pick<ReadyDeliverable, 'clients'>): { name: string | null; problem: string | null } {
  if (d.clients.length === 0) return { name: null, problem: 'The request on monday names no client.' };
  if (d.clients.length > 1) {
    return {
      name: null,
      problem: `The request names ${d.clients.length} clients (${d.clients.join('; ')}), and this subitem doesn't say which one it's for.`,
    };
  }
  return { name: d.clients[0], problem: null };
}

async function accountOptions(): Promise<AccountOption[]> {
  const rows = await prisma.account.findMany({ select: { key: true, dealer: true, parentAccountKey: true } });
  const parents = new Set(rows.map((r) => r.parentAccountKey).filter((k): k is string => Boolean(k)));
  return rows.filter((r) => !r.key.startsWith('_')).map((r) => ({ key: r.key, dealer: r.dealer, isGroup: parents.has(r.key) }));
}

export interface IntakeSummary {
  ready: number;
  started: number;
  held: number;
}

export async function runDraftingIntake(now = new Date()): Promise<IntakeSummary> {
  const summary: IntakeSummary = { ready: 0, started: 0, held: 0 };
  if (!intakeEnabled()) return summary;

  const ready = (await listReadyDeliverables()).filter((d) => d.kind === 'email');
  summary.ready = ready.length;
  if (ready.length === 0) return summary;

  const priors = new Map(
    (await prisma.draftRequest.findMany({ where: { mondaySubitemId: { in: ready.map((d) => d.id) } } })).map((r) => [
      r.mondaySubitemId,
      r,
    ]),
  );
  const accounts = await accountOptions();

  for (const d of ready) {
    const fingerprint = intakeFingerprint(d);
    const prior = priors.get(d.id) ?? null;
    if (intakeAction(d, prior, fingerprint, now).kind === 'skip') continue;

    // Something changed on monday: a fresh set of quiet retries.
    if (prior && prior.intakeFingerprint !== fingerprint) {
      await prisma.draftRequest.update({ where: { id: prior.id }, data: { attempts: 0 } });
    }

    const hold = async (status: 'needs_account' | 'failed', error: string, clientName: string | null) => {
      const held = await holdRequest({
        subitemId: d.id,
        name: d.name,
        projectName: d.projectName,
        clientName,
        status,
        error,
        fingerprint,
      });
      await noticeOnce(held, cantDraftUpdate(error));
      summary.held += 1;
    };

    const client = clientFor(d);
    if (!client.name) {
      await hold('needs_account', client.problem ?? 'No client.', null);
      continue;
    }
    const match = suggestAccount(client.name, accounts);
    if (!match.accountKey) {
      await hold('needs_account', `Loomi couldn't tell which account "${client.name}" is. ${match.reason ?? ''}`.trim(), client.name);
      continue;
    }

    const result = await startDraftRequest({ subitemId: d.id, accountKey: match.accountKey, clientName: client.name, fingerprint });
    if (result.ok) {
      summary.started += 1;
      continue;
    }
    if (result.code === 'unavailable') break; // monday or the worker is down; the next pass tries again
    if (result.code === 'not_ready') await hold('failed', result.error, client.name);
  }
  return summary;
}
