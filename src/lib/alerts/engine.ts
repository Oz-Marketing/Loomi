// §9 — the alert-rule engine. Loads enabled AlertRule config rows and fires
// Notifications off TRUSTED numbers only: every metric is computed through the
// same §0.1/§0.2 machinery the Pacer badge uses, and the firing reuses the
// notification service's dedupe window as the per-rule cooldown. Today only the
// Meta channel + FIXED baseline are evaluable (account pace, campaign budget
// burn); Google-metric rules (rolling/period/duration baselines) become config
// rows once the Google Ads API is connected (§8).

import { prisma } from '@/lib/prisma';
import { getPeriodPlanView, accountTimeZone } from '@/lib/meta-ads-pacer';
import { zonedTodayIso } from '@/lib/timezone';
import {
  computeAccountPace,
  computeBudgetBurnSamples,
} from '@/app/tools/meta/_lib/pacer-calc';
import type { PacerAd } from '@/app/tools/meta/_lib/types';
import { createNotification } from '@/lib/notifications/service';
import type { NotificationType } from '@/lib/notifications/types';
import {
  evaluateRule,
  parseFireCondition,
  parseBaselineParams,
  tierToSeverity,
  type BaselineType,
  type RuleSpec,
} from './rules';

export interface AlertEngineResult {
  rulesEvaluated: number; // (rule × account) / (rule × campaign) checks run
  accountsScanned: number;
  notificationsCreated: number;
  skipped: number; // below the rule's volume gate
  notEvaluable: number; // baseline type can't run yet / malformed condition
  // A rule fired but the account/ad had no owner/designer/rep to notify — the
  // alert would otherwise vanish silently. Surfaced so ops can spot unassigned
  // accounts rather than mistaking "no one assigned" for "all clear".
  firedNoRecipients: number;
  errors: string[];
}

// metric → notification type, for per-user preference toggles + dedupe.
const METRIC_NOTIFICATION_TYPE: Record<string, NotificationType> = {
  account_monthly_pace: 'alert_account_pace',
  campaign_budget_burn: 'alert_budget_burn',
};

interface AdRecipientFields {
  ownerUserId: string | null;
  designerUserId: string | null;
  accountRepUserId: string | null;
}

/** Owner + designer + account-rep user IDs on an ad (mirrors the scan job). */
function adRecipients(ad: AdRecipientFields): string[] {
  const s = new Set<string>();
  if (ad.ownerUserId) s.add(ad.ownerUserId);
  if (ad.designerUserId) s.add(ad.designerUserId);
  if (ad.accountRepUserId) s.add(ad.accountRepUserId);
  return [...s];
}

const round = (n: number) => Math.round(n);

/**
 * Evaluate every enabled Meta-channel alert rule against every account's live
 * month and fire notifications. Idempotent within each rule's cooldown window
 * (the dedupe key is rule+account[+ad]+period), so a daily run won't re-spam a
 * still-true condition. Designed to be called from the daily internal cron.
 */
export async function evaluateAlertRules(): Promise<AlertEngineResult> {
  const result: AlertEngineResult = {
    rulesEvaluated: 0,
    accountsScanned: 0,
    notificationsCreated: 0,
    skipped: 0,
    notEvaluable: 0,
    firedNoRecipients: 0,
    errors: [],
  };

  // All enabled rules across channels; each is scoped to its channel's lines in
  // the loop below. Google rules stay disabled (and thus unloaded) until §8 is
  // connected, but the engine is ready for them the moment they're enabled.
  const rules = await prisma.alertRule.findMany({ where: { enabled: true } });
  if (rules.length === 0) return result;

  // Parse the JSON config once per rule.
  const parsed = rules.map((r) => ({
    row: r,
    spec: {
      baselineType: r.baselineType as BaselineType,
      // A null (malformed) condition becomes a value-less FIXED condition, which
      // evaluateRule reports as not_evaluable — a bad config never fires.
      fireCondition: parseFireCondition(r.fireCondition) ?? { comparator: 'gt' as const },
      minVolumeGate: r.minVolumeGate,
    } as RuleSpec,
    params: parseBaselineParams(r.baselineParams),
    notifType: METRIC_NOTIFICATION_TYPE[r.metric] as NotificationType | undefined,
  }));

  const plans = await prisma.metaAdsPacerPlan.findMany({
    select: { accountKey: true, account: { select: { dealer: true } } },
  });

  const nowMs = Date.now();
  for (const plan of plans) {
    const accountKey = plan.accountKey;
    const dealer = plan.account?.dealer ?? accountKey;
    result.accountsScanned += 1;
    try {
      const tz = await accountTimeZone(accountKey);
      const period = zonedTodayIso(nowMs, tz).slice(0, 7);
      const view = await getPeriodPlanView(accountKey, period, null);
      // Alerts fire on the LIVE month only — a frozen/settled month is done.
      if ('frozen' in view && view.frozen) continue;
      // view.ads carry every MetaAdsPacerAd column (fetchPeriodPlan uses include),
      // so they satisfy both PacerAd and the recipient fields at runtime.
      const allAds = view.ads as unknown as Array<PacerAd & AdRecipientFields>;

      for (const { row, spec, params, notifType } of parsed) {
        if (!notifType) continue; // metric we can't compute on this channel
        // Scope each rule to its own channel's lines — a Meta rule paces over
        // Meta ads (platform null/'meta'), a Google rule over google lines — so
        // the two channels never bleed into each other's account number (§0.4
        // per channel). Recipients come from the same channel's ads.
        const channel = row.channel === 'google' ? 'google' : 'meta';
        const ads = allAds.filter((a) => (a.platform ?? 'meta') === channel);
        const accountRecipients = [...new Set(ads.flatMap((a) => adRecipients(a)))];

        if (row.metric === 'account_monthly_pace') {
          const pace = computeAccountPace(ads, nowMs, tz);
          if (!pace) continue; // nothing pacing — not "under", just inactive
          result.rulesEvaluated += 1;
          const ev = evaluateRule(spec, { value: pace.pct, volume: pace.expected });
          if (ev.status === 'skipped') {
            result.skipped += 1;
            continue;
          }
          if (ev.status === 'not_evaluable') {
            result.notEvaluable += 1;
            continue;
          }
          if (ev.status !== 'fired') continue;
          if (accountRecipients.length === 0) {
            result.firedNoRecipients += 1; // unassigned account — would vanish
            continue;
          }
          const verb = ev.direction === 'high' ? 'over' : 'under';
          result.notificationsCreated += await fireToAll(accountRecipients, {
            type: notifType,
            severity: tierToSeverity(row.tier),
            title: `${dealer}: account pacing ${verb} — ${round(pace.pct)}% of expected`,
            body: `Live-month spend is at ${round(pace.pct)}% of expected-to-date across ${pace.eligibleCount} pacing ad${pace.eligibleCount === 1 ? '' : 's'} (rule: ${row.name}).`,
            link: `/tools/meta-ads-pacer`,
            meta: {
              accountKey,
              period,
              ruleId: row.id,
              metric: row.metric,
              pct: pace.pct,
              direction: ev.direction,
            },
            dedupeKey: `alert:${row.id}:${accountKey}:${period}`,
            dedupeWindowHours: row.cooldownHours,
          });
        } else if (row.metric === 'campaign_budget_burn') {
          const minDaysLeft =
            typeof params.minDaysLeft === 'number' ? params.minDaysLeft : 5;
          const samples = computeBudgetBurnSamples(ads, nowMs, tz);
          for (const sample of samples) {
            // Only an EARLY burn matters — plenty of flight left to exhaust.
            if (sample.daysLeft <= minDaysLeft) continue;
            result.rulesEvaluated += 1;
            const ev = evaluateRule(spec, {
              value: sample.burnPct,
              volume: sample.allocation,
            });
            if (ev.status === 'skipped') {
              result.skipped += 1;
              continue;
            }
            if (ev.status === 'not_evaluable') {
              result.notEvaluable += 1;
              continue;
            }
            if (ev.status !== 'fired') continue;
            const ad = ads.find((a) => a.id === sample.adId);
            const recipients = ad ? adRecipients(ad) : accountRecipients;
            if (recipients.length === 0) {
              result.firedNoRecipients += 1; // unassigned campaign — would vanish
              continue;
            }
            result.notificationsCreated += await fireToAll(recipients, {
              type: notifType,
              severity: tierToSeverity(row.tier),
              title: `${dealer}: "${sample.adName}" burned ${round(sample.burnPct)}% of budget, ${sample.daysLeft}d left`,
              body: `Spend is at ${round(sample.burnPct)}% of this month's allocation with ${sample.daysLeft} flight-days remaining — it may exhaust early (rule: ${row.name}).`,
              link: `/tools/meta-ads-pacer`,
              meta: {
                accountKey,
                period,
                adId: sample.adId,
                ruleId: row.id,
                metric: row.metric,
                burnPct: sample.burnPct,
                daysLeft: sample.daysLeft,
              },
              dedupeKey: `alert:${row.id}:${accountKey}:${sample.adId}:${period}`,
              dedupeWindowHours: row.cooldownHours,
            });
          }
        }
      }
    } catch (err) {
      result.errors.push(
        `${accountKey}: ${err instanceof Error ? err.message : 'eval failed'}`,
      );
    }
  }

  return result;
}

interface FireInput {
  type: NotificationType;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  link: string;
  meta: Record<string, unknown>;
  dedupeKey: string;
  dedupeWindowHours: number;
}

/** Fan a single alert out to each recipient; returns how many actually landed. */
async function fireToAll(recipients: string[], input: FireInput): Promise<number> {
  let created = 0;
  for (const userId of recipients) {
    const n = await createNotification({ userId, ...input });
    if (n) created += 1;
  }
  return created;
}
