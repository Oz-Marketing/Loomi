/**
 * The pacer autosave payload and the two guards that keep it pointed at the
 * right month.
 *
 * `PUT /api/meta-ads-pacer/[accountKey]?period=YYYY-MM` is a FULL REPLACE for
 * that (plan, period, platform): every ad row of the period that isn't in the
 * payload is deleted, and every row that is gets `period` written to the
 * target. So saving one month's rows against another month is doubly
 * destructive — it wipes the target month's rows AND re-parents the source
 * month's rows into it, emptying the source too. The client can drift into
 * that state whenever the plan in local state is not the plan the selected
 * month is showing (an out-of-order load, a failed load that left the previous
 * month behind, a sync response that landed after the user moved on), so the
 * alignment check below gates the save and the row check below gates the write.
 */

import type { PacerAd, PacerPlan } from './types';

/** The autosave body: budget goals + the period's full ad set, re-positioned. */
export function serializePlanSave(plan: PacerPlan): string {
  return JSON.stringify({
    baseBudgetGoal: plan.baseBudgetGoal,
    addedBudgetGoal: plan.addedBudgetGoal,
    // Position is the rendered order; period is the plan's OWN period, never a
    // separately-held selection that may have moved on.
    ads: plan.ads.map((ad: PacerAd, i: number) => ({
      ...ad,
      position: i,
      period: plan.period,
    })),
  });
}

/**
 * True when the plan held in state is the one this account + month is showing,
 * i.e. when it is safe to save. A mismatch is never something to "fix up" by
 * saving to the plan's own period either — the rows on screen belong to a view
 * the user has already left, so the only safe move is to skip the save and let
 * the in-flight load own the next one.
 */
export function isPlanAlignedWith(
  plan: Pick<PacerPlan, 'accountKey' | 'period'> | null,
  accountKey: string | null,
  period: string,
): boolean {
  if (!plan || !accountKey) return false;
  return plan.accountKey === accountKey && plan.period === period;
}

/** Where an existing ad row actually lives, for the server-side write guard. */
export interface AdRowOwner {
  id: string;
  planId: string;
  period: string;
  platform: string | null;
}

/**
 * The incoming rows that already exist somewhere OTHER than the save's target
 * scope. Non-empty means the request would move rows between months, accounts,
 * or platforms — always a stale-client bug, never a legitimate edit, since no
 * other code path re-parents an ad row.
 */
export function misplacedAdRows(
  rows: AdRowOwner[],
  target: { planId: string; period: string; platform: 'meta' | 'google' },
): AdRowOwner[] {
  return rows.filter(
    (row) =>
      row.planId !== target.planId ||
      row.period !== target.period ||
      (row.platform === 'google') !== (target.platform === 'google'),
  );
}
