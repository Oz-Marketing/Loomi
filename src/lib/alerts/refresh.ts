// Daily pre-alert freshness pass.
//
// The operational scan (scanPacerAlerts) and the rule engine (evaluateAlertRules)
// both evaluate STORED pacerActual. For an account nobody has opened recently,
// that spend can be hours/days stale — so the daily alerts would fire (or stay
// silent) on old numbers. The on-load auto-refresh only freshens an account
// when a human opens its pacer, which doesn't help unattended accounts.
//
// This pulls a fresh Meta sync for every linked account's CURRENT month right
// before the scan, so the daily alerts evaluate accurate spend. It's cheap
// because it runs once a day, and deliberately SEQUENTIAL to stay gentle on the
// shared agency system-user token. Per-account failures are collected and never
// abort the batch.

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
  const result: AlertPreSyncResult = { accountsSynced: 0, skipped: 0, errors: [] };

  if (process.env.META_PACER_ALERT_PRESYNC === 'off') return result;
  if (!isMetaConfigured()) return result; // no token → nothing to pull

  const plans = await prisma.metaAdsPacerPlan.findMany({
    select: {
      id: true,
      accountKey: true,
      account: { select: { metaAdAccountId: true } },
    },
  });

  const nowMs = Date.now();
  for (const plan of plans) {
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
    } catch (err) {
      // A single account's Meta failure (no ad account, rate limit, graph
      // error) must not sink the batch — record it and move on.
      result.errors.push(
        `${accountKey}: ${err instanceof Error ? err.message : 'sync failed'}`,
      );
    }
  }

  return result;
}
