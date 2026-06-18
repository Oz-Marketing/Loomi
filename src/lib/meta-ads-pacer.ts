import type { Session } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { s3PublicUrl } from '@/lib/s3';
import { resolveAccountTimeZone, zonedTodayIso } from '@/lib/timezone';
// Carryover threshold + active-status set, shared with the planner so server
// and client agree.
import {
  CARRYOVER_THRESHOLD,
  ACTIVE_STATUSES,
} from '@/app/tools/meta/_lib/constants';
// §0.1: the ONE markup resolution + spend-target formula (no hardcoded
// literal); the agency default comes from admin settings (DB-backed).
import {
  accountMarginSetting,
  effectiveSpendTarget,
} from '@/app/tools/meta/_lib/markup';
import { getGlobalDefaultMarkup } from '@/lib/services/markup';
// §3: the ONE "lifetime ad still running" predicate, shared with the client so
// the over/under base excludes the same ads everywhere.
import {
  isLifetimeInProgress,
  effectiveActual,
  classifyAdVariance,
} from '@/app/tools/meta/_lib/pacer-calc';
import { writeAudit } from '@/lib/meta-ads-audit';

function attachUrl<T extends { attachmentKey: string | null }>(entry: T): T & { attachmentUrl: string | null } {
  let attachmentUrl: string | null = null;
  if (entry.attachmentKey) {
    try {
      attachmentUrl = s3PublicUrl(entry.attachmentKey);
    } catch {
      attachmentUrl = null;
    }
  }
  return { ...entry, attachmentUrl };
}

export const PACER_DEPARTMENTS = [
  'Web Development',
  'Digital',
  'Graphic Design',
  'Account Representative',
] as const;

export type PacerDepartment = (typeof PACER_DEPARTMENTS)[number];

/**
 * Allow developers, super_admins, and admins to use the pacer.
 * Admin access is further scoped by their assigned accountKeys.
 */
export function canAccessPacer(
  session: Session | null,
  accountKey: string,
): boolean {
  if (!session?.user) return false;
  const { role, accountKeys = [] } = session.user;
  if (role !== 'developer' && role !== 'super_admin' && role !== 'admin') return false;
  if (role === 'developer' || role === 'super_admin') return true;
  // Unrestricted admin (no assigned accounts) = full access
  if (accountKeys.length === 0) return true;
  return accountKeys.includes(accountKey);
}

/**
 * Find or create the plan row for a given account key.
 */
export async function getOrCreatePlan(accountKey: string) {
  const existing = await prisma.metaAdsPacerPlan.findUnique({
    where: { accountKey },
  });
  if (existing) return existing;
  return prisma.metaAdsPacerPlan.create({
    data: { accountKey },
  });
}

/**
 * Pull the full plan with ads + nested children, ordered for the UI.
 */
export async function fetchPlanWithRelations(planId: string) {
  return prisma.metaAdsPacerPlan.findUnique({
    where: { id: planId },
    include: {
      ads: {
        orderBy: { position: 'asc' },
        include: {
          designNotes: { orderBy: { createdAt: 'asc' } },
          activityLog: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });
}

/** Validates a YYYY-MM string. */
export function isValidPeriod(period: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return false;
  const year = Number(period.slice(0, 4));
  return year >= 2000 && year <= 2100;
}

/** Pull the budget + ads for a single period. */
export async function fetchPeriodPlan(planId: string, period: string) {
  // Pull the parent plan so we can surface the account's markup override
  // (Account.markup) and resolved pacing timezone alongside the period data.
  // The calculator needs markup to translate Client Budget inputs into actual
  // spend; the Pacer needs the timezone for its time-left math.
  const [budget, ads, plan, globalDefaultMarkup] = await Promise.all([
    prisma.metaAdsPacerPeriodBudget.findUnique({
      where: { planId_period: { planId, period } },
    }),
    prisma.metaAdsPacerAd.findMany({
      where: { planId, period },
      orderBy: { position: 'asc' },
      include: {
        designNotes: { orderBy: { createdAt: 'asc' } },
        activityLog: { orderBy: { createdAt: 'asc' } },
      },
    }),
    prisma.metaAdsPacerPlan.findUnique({
      where: { id: planId },
      select: {
        account: {
          select: { markup: true, metaTimezone: true, timezone: true },
        },
      },
    }),
    getGlobalDefaultMarkup(),
  ]);
  // Resolve tz + "now" once so each ad can carry a §3 lifetime-in-progress flag
  // computed against the account's clock (the same predicate the over/under
  // base uses, so the client never re-derives it).
  const tz = resolveAccountTimeZone(
    plan?.account?.metaTimezone,
    plan?.account?.timezone,
  );
  const nowMs = Date.now();
  return {
    baseBudgetGoal: budget?.baseBudgetGoal ?? null,
    addedBudgetGoal: budget?.addedBudgetGoal ?? null,
    // Opt-in carryover applied to each bucket's DERIVED spend target (Change 7).
    baseCarryover: budget?.baseCarryover ?? null,
    addedCarryover: budget?.addedCarryover ?? null,
    // §0.1: resolved at this single boundary — Account.markup override, else
    // the agency default — so every consumer (client + getPriorOverUnder) gets
    // a concrete factor and never re-resolves or holds a literal.
    markup: accountMarginSetting(plan?.account?.markup ?? null, globalDefaultMarkup),
    // Meta zone if cached, else a valid hand-entered zone, else the default.
    timeZone: tz,
    ads: ads.map((ad) => ({
      ...ad,
      // §3: lifetime ad still running — the Over/Under view excludes it from the
      // settle-able base while it runs (it still shows in total spend).
      lifetimeInProgress: isLifetimeInProgress(ad, nowMs, tz),
      // Cross-month clarity: this ad's over/under contribution + WHY it differs
      // from plan (real vs cross-month timing). Computed here so the Pacer card,
      // the Over/Under page, and reconciliation all agree (§0.4).
      variance: classifyAdVariance(ad, period, nowMs, tz),
      activityLog: ad.activityLog.map(attachUrl),
    })),
  };
}

/** Add the attachment URL to an activity entry before returning it to the client. */
export function decorateActivityEntry<T extends { attachmentKey: string | null }>(entry: T) {
  return attachUrl(entry);
}

// ─── Live-vs-frozen month model (Change 5) ─────────────────────────────────

/** Days after month-end a month stays live before it freezes. */
export const PACER_FREEZE_GRACE_DAYS = 5;

export type MonthState = 'current' | 'grace' | 'closed' | 'future';

/** The YYYY-MM immediately before `period`. */
function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Classify a pacing month relative to "now" in the account's timezone:
 * future/current months and the just-ended month within the grace window are
 * live (editable, syncable); anything older is closed (frozen). YYYY-MM
 * strings compare chronologically.
 */
export function monthState(period: string, timeZone: string): MonthState {
  const todayIso = zonedTodayIso(Date.now(), timeZone);
  const curPeriod = todayIso.slice(0, 7);
  const dayOfMonth = Number(todayIso.slice(8, 10));
  if (period > curPeriod) return 'future';
  if (period === curPeriod) return 'current';
  if (
    period === previousPeriod(curPeriod) &&
    dayOfMonth <= PACER_FREEZE_GRACE_DAYS
  ) {
    return 'grace';
  }
  return 'closed';
}

/** Resolve an account's pacing timezone (Meta zone → stored zone → default). */
export async function accountTimeZone(accountKey: string): Promise<string> {
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { metaTimezone: true, timezone: true },
  });
  return resolveAccountTimeZone(account?.metaTimezone, account?.timezone);
}

/**
 * Meta status sync (Change 11) — auto-complete only the unambiguous case: a
 * live ad whose actual flight end has passed reached its scheduled finish, so
 * mark it "Completed Run". Everything else (paused/off mid-flight) is left for
 * a human to confirm via the in-app prompt — Meta "paused" can mean a daily
 * cap or billing hold, not that the run is over. Uses the ad's REAL end (Meta
 * end, else planned), never the month-clamped end. Returns rows changed.
 */
export async function reconcileCompletedRuns(
  accountKey: string,
  planId: string,
  period: string,
  userId: string | null,
): Promise<number> {
  const tz = await accountTimeZone(accountKey);
  const todayIso = zonedTodayIso(Date.now(), tz);
  const ads = await prisma.metaAdsPacerAd.findMany({
    where: { planId, period, adStatus: { in: [...ACTIVE_STATUSES] } },
    select: {
      id: true,
      name: true,
      adStatus: true,
      flightEnd: true,
      metaEndDate: true,
    },
  });
  const toComplete = ads.filter((a) => {
    const end = a.metaEndDate ?? a.flightEnd;
    return end != null && todayIso > end; // strictly past the last flight day
  });
  if (toComplete.length === 0) return 0;

  await prisma.metaAdsPacerAd.updateMany({
    where: { id: { in: toComplete.map((a) => a.id) } },
    data: { adStatus: 'Completed Run' },
  });
  await writeAudit(
    toComplete.map((a) => ({
      accountKey,
      planId,
      period,
      adId: a.id,
      adName: a.name,
      action: 'edit',
      field: 'adStatus',
      fromValue: a.adStatus,
      toValue: 'Completed Run',
      summary: `${a.name || 'Ad'}: auto-marked Completed Run (flight ended ${a.metaEndDate ?? a.flightEnd})`,
      authorUserId: userId,
    })),
  );
  return toComplete.length;
}

/** Parse a stored snapshot payload and refresh its (expiring) attachment URLs. */
function reviveSnapshotPayload(payloadJson: string) {
  const payload = JSON.parse(payloadJson);
  if (Array.isArray(payload?.ads)) {
    payload.ads = payload.ads.map(
      (ad: { activityLog?: { attachmentKey: string | null }[] }) => ({
        ...ad,
        activityLog: Array.isArray(ad.activityLog)
          ? ad.activityLog.map(attachUrl)
          : [],
      }),
    );
  }
  return payload;
}

/**
 * A closed month is writable only if an admin has explicitly reopened it.
 * current / grace / future months are always writable. Used to guard the
 * save and sync routes so a frozen month can't be mutated.
 */
export async function isPeriodWritable(
  accountKey: string,
  planId: string,
  period: string,
): Promise<boolean> {
  const tz = await accountTimeZone(accountKey);
  if (monthState(period, tz) !== 'closed') return true;
  const snap = await prisma.metaAdsPacerMonthSnapshot.findUnique({
    where: { planId_period: { planId, period } },
  });
  return !!snap && snap.reopenedAt != null;
}

/**
 * Load a period for viewing with the live-vs-frozen model applied:
 * - closed + frozen snapshot → serve the immutable snapshot (read-only).
 * - closed + no snapshot yet → lazily freeze (snapshot current data) and serve.
 * - closed + reopened → serve live, editable.
 * - current / grace / future → serve live.
 * The returned shape extends fetchPeriodPlan's payload with frozen/monthState.
 */
export async function getPeriodPlanView(
  accountKey: string,
  period: string,
  userId: string | null,
) {
  const plan = await getOrCreatePlan(accountKey);
  const tz = await accountTimeZone(accountKey);
  const state = monthState(period, tz);

  if (state === 'closed') {
    const snap = await prisma.metaAdsPacerMonthSnapshot.findUnique({
      where: { planId_period: { planId: plan.id, period } },
    });
    if (snap && snap.reopenedAt == null) {
      return {
        ...reviveSnapshotPayload(snap.payloadJson),
        frozen: true,
        frozenAt: snap.frozenAt.toISOString(),
        monthState: state,
      };
    }
    if (!snap) {
      // Lazy freeze: capture the settled month exactly once, on first view.
      // Two concurrent first-views can race the unique [planId, period]; if we
      // lose, fall back to reading the snapshot the other request created.
      const payload = await fetchPeriodPlan(plan.id, period);
      try {
        const created = await prisma.metaAdsPacerMonthSnapshot.create({
          data: {
            planId: plan.id,
            period,
            payloadJson: JSON.stringify(payload),
            frozenByUserId: userId,
          },
        });
        return {
          ...payload,
          frozen: true,
          frozenAt: created.frozenAt.toISOString(),
          monthState: state,
        };
      } catch {
        const winner = await prisma.metaAdsPacerMonthSnapshot.findUnique({
          where: { planId_period: { planId: plan.id, period } },
        });
        if (winner && winner.reopenedAt == null) {
          return {
            ...reviveSnapshotPayload(winner.payloadJson),
            frozen: true,
            frozenAt: winner.frozenAt.toISOString(),
            monthState: state,
          };
        }
        // Reopened in the meantime (or still unreadable) — serve live.
        return { ...payload, frozen: false, reopened: !!winner, monthState: state };
      }
    }
    // Reopened by an admin — serve live rows so corrections are visible.
    return {
      ...(await fetchPeriodPlan(plan.id, period)),
      frozen: false,
      reopened: true,
      monthState: state,
    };
  }

  return {
    ...(await fetchPeriodPlan(plan.id, period)),
    frozen: false,
    monthState: state,
  };
}

// ─── Carryover (Change 7) ──────────────────────────────────────────────────

export interface PriorOverUnder {
  period: string; // the prior month (YYYY-MM)
  clientBudget: number; // combined gross (Base + Added)
  spendTarget: number; // combined gross × markup
  actual: number; // combined actual spend
  variance: number; // actual − spendTarget (negative = underspent)
  carryover: number; // −variance: +ve means "spend this much more next month"
  exceedsThreshold: boolean;
}

/**
 * The prior month's over/under, for the carryover prompt on a live month.
 * Only returns a value once the prior month is CLOSED (settled) — in-progress
 * months never look like an over/underspend. Reads the prior month's frozen
 * record (variance is measured against ITS OWN original target × markup, never
 * an adjusted one), so each month stays independently auditable.
 *
 * NOTE: called from the route AFTER getPeriodPlanView, never from inside it —
 * it calls getPeriodPlanView(prior), so nesting it would recurse.
 */
export async function getPriorOverUnder(
  accountKey: string,
  period: string,
  userId: string | null,
): Promise<PriorOverUnder | null> {
  const tz = await accountTimeZone(accountKey);
  const prior = previousPeriod(period);
  if (monthState(prior, tz) !== 'closed') return null;

  const view = await getPeriodPlanView(accountKey, prior, userId);
  const baseGoal = Number(view.baseBudgetGoal ?? 0);
  const addedGoal = Number(view.addedBudgetGoal ?? 0);
  const clientBudget =
    (isNaN(baseGoal) ? 0 : baseGoal) + (isNaN(addedGoal) ? 0 : addedGoal);
  // view.markup is already the resolved factor (fetchPeriodPlan boundary, §0.1).
  const spendTarget = effectiveSpendTarget(clientBudget, view.markup ?? 0);
  // §2: a resolved straddler counts its full run in its own month.
  const actual = (view.ads ?? []).reduce(
    (
      s: number,
      a: {
        period: string;
        pacerActual?: string | null;
        pacerRunSpend?: string | null;
        allocation?: string | null;
        fullRunAppliedToMonth?: string | null;
      },
    ) => s + effectiveActual(a),
    0,
  );
  const variance = actual - spendTarget;
  return {
    period: prior,
    clientBudget,
    spendTarget,
    actual,
    variance,
    carryover: -variance,
    exceedsThreshold: Math.abs(variance) >= CARRYOVER_THRESHOLD,
  };
}

/**
 * Apply (or clear) the PRIOR month's over/under as a carryover into a live
 * month's bucket (the Phase 1 planner banner). The amount is recomputed
 * server-side from the prior month's settled over/under so it can't be
 * tampered with; `clear` removes it.
 *
 * The ledger (MetaAdsPacerCarryoverApplication) is the source of truth: this
 * writes a prior→period ledger row and then recomputes the period's
 * baseCarryover/addedCarryover columns (a derived cache the pacing math reads).
 * Routing the banner through the same ledger as the Reconciliation view keeps
 * the two in sync and prevents the prior month being double-counted.
 */
export async function setCarryover(
  accountKey: string,
  planId: string,
  period: string,
  bucket: 'base' | 'added',
  clear: boolean,
  userId: string | null,
): Promise<{ applied: number }> {
  const prior = previousPeriod(period);
  // Clear any existing prior→period application first — covers both an explicit
  // clear and a bucket switch (re-apply lands in the newly chosen bucket).
  await prisma.metaAdsPacerCarryoverApplication.deleteMany({
    where: { planId, sourceMonth: prior, targetMonth: period },
  });
  let applied = 0;
  if (!clear) {
    const po = await getPriorOverUnder(accountKey, period, userId);
    if (!po) throw new Error('No settled prior month to carry over from.');
    applied = Math.round(po.carryover * 100) / 100;
    await prisma.metaAdsPacerCarryoverApplication.create({
      data: {
        planId,
        bucket,
        sourceMonth: prior,
        targetMonth: period,
        amount: applied.toFixed(2),
        appliedByUserId: userId,
      },
    });
  }
  await recomputeCarryoverColumns(planId, period);
  return { applied };
}

/**
 * Recompute a target month's baseCarryover/addedCarryover columns from the
 * ledger (Σ applied amounts per bucket landing in that month). Called after any
 * ledger mutation so the cached columns the pacing math reads stay correct.
 */
async function recomputeCarryoverColumns(
  planId: string,
  targetMonth: string,
): Promise<void> {
  const entries = await prisma.metaAdsPacerCarryoverApplication.findMany({
    where: { planId, targetMonth },
    select: { bucket: true, amount: true },
  });
  let base = 0;
  let added = 0;
  for (const e of entries) {
    const a = Number(e.amount ?? 0);
    if (isNaN(a)) continue;
    if (e.bucket === 'added') added += a;
    else base += a;
  }
  const baseVal = base !== 0 ? base.toFixed(2) : null;
  const addedVal = added !== 0 ? added.toFixed(2) : null;
  await prisma.metaAdsPacerPeriodBudget.upsert({
    where: { planId_period: { planId, period: targetMonth } },
    create: {
      planId,
      period: targetMonth,
      baseCarryover: baseVal,
      addedCarryover: addedVal,
    },
    update: { baseCarryover: baseVal, addedCarryover: addedVal },
  });
}

/** Re-snapshot a period and clear any reopen flag (manual / re-freeze). */
export async function freezeMonth(
  planId: string,
  period: string,
  userId: string | null,
) {
  const payload = await fetchPeriodPlan(planId, period);
  return prisma.metaAdsPacerMonthSnapshot.upsert({
    where: { planId_period: { planId, period } },
    create: {
      planId,
      period,
      payloadJson: JSON.stringify(payload),
      frozenByUserId: userId,
    },
    update: {
      payloadJson: JSON.stringify(payload),
      frozenAt: new Date(),
      frozenByUserId: userId,
      reopenedAt: null,
      reopenedByUserId: null,
    },
  });
}

/**
 * Admin reopen: mark a frozen month editable while preserving the original
 * frozen snapshot as the historical record. If no snapshot exists yet, capture
 * the current state first so there's still a pre-edit record.
 */
export async function reopenMonth(
  planId: string,
  period: string,
  userId: string | null,
) {
  const existing = await prisma.metaAdsPacerMonthSnapshot.findUnique({
    where: { planId_period: { planId, period } },
  });
  if (existing) {
    return prisma.metaAdsPacerMonthSnapshot.update({
      where: { id: existing.id },
      data: { reopenedAt: new Date(), reopenedByUserId: userId },
    });
  }
  const payload = await fetchPeriodPlan(planId, period);
  return prisma.metaAdsPacerMonthSnapshot.create({
    data: {
      planId,
      period,
      payloadJson: JSON.stringify(payload),
      frozenByUserId: userId,
      reopenedAt: new Date(),
      reopenedByUserId: userId,
    },
  });
}

/**
 * Returns the list of account keys this user can pace for. Mirrors the same
 * gating logic as `canAccessPacer` but in plural form.
 */
export function accessibleAccountKeys(
  session: Session | null,
  allAccountKeys: string[],
): string[] {
  if (!session?.user) return [];
  const { role, accountKeys = [] } = session.user;
  if (role !== 'developer' && role !== 'super_admin' && role !== 'admin') return [];
  if (role === 'developer' || role === 'super_admin') return allAccountKeys;
  if (accountKeys.length === 0) return allAccountKeys;
  return allAccountKeys.filter((k) => accountKeys.includes(k));
}

/**
 * Build the admin overview payload for a single period across many accounts.
 * One row per account: dealer name + period budgets + ads (with notes/log).
 */
export async function fetchOverview(accountKeys: string[], period: string) {
  if (accountKeys.length === 0) return [];

  const [accounts, plans, globalDefaultMarkup] = await Promise.all([
    prisma.account.findMany({
      where: { key: { in: accountKeys } },
      select: { key: true, dealer: true, markup: true },
    }),
    prisma.metaAdsPacerPlan.findMany({
      where: { accountKey: { in: accountKeys } },
      select: { id: true, accountKey: true },
    }),
    getGlobalDefaultMarkup(),
  ]);

  const planByKey = new Map(plans.map((p) => [p.accountKey, p.id]));
  const planIds = plans.map((p) => p.id);

  const [budgets, ads, noteCounts] = await Promise.all([
    planIds.length > 0
      ? prisma.metaAdsPacerPeriodBudget.findMany({
          where: { planId: { in: planIds }, period },
        })
      : Promise.resolve([]),
    planIds.length > 0
      ? prisma.metaAdsPacerAd.findMany({
          where: { planId: { in: planIds }, period },
          orderBy: { position: 'asc' },
          include: {
            designNotes: { orderBy: { createdAt: 'asc' } },
            activityLog: { orderBy: { createdAt: 'asc' } },
          },
        })
      : Promise.resolve([]),
    // Aggregate account-level note counts (scoped to this month) in one
    // round-trip so the overview can render the chat badges without N fetches.
    prisma.metaAdsPacerAccountNote.groupBy({
      by: ['accountKey'],
      where: { accountKey: { in: accountKeys }, period },
      _count: { _all: true },
    }),
  ]);

  const budgetByPlanId = new Map(budgets.map((b) => [b.planId, b]));
  const adsByPlanId = new Map<string, typeof ads>();
  for (const ad of ads) {
    const arr = adsByPlanId.get(ad.planId) ?? [];
    arr.push(ad);
    adsByPlanId.set(ad.planId, arr);
  }
  const noteCountByKey = new Map(
    noteCounts.map((row) => [row.accountKey, row._count._all]),
  );

  return accounts
    .map((acct) => {
      const planId = planByKey.get(acct.key);
      const budget = planId ? budgetByPlanId.get(planId) : null;
      const acctAds = planId ? (adsByPlanId.get(planId) ?? []) : [];
      return {
        accountKey: acct.key,
        dealer: acct.dealer,
        // §0.1: resolved per-account factor for the overview gross-up display.
        markup: accountMarginSetting(acct.markup, globalDefaultMarkup),
        baseBudgetGoal: budget?.baseBudgetGoal ?? null,
        addedBudgetGoal: budget?.addedBudgetGoal ?? null,
        notesCount: noteCountByKey.get(acct.key) ?? 0,
        ads: acctAds.map((ad) => ({
          ...ad,
          activityLog: ad.activityLog.map(attachUrl),
        })),
      };
    })
    .sort((a, b) => a.dealer.localeCompare(b.dealer));
}

export interface YearMonthSummary {
  period: string; // YYYY-MM
  clientBudget: number; // Σ gross (base + added) across accounts — context only
  spendTarget: number; // Σ (gross × account markup) — the variance basis
  actual: number; // Σ pacerActual across ads in this month
}

/**
 * Build per-month spend-vs-target rows for one or more accounts across a
 * calendar year. Variance is measured against the margin-adjusted spend
 * target (client budget × markup), NOT the gross client budget — otherwise
 * the agency margin reads as underspend (Change 6). Markup is per-account, so
 * it must be applied to each account's budget BEFORE summing across accounts.
 * Months with no plan data return zeros so the caller renders a full 12 rows.
 */
export async function fetchYearSummary(
  accountKeys: string[],
  year: number,
): Promise<YearMonthSummary[]> {
  const periods = Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, '0');
    return `${year}-${m}`;
  });
  const zero = (period: string): YearMonthSummary => ({
    period,
    clientBudget: 0,
    spendTarget: 0,
    actual: 0,
  });

  if (accountKeys.length === 0) return periods.map(zero);

  const [plans, globalDefaultMarkup] = await Promise.all([
    prisma.metaAdsPacerPlan.findMany({
      where: { accountKey: { in: accountKeys } },
      select: { id: true, account: { select: { markup: true } } },
    }),
    getGlobalDefaultMarkup(),
  ]);
  const planIds = plans.map((p) => p.id);
  if (planIds.length === 0) return periods.map(zero);

  // planId → effective markup (per-account override, else global default).
  const markupByPlan = new Map(
    plans.map((p) => [
      p.id,
      accountMarginSetting(p.account?.markup, globalDefaultMarkup),
    ]),
  );

  const [budgets, ads] = await Promise.all([
    prisma.metaAdsPacerPeriodBudget.findMany({
      where: { planId: { in: planIds }, period: { in: periods } },
      select: {
        planId: true,
        period: true,
        baseBudgetGoal: true,
        addedBudgetGoal: true,
      },
    }),
    prisma.metaAdsPacerAd.findMany({
      where: { planId: { in: planIds }, period: { in: periods } },
      select: { period: true, pacerActual: true },
    }),
  ]);

  const grossByPeriod = new Map<string, number>();
  const targetByPeriod = new Map<string, number>();
  for (const b of budgets) {
    const base = Number(b.baseBudgetGoal ?? 0);
    const added = Number(b.addedBudgetGoal ?? 0);
    const gross = (isNaN(base) ? 0 : base) + (isNaN(added) ? 0 : added);
    const markup = markupByPlan.get(b.planId) ?? globalDefaultMarkup;
    grossByPeriod.set(b.period, (grossByPeriod.get(b.period) ?? 0) + gross);
    targetByPeriod.set(
      b.period,
      (targetByPeriod.get(b.period) ?? 0) + effectiveSpendTarget(gross, markup),
    );
  }

  const actualByPeriod = new Map<string, number>();
  for (const a of ads) {
    if (a.pacerActual == null) continue;
    const n = Number(a.pacerActual);
    if (isNaN(n)) continue;
    actualByPeriod.set(a.period, (actualByPeriod.get(a.period) ?? 0) + n);
  }

  return periods.map((period) => ({
    period,
    clientBudget: grossByPeriod.get(period) ?? 0,
    spendTarget: targetByPeriod.get(period) ?? 0,
    actual: actualByPeriod.get(period) ?? 0,
  }));
}

// ─── Year reconciliation (Phase 2b) ─────────────────────────────────────────

export interface ReconAdVariance {
  name: string;
  /** effectiveActual − effectiveTarget for the month ($0 for in-progress lifetime). */
  contribution: number;
  klass: 'real' | 'timing-straddler' | 'timing-lifetime';
  /** In-progress lifetime: spend done this month, held out of the over/under. */
  heldOutSpend: number;
}

export interface ReconciliationMonth {
  period: string; // YYYY-MM
  state: MonthState;
  /** No tracked ads — actual comes from the backfilled historicalActual. */
  isBackfilled: boolean;
  /** A client budget (target) is set for this month. */
  hasTarget: boolean;
  /** Actual spend data exists (tracked ads or a backfilled figure). */
  hasActual: boolean;
  clientBudget: number; // gross (base + added) client budget
  spendTarget: number; // clientBudget × markup — the base (pre-carryover) target
  /**
   * Spend target including carryover applied INTO this month (spendTarget +
   * appliedIn) — matches the Pacer's adjusted target. Only the live month
   * receives carryover; for every other month this equals spendTarget.
   */
  adjustedSpendTarget: number;
  actual: number; // Σ pacerActual, or historicalActual for backfilled months
  variance: number; // actual − adjustedSpendTarget (>0 overspent, <0 underspent)
  carryover: number; // −variance (>0 = "spend this much more", <0 = "less")
  exceedsThreshold: boolean;
  appliedOut: number; // Σ ledger amount sourced FROM this month (consumed)
  unapplied: number; // carryover − appliedOut (still reconcilable)
  appliedIn: number; // Σ ledger amount applied INTO this month
  /**
   * §3: this month has ≥1 LIFETIME ad still running — excluded from the
   * over/under base (its variance books once when the run completes). Drives
   * the 'lifetime · in progress' badge and explains why, for the live month,
   * total spend can differ from the settle-able over/under.
   */
  hasLifetimeInProgress: boolean;
  /** CM4: per-ad over/under contributions for this month — powers the
   *  Reconciliation row drill-down (which ads drove the variance). */
  ads: ReconAdVariance[];
}

/**
 * One stored carryover ledger application (§5), surfaced to the client so the
 * Reconciliation table can show both-ends provenance (source → target) and a
 * dated history rather than just aggregate sums.
 */
export interface CarryoverApplication {
  id: string;
  sourceMonth: string; // YYYY-MM the over/under came from
  targetMonth: string; // YYYY-MM it was applied into
  bucket: 'base' | 'added';
  amount: number; // signed; actual-spend dollars
  appliedAt: string; // ISO timestamp
}

export interface YearReconciliation {
  year: number;
  markup: number;
  /** The live month carryovers land in; '' when the year has no live month. */
  targetPeriod: string;
  months: ReconciliationMonth[];
  ytdVariance: number; // Σ variance over settled months before the target
  ytdCarryover: number; // Σ carryover over settled months before the target
  ytdUnapplied: number; // Σ unapplied over settled months before the target
  /**
   * §4 health gauge: lifetime drift INCLUDING the in-progress live month,
   * measured against ORIGINAL (pre-carryover) targets. Distinct from
   * ytdUnapplied (the settle-able action queue). Sign is variance convention:
   * >0 overspent, <0 underspent. Intentionally swings with the open month.
   */
  ytdVarianceInclLive: number;
  /**
   * §4: settled months that still carry unapplied over/under (the ones summing
   * into ytdUnapplied), so the UI can name them — "$X across Mar, Apr".
   */
  unappliedMonths: string[];
  appliedThisMonth: { base: number; added: number; total: number };
  /**
   * Every stored carryover application in scope (newest first) — powers the
   * both-ends indicators (source → target / target ← source) and dated history.
   */
  applications: CarryoverApplication[];
}

/**
 * Per-month over/under for a calendar year, enriched for the Reconciliation
 * view: tracked months use Σ pacerActual vs (base + added) × markup;
 * pre-tool months use the backfilled historicalActual vs the client budget
 * entered into baseBudgetGoal × markup. Each month also carries how much of its
 * over/under has already been applied (consumed) via the ledger, so the UI can
 * offer single + apply-all actions and show a YTD net still to reconcile.
 *
 * Reads live tables (not frozen snapshots) so historical targets stay editable
 * and the numbers match the Over/Under tab. Variance basis is the
 * margin-adjusted spend target, never the gross client budget.
 */
export async function getYearReconciliation(
  accountKey: string,
  year: number,
  _userId: string | null,
): Promise<YearReconciliation> {
  const plan = await getOrCreatePlan(accountKey);
  const tz = await accountTimeZone(accountKey);
  const [account, globalDefaultMarkup] = await Promise.all([
    prisma.account.findUnique({
      where: { key: accountKey },
      select: { markup: true },
    }),
    getGlobalDefaultMarkup(),
  ]);
  const markup = accountMarginSetting(account?.markup, globalDefaultMarkup);

  const curPeriod = zonedTodayIso(Date.now(), tz).slice(0, 7);
  const curYear = Number(curPeriod.slice(0, 4));
  // Months in scope: Jan → current month (this year), else all 12 (past year).
  const lastMonth = year < curYear ? 12 : year > curYear ? 0 : Number(curPeriod.slice(5, 7));
  const periods: string[] = [];
  for (let m = 1; m <= lastMonth; m++) {
    periods.push(`${year}-${String(m).padStart(2, '0')}`);
  }
  const targetPeriod = year === curYear ? curPeriod : '';

  if (periods.length === 0) {
    return {
      year,
      markup,
      targetPeriod,
      months: [],
      ytdVariance: 0,
      ytdCarryover: 0,
      ytdUnapplied: 0,
      ytdVarianceInclLive: 0,
      unappliedMonths: [],
      appliedThisMonth: { base: 0, added: 0, total: 0 },
      applications: [],
    };
  }

  const [budgets, adRows, ledger] = await Promise.all([
    prisma.metaAdsPacerPeriodBudget.findMany({
      where: { planId: plan.id, period: { in: periods } },
      select: {
        period: true,
        baseBudgetGoal: true,
        addedBudgetGoal: true,
        historicalActual: true,
      },
    }),
    prisma.metaAdsPacerAd.findMany({
      where: { planId: plan.id, period: { in: periods } },
      select: {
        period: true,
        name: true,
        pacerActual: true,
        pacerRunSpend: true,
        fullRunAppliedToMonth: true,
        allocation: true,
        budgetType: true,
        adStatus: true,
        metaStartDate: true,
        liveDate: true,
        flightStart: true,
        metaEndDate: true,
        flightEnd: true,
      },
    }),
    prisma.metaAdsPacerCarryoverApplication.findMany({
      where: {
        planId: plan.id,
        OR: [{ sourceMonth: { in: periods } }, { targetMonth: { in: periods } }],
      },
      select: {
        id: true,
        bucket: true,
        sourceMonth: true,
        targetMonth: true,
        amount: true,
        appliedAt: true,
      },
    }),
  ]);

  const budgetByPeriod = new Map(budgets.map((b) => [b.period, b]));
  const adCountByPeriod = new Map<string, number>();
  const actualByPeriod = new Map<string, number>(); // Σ all pacerActual (total spend)
  // §3: per-period sums for LIFETIME ads still in progress — excluded from the
  // settle-able over/under base (both actual slice AND allocation) so a running
  // lifetime ad contributes $0 variance; it still counts toward total spend and
  // books its single variance once it completes (re-enters the base naturally).
  const ipLifeActualByPeriod = new Map<string, number>();
  const ipLifeAllocByPeriod = new Map<string, number>();
  const ipLifePeriods = new Set<string>();
  // CM4: per-ad over/under contribution + timing class, grouped by month, for
  // the Reconciliation row drill-down (same classifier the Over/Under page uses).
  const adVarByPeriod = new Map<string, ReconAdVariance[]>();
  const reconNowMs = Date.now();
  for (const a of adRows) {
    adCountByPeriod.set(a.period, (adCountByPeriod.get(a.period) ?? 0) + 1);
    // §2: a resolved cross-month straddler contributes its FULL run in its own
    // month (effectiveActual); otherwise its month slice. Never NaN.
    const n = effectiveActual(a);
    actualByPeriod.set(a.period, (actualByPeriod.get(a.period) ?? 0) + n);
    const v = classifyAdVariance(a, a.period, reconNowMs, tz);
    const list = adVarByPeriod.get(a.period) ?? [];
    list.push({
      name: a.name ?? '',
      contribution: v.contribution,
      klass: v.klass,
      heldOutSpend: v.heldOutSpend,
    });
    adVarByPeriod.set(a.period, list);
    if (isLifetimeInProgress(a, reconNowMs, tz)) {
      ipLifePeriods.add(a.period);
      ipLifeActualByPeriod.set(a.period, (ipLifeActualByPeriod.get(a.period) ?? 0) + n);
      const alloc = Number(a.allocation ?? 0);
      if (!isNaN(alloc)) {
        ipLifeAllocByPeriod.set(a.period, (ipLifeAllocByPeriod.get(a.period) ?? 0) + alloc);
      }
    }
  }
  const appliedOutByPeriod = new Map<string, number>();
  const appliedInByPeriod = new Map<string, number>();
  for (const e of ledger) {
    const amt = Number(e.amount ?? 0);
    if (isNaN(amt)) continue;
    appliedOutByPeriod.set(e.sourceMonth, (appliedOutByPeriod.get(e.sourceMonth) ?? 0) + amt);
    appliedInByPeriod.set(e.targetMonth, (appliedInByPeriod.get(e.targetMonth) ?? 0) + amt);
  }

  const months: ReconciliationMonth[] = periods.map((period) => {
    const b = budgetByPeriod.get(period);
    const tracked = (adCountByPeriod.get(period) ?? 0) > 0;
    const base = Number(b?.baseBudgetGoal ?? 0);
    const added = Number(b?.addedBudgetGoal ?? 0);
    const clientBudget = (isNaN(base) ? 0 : base) + (isNaN(added) ? 0 : added);
    const histActual = b?.historicalActual != null ? Number(b.historicalActual) : null;
    const isBackfilled = !tracked && histActual != null && !isNaN(histActual);
    const actual = tracked
      ? actualByPeriod.get(period) ?? 0
      : isBackfilled
        ? (histActual as number)
        : 0;
    const hasActual = tracked ? actualByPeriod.has(period) : isBackfilled;
    const appliedIn = appliedInByPeriod.get(period) ?? 0;
    const spendTarget = effectiveSpendTarget(clientBudget, markup);
    // §3: exclude any LIFETIME ad still in progress from the SETTLE-ABLE base —
    // both its actual slice and its allocation — so it contributes $0 to the
    // over/under while running (it books its single variance on completion).
    // `actual`/`spendTarget` displayed stay the honest totals; only `variance`
    // uses the base. Settled months have no in-progress lifetime ad, so for them
    // base == total and nothing changes.
    const hasLifetimeInProgress = ipLifePeriods.has(period);
    const baseActual = actual - (ipLifeActualByPeriod.get(period) ?? 0);
    const baseTarget = spendTarget - (ipLifeAllocByPeriod.get(period) ?? 0);
    // The live month's target includes carryover applied INTO it, mirroring the
    // Pacer's adjusted target (base × markup + carryover). Past months never
    // receive carryover (appliedIn = 0), so theirs is unchanged.
    const adjustedSpendTarget = spendTarget + appliedIn;
    const variance = baseActual - (baseTarget + appliedIn);
    const carryover = -variance;
    const appliedOut = appliedOutByPeriod.get(period) ?? 0;
    return {
      period,
      state: monthState(period, tz),
      isBackfilled,
      hasTarget: clientBudget > 0,
      hasActual,
      clientBudget,
      spendTarget,
      adjustedSpendTarget,
      actual,
      variance,
      carryover,
      exceedsThreshold: Math.abs(variance) >= CARRYOVER_THRESHOLD,
      appliedOut,
      unapplied: carryover - appliedOut,
      appliedIn,
      hasLifetimeInProgress,
      ads: adVarByPeriod.get(period) ?? [],
    };
  });

  // YTD aggregates over SETTLED months strictly before the live target month —
  // the live month's own variance is still in-progress, not reconcilable.
  const settled = months.filter(
    (m) =>
      (targetPeriod ? m.period < targetPeriod : true) &&
      (m.hasActual || m.hasTarget),
  );
  const ytdVariance = settled.reduce((s, m) => s + m.variance, 0);
  const ytdCarryover = settled.reduce((s, m) => s + m.carryover, 0);
  const ytdUnapplied = settled.reduce((s, m) => s + m.unapplied, 0);

  // §4 health gauge: lifetime drift INCLUDING the in-progress live month,
  // measured against ORIGINAL targets. `m.variance` is actual − (baseTarget +
  // appliedIn); carryover applied into a month is internal reallocation, not
  // real drift, so add `appliedIn` back to recover (baseActual − baseTarget).
  // For settled months appliedIn is 0, so this matches their variance exactly.
  // This number intentionally swings with the open month's in-progress under —
  // it's the health gauge, NOT the settle-able action queue (ytdUnapplied).
  const active = months.filter((m) => m.hasActual || m.hasTarget);
  const ytdVarianceInclLive = active.reduce(
    (s, m) => s + m.variance + m.appliedIn,
    0,
  );
  // §4: settled months still carrying unapplied over/under — named in the UI so
  // "net still to reconcile" is actionable ("$X across Mar, Apr").
  const unappliedMonths = settled
    .filter((m) => Math.abs(m.unapplied) >= 0.005)
    .map((m) => m.period);

  let appliedBase = 0;
  let appliedAdded = 0;
  if (targetPeriod) {
    for (const e of ledger) {
      if (e.targetMonth !== targetPeriod) continue;
      const amt = Number(e.amount ?? 0);
      if (isNaN(amt)) continue;
      if (e.bucket === 'added') appliedAdded += amt;
      else appliedBase += amt;
    }
  }

  const applications: CarryoverApplication[] = ledger
    .map((e) => ({
      id: e.id,
      sourceMonth: e.sourceMonth,
      targetMonth: e.targetMonth,
      bucket: (e.bucket === 'added' ? 'added' : 'base') as 'base' | 'added',
      amount: Number(e.amount ?? 0) || 0,
      appliedAt: e.appliedAt.toISOString(),
    }))
    .sort((a, b) => (a.appliedAt < b.appliedAt ? 1 : -1)); // newest first

  return {
    year,
    markup,
    targetPeriod,
    months,
    ytdVariance,
    ytdCarryover,
    ytdUnapplied,
    ytdVarianceInclLive,
    unappliedMonths,
    appliedThisMonth: {
      base: appliedBase,
      added: appliedAdded,
      total: appliedBase + appliedAdded,
    },
    applications,
  };
}

/**
 * Apply one settled month's unapplied over/under into the target (live) month's
 * bucket, recording it in the ledger and refreshing the cached carryover
 * columns. Idempotent — a month with nothing left to apply is a no-op.
 */
export async function applyCarryover(
  accountKey: string,
  planId: string,
  sourceMonth: string,
  targetMonth: string,
  bucket: 'base' | 'added',
  userId: string | null,
): Promise<{ applied: number }> {
  const recon = await getYearReconciliation(
    accountKey,
    Number(sourceMonth.slice(0, 4)),
    userId,
  );
  const m = recon.months.find((x) => x.period === sourceMonth);
  if (!m) throw new Error('Month not found for carryover.');
  const amount = Math.round(m.unapplied * 100) / 100;
  if (Math.abs(amount) < 0.005) return { applied: 0 };
  await prisma.metaAdsPacerCarryoverApplication.create({
    data: {
      planId,
      bucket,
      sourceMonth,
      targetMonth,
      amount: amount.toFixed(2),
      appliedByUserId: userId,
    },
  });
  await recomputeCarryoverColumns(planId, targetMonth);
  return { applied: amount };
}

/**
 * Apply every settled month's unapplied over/under (before the target month)
 * into the target month's bucket in one pass — the "correct the whole year"
 * action. Returns the net dollars applied and how many months contributed.
 */
export async function applyAllUnapplied(
  accountKey: string,
  planId: string,
  targetMonth: string,
  bucket: 'base' | 'added',
  userId: string | null,
): Promise<{ applied: number; count: number }> {
  const recon = await getYearReconciliation(
    accountKey,
    Number(targetMonth.slice(0, 4)),
    userId,
  );
  let total = 0;
  let count = 0;
  for (const m of recon.months) {
    if (!m.period || m.period >= targetMonth) continue;
    const amount = Math.round(m.unapplied * 100) / 100;
    if (Math.abs(amount) < 0.005) continue;
    await prisma.metaAdsPacerCarryoverApplication.create({
      data: {
        planId,
        bucket,
        sourceMonth: m.period,
        targetMonth,
        amount: amount.toFixed(2),
        appliedByUserId: userId,
      },
    });
    total += amount;
    count++;
  }
  if (count > 0) await recomputeCarryoverColumns(planId, targetMonth);
  return { applied: total, count };
}

/**
 * Undo carryover applications landing in `targetMonth`. With `sourceMonth`,
 * removes just that month's application; without it, clears them all. Then
 * refreshes the cached columns.
 */
export async function unapplyCarryover(
  planId: string,
  targetMonth: string,
  sourceMonth: string | null,
): Promise<void> {
  await prisma.metaAdsPacerCarryoverApplication.deleteMany({
    where: {
      planId,
      targetMonth,
      ...(sourceMonth ? { sourceMonth } : {}),
    },
  });
  await recomputeCarryoverColumns(planId, targetMonth);
}

/**
 * Set (or clear) the client budget / target for a pre-tool month. Stored in
 * baseBudgetGoal (combined — backfilled months aren't bucket-split), per the
 * historicalActual design. Only meaningful for months with no tracked ads;
 * tracked months get their target from the planner.
 */
export async function setHistoricalTarget(
  planId: string,
  period: string,
  clientBudget: number | null,
): Promise<void> {
  const value =
    clientBudget != null && Number.isFinite(clientBudget) && clientBudget > 0
      ? clientBudget.toFixed(2)
      : null;
  await prisma.metaAdsPacerPeriodBudget.upsert({
    where: { planId_period: { planId, period } },
    create: { planId, period, baseBudgetGoal: value },
    update: { baseBudgetGoal: value },
  });
}

/** The current live pacing month (YYYY-MM) in the account's timezone. */
export async function getCurrentPacerPeriod(accountKey: string): Promise<string> {
  const tz = await accountTimeZone(accountKey);
  return zonedTodayIso(Date.now(), tz).slice(0, 7);
}

/** Lists periods that have at least one ad or one budget row. */
export async function listPeriods(planId: string) {
  const [adGroups, budgets] = await Promise.all([
    prisma.metaAdsPacerAd.groupBy({
      by: ['period'],
      where: { planId, period: { not: '' } },
      _count: { _all: true },
    }),
    prisma.metaAdsPacerPeriodBudget.findMany({
      where: { planId },
      select: { period: true },
    }),
  ]);
  const counts = new Map<string, number>();
  adGroups.forEach((g) => counts.set(g.period, g._count._all));
  budgets.forEach((b) => {
    if (!counts.has(b.period)) counts.set(b.period, 0);
  });
  return [...counts.entries()]
    .map(([period, adCount]) => ({ period, adCount }))
    .sort((a, b) => (a.period < b.period ? 1 : -1));
}
