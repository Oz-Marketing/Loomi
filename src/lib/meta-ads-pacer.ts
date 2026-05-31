import type { Session } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { s3PublicUrl } from '@/lib/s3';
import { resolveAccountTimeZone, zonedTodayIso } from '@/lib/timezone';
// Gross→spend markup default (client gross × markup = spend target) + the
// carryover threshold, shared with the planner so server and client agree.
import {
  MARKUP as DEFAULT_MARKUP,
  CARRYOVER_THRESHOLD,
  ACTIVE_STATUSES,
} from '@/app/tools/meta/_lib/constants';
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
  const [budget, ads, plan] = await Promise.all([
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
  ]);
  return {
    baseBudgetGoal: budget?.baseBudgetGoal ?? null,
    addedBudgetGoal: budget?.addedBudgetGoal ?? null,
    // Opt-in carryover applied to each bucket's DERIVED spend target (Change 7).
    baseCarryover: budget?.baseCarryover ?? null,
    addedCarryover: budget?.addedCarryover ?? null,
    markup: plan?.account?.markup ?? null,
    // Meta zone if cached, else a valid hand-entered zone, else the default.
    timeZone: resolveAccountTimeZone(
      plan?.account?.metaTimezone,
      plan?.account?.timezone,
    ),
    ads: ads.map((ad) => ({
      ...ad,
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
async function accountTimeZone(accountKey: string): Promise<string> {
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
  const markup =
    typeof view.markup === 'number' && view.markup > 0
      ? view.markup
      : DEFAULT_MARKUP;
  const spendTarget = clientBudget * markup;
  const actual = (view.ads ?? []).reduce(
    (s: number, a: { pacerActual?: string | null }) => {
      const n = Number(a.pacerActual ?? 0);
      return s + (isNaN(n) ? 0 : n);
    },
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
 * Apply (or clear) a carryover into a live month's bucket. The amount is
 * recomputed server-side from the prior month's settled over/under so it
 * can't be tampered with; `clear` removes it. Writes only the carryover
 * column — never the typed budget goal.
 */
export async function setCarryover(
  accountKey: string,
  planId: string,
  period: string,
  bucket: 'base' | 'added',
  clear: boolean,
  userId: string | null,
): Promise<{ applied: number }> {
  let amount = 0;
  if (!clear) {
    const prior = await getPriorOverUnder(accountKey, period, userId);
    if (!prior) throw new Error('No settled prior month to carry over from.');
    amount = Math.round(prior.carryover * 100) / 100;
  }
  const value = clear ? null : amount.toFixed(2);
  // Exclusive: the combined over/under lands in exactly ONE bucket, so set the
  // chosen bucket and clear the other (prevents double-counting on re-apply).
  const data = {
    baseCarryover: clear ? null : bucket === 'base' ? value : null,
    addedCarryover: clear ? null : bucket === 'added' ? value : null,
  };
  await prisma.metaAdsPacerPeriodBudget.upsert({
    where: { planId_period: { planId, period } },
    create: { planId, period, ...data },
    update: data,
  });
  return { applied: clear ? 0 : amount };
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

  const [accounts, plans] = await Promise.all([
    prisma.account.findMany({
      where: { key: { in: accountKeys } },
      select: { key: true, dealer: true },
    }),
    prisma.metaAdsPacerPlan.findMany({
      where: { accountKey: { in: accountKeys } },
      select: { id: true, accountKey: true },
    }),
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

  const plans = await prisma.metaAdsPacerPlan.findMany({
    where: { accountKey: { in: accountKeys } },
    select: { id: true, account: { select: { markup: true } } },
  });
  const planIds = plans.map((p) => p.id);
  if (planIds.length === 0) return periods.map(zero);

  // planId → effective markup (per-account override, else global default).
  const markupByPlan = new Map(
    plans.map((p) => {
      const m = p.account?.markup;
      return [p.id, m != null && Number.isFinite(m) && m > 0 ? m : DEFAULT_MARKUP];
    }),
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
    const markup = markupByPlan.get(b.planId) ?? DEFAULT_MARKUP;
    grossByPeriod.set(b.period, (grossByPeriod.get(b.period) ?? 0) + gross);
    targetByPeriod.set(
      b.period,
      (targetByPeriod.get(b.period) ?? 0) + gross * markup,
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
