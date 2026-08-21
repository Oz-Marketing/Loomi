// Daily pre-alert freshness pass.
//
// The operational scan (scanPacerAlerts) and the rule engine (evaluateAlertRules)
// both evaluate STORED pacerActual. For an account nobody has opened recently,
// that spend can be hours/days stale — so the daily alerts would fire (or stay
// silent) on old numbers. The on-load auto-refresh only freshens an account
// when a human opens its pacer, which doesn't help unattended accounts.
//
// This pulls a fresh Meta sync for linked accounts' CURRENT month right before
// the scan, so the daily alerts evaluate accurate spend. Deliberately
// SEQUENTIAL to stay gentle on the shared agency system-user token.
// Per-account failures are collected and never abort the batch.
//
// ── Why it works to a BUDGET ──
//
// It used to walk every plan unconditionally. That is O(accounts x Meta
// latency) inside a single HTTP request, and the whole scan sits behind a 60s
// gateway, so past a certain number of linked accounts the request was killed
// mid-loop — and the ALERTS never ran at all. Production returned 504 four days
// running: no pace alerts, no budget-burn alerts, nothing, because an
// optimisation was starving the work it exists to improve.
//
// So: spend at most `budgetMs` here, refresh the stalest accounts first, and
// hand the rest of the request back to the passes that actually notify people.
// A partially-fresh dataset beats a fresh one nobody ever evaluates, and
// stalest-first means the backlog rotates instead of the tail being starved.

import { prisma } from '@/lib/prisma';
import {
  accountTimeZone,
  isPeriodWritable,
  reconcileCompletedRuns,
} from '@/lib/meta-ads-pacer';
import { isMetaConfigured, syncPeriodFromMeta } from '@/lib/integrations/meta-ads';
import { zonedTodayIso } from '@/lib/timezone';

export interface AlertPreSyncResult {
  accountsSynced: number;
  skipped: number;
  errors: string[];
  /** Plans left unvisited because the budget ran out — the rotation backlog. */
  deferred: number;
  /** How long the pass actually took, so the caller can log the fit. */
  elapsedMs: number;
}

/**
 * Wall-clock budget for the pre-sync. The rest of the scan is DB-only but not
 * free, so this leaves the bulk of a 60s gateway window to it.
 *
 * `META_PACER_ALERT_PRESYNC_BUDGET_MS` tunes it without a deploy — raise it if
 * the gateway timeout is raised too, lower it if the scan starts running close.
 */
function budgetMs(): number {
  const raw = Number(process.env.META_PACER_ALERT_PRESYNC_BUDGET_MS);
  return Number.isFinite(raw) && raw >= 1000 ? Math.floor(raw) : 25_000;
}

/**
 * Sync every Meta-linked account's current month from Meta so the daily alert
 * scan evaluates fresh spend. Mirrors the manual-sync sequence (pull spend,
 * then auto-complete ended ads) but writes NO "Synced from Meta" audit entry —
 * calling the lib directly (not the HTTP route) skips that, so a daily refresh
 * doesn't flood the change log. Reconciliation still logs real status flips.
 *
 * Kill switch: set META_PACER_ALERT_PRESYNC=off to disable without a deploy if
 * Meta rate limits ever get tight (the scan then just runs on stored data, as
 * it did before).
 */
export async function refreshLinkedAccountsForAlerts(): Promise<AlertPreSyncResult> {
  const startedAt = Date.now();
  const result: AlertPreSyncResult = {
    accountsSynced: 0,
    skipped: 0,
    errors: [],
    deferred: 0,
    elapsedMs: 0,
  };

  if (process.env.META_PACER_ALERT_PRESYNC === 'off') return result;
  if (!isMetaConfigured()) return result; // no token → nothing to pull

  // Stalest first, nulls before any timestamp: an account never pre-synced
  // outranks one done yesterday, so the rotation covers everyone over time.
  const plans = await prisma.metaAdsPacerPlan.findMany({
    orderBy: [{ alertPreSyncAt: { sort: 'asc', nulls: 'first' } }],
    select: {
      id: true,
      accountKey: true,
      alertPreSyncAt: true,
      account: { select: { metaAdAccountId: true } },
    },
  });

  const deadline = startedAt + budgetMs();
  const nowMs = Date.now();
  for (const [index, plan] of plans.entries()) {
    // Out of budget: leave the remainder for tomorrow's run, which will see
    // them as the stalest and take them first.
    if (Date.now() >= deadline) {
      result.deferred = plans.length - index;
      break;
    }
    const { accountKey } = plan;
    // Only accounts linked to a Meta ad account have anything to pull.
    if (!plan.account?.metaAdAccountId?.trim()) {
      result.skipped += 1;
      continue;
    }
    try {
      const tz = await accountTimeZone(accountKey);
      const todayIso = zonedTodayIso(nowMs, tz);
      const period = todayIso.slice(0, 7); // the account's live month
      // The engine only alerts on the live month; don't re-sync a frozen one.
      if (!(await isPeriodWritable(accountKey, plan.id, period))) {
        result.skipped += 1;
        continue;
      }
      // syncPeriodFromMeta early-returns (no Graph calls) when the period has no
      // ads, so accounts with nothing planned this month stay cheap.
      const sync = await syncPeriodFromMeta(accountKey, period, todayIso);
      // Auto-complete ads whose flight has ended, so a finished ad isn't paced
      // against — parity with the GET/sync-meta path that attended accounts get.
      await reconcileCompletedRuns(accountKey, plan.id, period, null);
      if (sync.matched > 0) result.accountsSynced += 1;
      else result.skipped += 1;
      // Stamp only on a real attempt, so a failure retries tomorrow rather
      // than going to the back of the queue.
      await prisma.metaAdsPacerPlan.update({
        where: { id: plan.id },
        data: { alertPreSyncAt: new Date() },
      });
    } catch (err) {
      // A single account's Meta failure (no ad account, rate limit, graph
      // error) must not sink the batch — record it and move on.
      result.errors.push(
        `${accountKey}: ${err instanceof Error ? err.message : 'sync failed'}`,
      );
    }
  }

  result.elapsedMs = Date.now() - startedAt;
  return result;
}
