/**
 * One OEM offer run, end to end — the orchestrator both doors call.
 *
 * WHAT WAS WRONG. `generateForAccount` built the ads and wrote the run row;
 * the Campaign container and the offer email were created afterwards, inside
 * `generateOfferEmail`, and only on the scheduled path, and only when email
 * was on. So a run triggered by hand produced ads that appeared on no campaign,
 * an account with email off never got a campaign at all, and the container's
 * identity was an accident of which offers the email happened to feature.
 *
 * NOW. Every run — scheduled or by hand — goes through here:
 *
 *   0. archive the account's automation campaigns whose cycle month has ended
 *   1. open the run row (the LOCK — a partial unique index allows one open
 *      generate run per account; a second is a 409, not a second run)
 *   2. find this cycle's container and mark it `building`
 *   3. build the creatives (unchanged; `generateForAccount`)
 *   4. attach them to the container — creating it if the run produced anything
 *      and none exists — leaving ads already on a LIVE container where they are
 *   5. draft or refresh the cycle's offer email, when the account has email on
 *   6. notify — the account's users when asked; reviewers only on a scheduled run
 *   7. close the run row, and always put the container back to `draft`
 *
 * The container is the run's, not the email's. An ads-only campaign is the
 * common shape (every dev config has email off) and is a complete deliverable.
 *
 * WHY THE RUN ROW IS OPENED FIRST AND IS THE LOCK. The app runs `next start`
 * under PM2 behind nginx; a handler is never cut by `maxDuration`, but nginx
 * returns 504 at its 60s default while the run continues. A person who sees
 * that and clicks again must meet the lock, not start a second run. Rows left
 * open by a process that died are closed as `abandoned` after 15 minutes —
 * observed runs take seconds to a few minutes — so a dead run cannot hold an
 * account forever.
 *
 * `generate` is injectable so the container/cycle/lock/email behaviour can be
 * tested against Postgres with a fixture generator: the real one needs EVOX,
 * Chromium, S3 and Anthropic, and is covered by the staging pass.
 *
 * Server-only.
 */
import { prisma } from '@/lib/prisma';
import { setCampaignStatus } from '@/lib/services/campaigns';
import { createNotification } from '@/lib/notifications/service';
import {
  generateForAccount,
  resolveClientWatchers,
  resolveReviewers,
  GENERATE_CONFIG_SELECT,
  type GenerateConfigRow,
  type GenerateResult,
  type GenerateScope,
  type GeneratedAd,
} from './generate-ads';
import { generateOfferEmail, type OfferEmailResult } from './generate-offer-email';
import { runWindowFor } from './poll-offers';
import type { RunWindow } from './offer-timing';
import {
  archiveEndedOfferCycles,
  ensureOfferCampaign,
  offerCycleKey,
} from './offer-campaign';

/** Open rows older than this are a dead process, not a slow run. */
export const RUN_ABANDON_MINUTES = 15;

export class OfferRunInProgressError extends Error {
  constructor(
    public readonly accountKey: string,
    public readonly since: Date | null,
  ) {
    super(`An offer run is already in progress for ${accountKey}`);
    this.name = 'OfferRunInProgressError';
  }
}

export interface OfferRunTrigger {
  kind: 'manual' | 'scheduled';
  userId?: string | null;
  userName?: string | null;
}

export interface OfferRunResult extends GenerateResult {
  runId: string;
  cycleKey: string;
  runWindow: RunWindow;
  campaignId: string | null;
  email: OfferEmailResult | null;
  /** Automation campaigns for ended months this run archived on its way in. */
  archivedCampaignIds: string[];
}

/**
 * Open the run row. Throws `OfferRunInProgressError` when one is already open
 * for the account — the partial unique index on (accountKey, kind) WHERE
 * finishedAt IS NULL turns the second insert into P2002.
 */
export async function beginRun(accountKey: string, now = new Date()): Promise<string> {
  // Recovery path: a run the process died under never wrote `finishedAt`.
  await prisma.adAutomationRun.updateMany({
    where: {
      accountKey,
      kind: 'generate',
      finishedAt: null,
      startedAt: { lt: new Date(now.getTime() - RUN_ABANDON_MINUTES * 60_000) },
    },
    data: { finishedAt: now, error: 'abandoned' },
  });
  try {
    const run = await prisma.adAutomationRun.create({
      data: { accountKey, kind: 'generate', startedAt: now, finishedAt: null },
      select: { id: true },
    });
    return run.id;
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') {
      const open = await prisma.adAutomationRun.findFirst({
        where: { accountKey, kind: 'generate', finishedAt: null },
        select: { startedAt: true },
      });
      throw new OfferRunInProgressError(accountKey, open?.startedAt ?? null);
    }
    throw err;
  }
}

/** The run row's poll shape, for the Done step and the run history. */
export async function getRunStatus(runId: string) {
  const run = await prisma.adAutomationRun.findUnique({
    where: { id: runId },
    select: { id: true, accountKey: true, startedAt: true, finishedAt: true, error: true, detail: true },
  });
  if (!run) return null;
  let detail: Record<string, unknown> = {};
  try {
    detail = run.detail ? (JSON.parse(run.detail) as Record<string, unknown>) : {};
  } catch {
    detail = {};
  }
  return {
    id: run.id,
    accountKey: run.accountKey,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    error: run.error,
    campaignId: (detail.campaignId as string | null | undefined) ?? null,
    generated: Array.isArray(detail.generated) ? (detail.generated as GeneratedAd[]).length : 0,
    refreshed: Array.isArray(detail.generated)
      ? (detail.generated as GeneratedAd[]).filter((g) => g.updated).length
      : 0,
    skipped: Array.isArray(detail.skipped) ? (detail.skipped as unknown[]).length : 0,
    email: (detail.email as Record<string, unknown> | null | undefined) ?? null,
    trigger: (detail.trigger as OfferRunTrigger | undefined) ?? null,
  };
}

export async function runOfferCampaign(
  config: GenerateConfigRow,
  opts: {
    /** A run row already opened by the caller (the route opens it to answer 202). */
    runId?: string;
    scope?: GenerateScope;
    trigger: OfferRunTrigger;
    /** Tell the account's users when the run built something new. */
    notifyClients?: boolean;
    now?: Date;
    generate?: typeof generateForAccount;
  },
): Promise<OfferRunResult> {
  const now = opts.now ?? new Date();
  const generate = opts.generate ?? generateForAccount;
  const { accountKey } = config;

  // 0. Roll ended cycles off Active — before anything else, so it happens even
  //    when this run builds nothing (the month-end wait state).
  const archivedCampaignIds = await archiveEndedOfferCycles(accountKey, now).catch((err) => {
    console.warn(`[offer-run] ${accountKey}: rollover sweep failed:`, err);
    return [] as string[];
  });

  // 1. The lock.
  const runId = opts.runId ?? (await beginRun(accountKey, now));
  const runWindow = runWindowFor(config, now);
  const cycleKey = offerCycleKey(accountKey, runWindow);

  // 2. This cycle's container, marked while we write into it.
  let campaignId: string | null = null;
  let marked = false;
  const found = await prisma.campaign.findUnique({
    where: { automationKey: cycleKey },
    select: { id: true, archivedAt: true },
  });
  if (found && !found.archivedAt) {
    campaignId = found.id;
    await setCampaignStatus(campaignId, 'building');
    marked = true;
  }

  let result: GenerateResult | null = null;
  let email: OfferEmailResult | null = null;
  let emailFailure: string | null = null;
  let error: string | null = null;
  try {
    // 3. The creatives.
    result = await generate(config, { now, scope: opts.scope });
    const ids = result.generated.map((g) => g.creativeId);
    if (ids.length) {
      await prisma.adCreative.updateMany({ where: { id: { in: ids } }, data: { runId } });
    }

    // 4. Attach. Only ads that belong to no live container move: an ad is
    //    never pulled out of a campaign someone can see into another one.
    if (ids.length) {
      const rows = await prisma.adCreative.findMany({
        where: { id: { in: ids } },
        select: { id: true, campaign: { select: { archivedAt: true } } },
      });
      const attachable = rows.filter((r) => !r.campaign || r.campaign.archivedAt).map((r) => r.id);
      if (attachable.length && !campaignId) {
        const account = await prisma.account.findUnique({
          where: { key: accountKey },
          select: { dealer: true },
        });
        const container = await ensureOfferCampaign({
          accountKey,
          dealer: account?.dealer || accountKey,
          window: runWindow,
          createdByUserId: opts.trigger.userId ?? null,
          createdByRole: opts.trigger.kind === 'manual' ? 'staff' : null,
        });
        campaignId = container.id;
        // Created `building`, or restored — either way it is ours to reset.
        if (!container.created) await setCampaignStatus(campaignId, 'building');
        marked = true;
      }
      if (attachable.length && campaignId) {
        await prisma.adCreative.updateMany({ where: { id: { in: attachable } }, data: { campaignId } });
      }
    }

    // 5. The email — a member of the container, never its cause. Its failure
    //    must not lose the ads.
    if (campaignId && config.emailEnabled) {
      try {
        email = await generateOfferEmail(config, result.generated, { runId, campaignId, cycleKey });
      } catch (err) {
        emailFailure = err instanceof Error ? err.message : String(err);
        console.error(`[offer-run] ${accountKey}: offer email failed:`, err);
      }
    }

    // 6. Who hears about it.
    if (opts.trigger.kind === 'scheduled') await notifyReviewers(config, result.generated, runId);
    if (opts.notifyClients) await notifyClients(config, result.generated, runId, campaignId);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    // 7. Close the row and release the container, whatever happened above.
    const generated = result?.generated ?? [];
    const skipped = result?.skipped ?? [];
    await prisma.adAutomationRun
      .update({
        where: { id: runId },
        data: {
          finishedAt: new Date(),
          scopesChecked: result?.scopesChecked ?? 0,
          offersSeen: result?.offersSeen ?? 0,
          issueCount: skipped.length,
          error,
          detail: JSON.stringify({
            window: { start: runWindow.start.toISOString(), end: runWindow.end.toISOString() },
            cycleKey,
            campaignId,
            trigger: opts.trigger,
            generated,
            skipped,
            email: email
              ? { blastId: email.blastId, reason: email.reason, offers: email.offers, updated: email.updated }
              : emailFailure
                ? { reason: 'failed', message: emailFailure }
                : config.emailEnabled
                  ? null
                  : { reason: 'email_disabled' },
            archivedCampaignIds,
          }),
        },
      })
      .catch((err) => console.warn(`[offer-run] ${accountKey}: could not close run ${runId}:`, err));
    if (marked && campaignId) {
      await setCampaignStatus(campaignId, 'draft').catch(() => {});
    }
  }

  return {
    ...result,
    accountKey,
    runId,
    generated: result.generated,
    skipped: result.skipped,
    cycleKey,
    runWindow,
    campaignId,
    email,
    archivedCampaignIds,
  };
}

/**
 * Every enabled account, on the schedule. An account whose previous run is
 * still open is skipped with a line in the log — the lock is the guarantee,
 * the schedule is not.
 */
export async function generateAllAccounts(now = new Date()): Promise<OfferRunResult[]> {
  let configs: GenerateConfigRow[] = [];
  try {
    configs = (await prisma.adAutomationConfig.findMany({
      where: { enabled: true },
      select: GENERATE_CONFIG_SELECT,
    })) as GenerateConfigRow[];
  } catch (err) {
    console.warn('[offer-run] config table unavailable:', err);
    return [];
  }
  const out: OfferRunResult[] = [];
  for (const config of configs) {
    try {
      out.push(
        await runOfferCampaign(config, { trigger: { kind: 'scheduled' }, notifyClients: true, now }),
      );
    } catch (err) {
      if (err instanceof OfferRunInProgressError) {
        console.warn(`[offer-run] ${config.accountKey}: skipped — run open since ${err.since?.toISOString() ?? 'unknown'}`);
      } else {
        console.error(`[offer-run] ${config.accountKey} failed:`, err);
      }
    }
  }
  return out;
}

// ── notifications ────────────────────────────────────────────────────────────

/** Where a reviewer goes: the staff creative surface. */
const REVIEWER_LINK = '/ad-generator';

/**
 * Tell the reviewers there are drafts waiting. Best-effort, scheduled runs
 * only — the person who clicked Generate IS the reviewer.
 */
async function notifyReviewers(
  config: GenerateConfigRow,
  generated: GeneratedAd[],
  runId: string,
): Promise<void> {
  const fresh = generated.filter((g) => !g.updated);
  if (fresh.length === 0) return;
  const recipients = await resolveReviewers(config);
  if (recipients.length === 0) {
    console.warn(`[offer-run] ${config.accountKey}: ${fresh.length} draft(s) with no one to notify`);
    return;
  }
  const heldBack = generated.filter((g) => g.status === 'draft' && g.warnings.length > 0).length;
  const body =
    `${fresh.length} new draft ad${fresh.length === 1 ? '' : 's'} from OEM offers` +
    (heldBack ? `, ${heldBack} with review notes` : '') +
    '. Nothing publishes until approved.';
  for (const userId of recipients) {
    try {
      await createNotification({
        userId,
        type: 'incentive_ads_ready',
        severity: 'info',
        title: `${fresh.length} offer ad${fresh.length === 1 ? '' : 's'} ready to review`,
        body,
        link: REVIEWER_LINK,
        meta: { accountKey: config.accountKey, runId, count: fresh.length },
        dedupeKey: `adgen:${config.accountKey}:${runId}`,
        dedupeWindowHours: 12,
      });
    } catch (err) {
      console.warn('[offer-run] reviewer notification failed:', err);
    }
  }
}

/**
 * Tell the account's own users their offers are ready.
 *
 * In-app only (no `sendEmailNow`): this fires on every run that produces
 * anything, and dealer email nobody asked for is how a useful feature becomes a
 * complaint. The link goes to the CAMPAIGN — their home — not to the Ad
 * Generator, which redirects them with nothing focused. One per campaign per
 * day: a hand run in the morning and the scheduled run at night that both
 * refresh one campaign are one piece of news.
 */
async function notifyClients(
  config: GenerateConfigRow,
  generated: GeneratedAd[],
  runId: string,
  campaignId: string | null,
): Promise<void> {
  const fresh = generated.filter((g) => !g.updated);
  if (fresh.length === 0) return;
  const recipients = await resolveClientWatchers(config.accountKey);
  if (recipients.length === 0) return;

  const offers = new Set(fresh.map((g) => g.offerGroupKey)).size;
  const choices = new Set(fresh.filter((g) => !g.recommended).map((g) => g.offerGroupKey)).size;
  const title = `${offers} new offer ad${offers === 1 ? '' : 's'} ready to review`;
  const body =
    'New manufacturer offers have been built into ad designs' +
    (choices ? `, with more than one design to choose from on ${choices} of them` : '') +
    '. Nothing runs until you approve it.';
  for (const userId of recipients) {
    try {
      await createNotification({
        userId,
        type: 'incentive_ads_ready',
        severity: 'info',
        title,
        body,
        link: campaignId ? `/campaign-builder/${campaignId}` : '/campaign-builder',
        meta: { accountKey: config.accountKey, runId, campaignId, offers },
        dedupeKey: `adgen-client:${config.accountKey}:${campaignId ?? runId}`,
        dedupeWindowHours: 24,
      });
    } catch (err) {
      console.warn('[offer-run] client notification failed:', err);
    }
  }
}
