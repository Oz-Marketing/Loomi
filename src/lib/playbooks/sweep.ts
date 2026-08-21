/**
 * Playbooks — the nightly coverage sweep.
 *
 * The audit was on-demand only: it computed a perfectly good matrix and then
 * forgot it the moment the tab closed. So nothing could tell you that six
 * rooftops drifted last night, and nothing could tell you the audit itself had
 * stopped working — a screen nobody opened and a screen that was broken looked
 * identical.
 *
 * This is the heartbeat. It writes a `PlaybookRun` on EVERY run including a
 * clean one, the same discipline as `IngestRun` and `AdAutomationRun`, because
 * "nothing drifted this week" and "the sweep has been dead for three weeks"
 * otherwise render the same way.
 *
 * It alerts on what is NEW. Re-reporting the whole backlog every morning is how
 * an alert becomes a filter rule.
 */

import { prisma } from '@/lib/prisma';
import { createNotification } from '@/lib/notifications/service';
import { PLAYBOOKS_ENABLED } from '@/lib/feature-flags';
import { loadAuditContexts, currentPeriod } from './context';
import { buildAuditPayload } from './audit';
import type { AuditPayload } from './types';

export interface SweepResult {
  runId: string | null;
  accountsAudited: number;
  blockingFails: number;
  /** `accountKey:checkId` blocking failures absent from the previous run. */
  newBlocking: string[];
  coveragePct: number | null;
  notified: number;
  error?: string;
}

/** Stable identity for one blocking failure, so runs can be diffed. */
function blockingKey(accountKey: string, checkId: string): string {
  return `${accountKey}:${checkId}`;
}

function collectBlockingKeys(payload: AuditPayload): string[] {
  const keys: string[] = [];
  for (const account of payload.accounts) {
    for (const playbook of account.playbooks) {
      for (const check of playbook.checks) {
        if (check.status === 'fail' && check.severity === 'blocking') {
          keys.push(blockingKey(account.accountKey, check.id));
        }
      }
    }
  }
  return keys.sort();
}

/**
 * Which blocking failures are NEW since the last sweep.
 *
 * Two rules, and both exist because of how an alert dies:
 *
 *  - Only the difference is announced. Re-reporting the whole backlog every
 *    morning is how a notification becomes a filter rule, and then the one
 *    morning something genuinely breaks reads the same as the previous thirty.
 *  - A FIRST sweep announces nothing. With no previous run every existing
 *    failure looks new, so the very first alert would be a wall of 200
 *    pre-existing items — which is a backlog report, not an event, and is
 *    exactly the message that teaches someone to mute the channel.
 *
 * Pure, and exported, because both rules are one `if` away from silently
 * inverting and neither would show up on screen.
 */
export function diffBlocking(input: {
  current: string[];
  previous: string[];
  /** False when no sweep has completed before this one. */
  hadPreviousRun: boolean;
}): string[] {
  if (!input.hadPreviousRun) return [];
  const seen = new Set(input.previous);
  return input.current.filter((key) => !seen.has(key));
}

function parseKeys(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function summarize(payload: AuditPayload) {
  const counts = { pass: 0, warn: 0, fail: 0 };
  let blockingFails = 0;
  const scored: number[] = [];

  for (const account of payload.accounts) {
    counts.pass += account.counts.pass;
    counts.warn += account.counts.warn;
    counts.fail += account.counts.fail;
    blockingFails += account.blockingFails;
    if (account.coveragePct != null) scored.push(account.coveragePct);
  }

  return {
    ...counts,
    blockingFails,
    checksRun: counts.pass + counts.warn + counts.fail,
    coveragePct: scored.length
      ? Math.round(scored.reduce((n, p) => n + p, 0) / scored.length)
      : null,
  };
}

/**
 * Run the audit across every account and record it.
 *
 * Deliberately UNSCOPED: this is the agency's own nightly view, not a request on
 * anyone's behalf, so there is no session to intersect against. Every caller of
 * this function is a cron.
 */
export async function runCoverageSweep(opts: { now?: Date } = {}): Promise<SweepResult> {
  const now = opts.now ?? new Date();

  // The row is opened BEFORE the work, so a sweep that dies mid-run leaves a
  // started-but-never-finished row rather than no evidence at all. A
  // `finishedAt` of null on the newest row is itself the symptom.
  let runId: string | null = null;
  try {
    const run = await prisma.playbookRun.create({
      data: { kind: 'sweep', startedAt: now },
      select: { id: true },
    });
    runId = run.id;
  } catch (err) {
    // No row means no heartbeat, which is worse than a failed sweep — but it
    // must not stop the sweep from running.
    console.error('[playbooks] could not open a run row:', err);
  }

  try {
    const previous = await prisma.playbookRun.findFirst({
      where: { kind: 'sweep', finishedAt: { not: null }, ...(runId ? { id: { not: runId } } : {}) },
      orderBy: { startedAt: 'desc' },
      select: { blockingKeys: true },
    });

    const accounts = await prisma.account.findMany({
      select: { key: true },
      orderBy: { dealer: 'asc' },
    });
    const contexts = await loadAuditContexts(
      accounts.map((a) => a.key),
      { now },
    );
    const payload = buildAuditPayload(contexts, { period: currentPeriod(now), generatedAt: now });

    const summary = summarize(payload);
    const keys = collectBlockingKeys(payload);
    const newBlocking = diffBlocking({
      current: keys,
      previous: parseKeys(previous?.blockingKeys ?? null),
      hadPreviousRun: !!previous,
    });

    if (runId) {
      await prisma.playbookRun.update({
        where: { id: runId },
        data: {
          finishedAt: new Date(),
          accountsAudited: payload.accounts.length,
          checksRun: summary.checksRun,
          passCount: summary.pass,
          warnCount: summary.warn,
          failCount: summary.fail,
          blockingFails: summary.blockingFails,
          coveragePct: summary.coveragePct,
          blockingKeys: JSON.stringify(keys),
        },
      });
    }

    const notified = newBlocking.length ? await notifyNewBlocking(payload, newBlocking) : 0;

    return {
      runId,
      accountsAudited: payload.accounts.length,
      blockingFails: summary.blockingFails,
      newBlocking,
      coveragePct: summary.coveragePct,
      notified,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (runId) {
      // Best effort: the run row is the only record that the sweep tried.
      await prisma.playbookRun
        .update({ where: { id: runId }, data: { finishedAt: new Date(), error: message } })
        .catch(() => {});
    }
    console.error('[playbooks] sweep failed:', err);
    return {
      runId,
      accountsAudited: 0,
      blockingFails: 0,
      newBlocking: [],
      coveragePct: null,
      notified: 0,
      error: message,
    };
  }
}

/**
 * Tell the admins about blocking failures that appeared since the last sweep.
 *
 * Recipients are roles rather than a config list, the same call
 * `notifyGuidelineChanges` makes and for the same reason: this is agency-wide
 * governance, not one rooftop's setting. An empty recipient list means the whole
 * mechanism silently does nothing, so it says so out loud.
 *
 * THE RECIPIENT SET MIRRORS `playbooksAllowed`. Never notify someone about a page
 * they cannot open: the alert links to `/playbooks`, which 404s for anyone
 * without the flag, and a notification whose link is a dead end reads as the
 * product being broken rather than as news.
 *
 * So while the flag is off this is developers only, who bypass it. The sweep
 * itself still runs and still records its heartbeat either way — history
 * gathered before launch is history that is there when the flag flips, and the
 * first-run rule in `diffBlocking` means flipping it later cannot dump a backlog.
 *
 * Note the flag is a `NEXT_PUBLIC_*` var: Next inlines it at BUILD time for the
 * web process, but the worker reads it from its own environment at run time (on
 * the droplet, `shared/.env.local`). If it is missing there this degrades to
 * developer-only rather than to silence, and the chosen set is logged, so a
 * wrong env is visible instead of mysterious.
 */
async function notifyNewBlocking(payload: AuditPayload, newKeys: string[]): Promise<number> {
  const roles = PLAYBOOKS_ENABLED ? ['developer', 'super_admin', 'admin'] : ['developer'];

  let recipients: string[] = [];
  try {
    const admins = await prisma.user.findMany({
      where: { role: { in: roles } },
      select: { id: true },
      take: 10,
    });
    recipients = admins.map((a) => a.id);
  } catch (err) {
    console.warn('[playbooks] could not resolve alert recipients:', err);
    return 0;
  }
  if (recipients.length === 0) {
    console.warn(
      `[playbooks] ${newKeys.length} new blocking failure(s) with no one to notify ` +
        `(roles searched: ${roles.join(', ')})`,
    );
    return 0;
  }
  console.log(
    `[playbooks] alerting ${recipients.length} recipient(s) in [${roles.join(', ')}]` +
      `${PLAYBOOKS_ENABLED ? '' : ' \u2014 flag off, developers only'}`,
  );

  // Name the rooftops rather than the check ids: "Young Chevrolet" is what
  // someone can act on, `meta.page_confirmed` is what they'd have to look up.
  const dealerByKey = new Map(payload.accounts.map((a) => [a.accountKey, a.dealer]));
  const labelById = new Map(payload.byCheck.map((c) => [c.id, c.label]));
  const lines = newKeys.slice(0, 8).map((key) => {
    const split = key.lastIndexOf(':');
    const accountKey = key.slice(0, split);
    const checkId = key.slice(split + 1);
    return `${dealerByKey.get(accountKey) ?? accountKey} — ${labelById.get(checkId) ?? checkId}`;
  });
  const more = newKeys.length - lines.length;

  const title =
    newKeys.length === 1
      ? 'A playbook check started blocking'
      : `${newKeys.length} playbook checks started blocking`;
  const body =
    lines.join('; ') + (more > 0 ? `; and ${more} more.` : '.') +
    ' These stop publishing until they are fixed.';

  let sent = 0;
  for (const userId of recipients) {
    try {
      await createNotification({
        userId,
        type: 'playbook_drift',
        severity: 'warning',
        title,
        body,
        link: '/playbooks',
        meta: { newBlocking: newKeys.slice(0, 50) },
        // A RELATIVE window, not a date-stamped key. The pacer learned this the
        // hard way: a UTC-dated dedupe key silently suppressed the next
        // scheduled run whenever the job was re-run by hand late in the day.
        dedupeKey: `playbook-drift:${newKeys.join('|')}`,
        dedupeWindowHours: 20,
      });
      sent += 1;
    } catch (err) {
      console.warn('[playbooks] drift notification failed:', err);
    }
  }
  return sent;
}
