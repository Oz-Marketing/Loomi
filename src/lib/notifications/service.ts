import { prisma } from '@/lib/prisma';
import {
  sendImmediateNotificationEmail,
  sendDigestNotificationEmail,
  type NotificationEmailItem,
} from '@/lib/notifications/email';
import {
  isNotificationEnabled,
  type NotificationType,
} from '@/lib/notifications/types';
import { purgeOldAuditEntries } from '@/lib/meta-ads-audit';
// §0.1: per-account markup (override, else agency default) — no hardcoded literal.
import {
  accountMarginSetting,
  effectiveSpendTarget,
} from '@/app/tools/meta/_lib/markup';
import { getGlobalDefaultMarkup } from '@/lib/services/markup';

export type { NotificationType };
export type NotificationSeverity = 'info' | 'warning' | 'critical';

interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  severity?: NotificationSeverity;
  title: string;
  body?: string | null;
  link?: string | null;
  meta?: Record<string, unknown> | null;
  /** Send immediately by email (used for assignments + approvals). */
  sendEmailNow?: boolean;
  /**
   * Skip if a similar notification was created recently (idempotency for the
   * scan job — avoids re-spamming the same alert daily).
   */
  dedupeWindowHours?: number;
  /** Composite dedupe key (e.g. `ad:abc:due_soon:2026-04-26`). */
  dedupeKey?: string;
}

/**
 * Create a notification (in-app), optionally sending an immediate email.
 * Idempotent when `dedupeKey` is provided — re-creates only after the window.
 *
 * Honors the user's NotificationPreference for the given type — returns null
 * when the user has disabled this notification kind.
 */
export async function createNotification(input: CreateNotificationInput) {
  const enabled = await isNotificationEnabled(input.userId, input.type);
  if (!enabled) return null;

  const window = input.dedupeWindowHours ?? 0;
  if (input.dedupeKey && window > 0) {
    const since = new Date(Date.now() - window * 3600 * 1000);
    const existing = await prisma.notification.findFirst({
      where: {
        userId: input.userId,
        type: input.type,
        createdAt: { gte: since },
        // Match against the meta blob's `dedupeKey` field
        metaJson: { contains: `"dedupeKey":"${input.dedupeKey}"` },
      },
      select: { id: true },
    });
    if (existing) return null;
  }

  const meta = { ...(input.meta ?? {}), dedupeKey: input.dedupeKey ?? null };
  const notification = await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      severity: input.severity ?? 'info',
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      metaJson: JSON.stringify(meta),
    },
  });

  if (input.sendEmailNow) {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true, name: true },
    });
    if (user?.email) {
      try {
        await sendImmediateNotificationEmail({
          to: user.email,
          recipientName: user.name,
          item: {
            title: input.title,
            body: input.body ?? null,
            link: input.link ?? null,
            severity: input.severity ?? 'info',
          },
        });
        await prisma.notification.update({
          where: { id: notification.id },
          data: { emailedAt: new Date() },
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[notifications] failed to send immediate email', err);
      }
    }
  }

  return notification;
}

interface ListOptions {
  userId: string;
  unreadOnly?: boolean;
  limit?: number;
}

export async function listNotificationsForUser({ userId, unreadOnly, limit = 50 }: ListOptions) {
  return prisma.notification.findMany({
    where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 200),
  });
}

export async function countUnreadForUser(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markRead(userId: string, ids: string[]) {
  if (ids.length === 0) return 0;
  const result = await prisma.notification.updateMany({
    where: { userId, id: { in: ids }, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function markAllRead(userId: string) {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

// ──────────────────────────────────────────────────────────────────────────
// Pacer alert scanners — invoked by the daily cron job
// ──────────────────────────────────────────────────────────────────────────

const ACTIVE_BUSINESS_DAYS_BEFORE_DUE = 2;
const APPROVAL_PENDING_DAYS = 3;
const STATUS_STUCK_DAYS = 2;
// "Significant underspend with little flight left" (Change 9): under 85% of
// expected (>15% under) with under 30% of the flight remaining — hard to
// recover, the most valuable alert. Configurable.
const UNDERSPEND_UNDER_PCT = 85;
const LOW_TIME_LEFT_FRACTION = 0.3;
// Planner statuses that mean the ad should be delivering right now.
const PLANNER_LIVE_STATUSES = new Set(['Live', 'Live - Changes Required']);
// Meta effective_status values that count as actively delivering.
const META_ACTIVE_STATUSES = new Set(['ACTIVE']);

const DUE_DATE_DONE_STATUSES = new Set(['Live', 'Completed Run', 'Off']);

function todayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

/** Reformat a YYYY-MM-DD ISO date into the user-facing MM-DD-YYYY layout. */
function fmtFullDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${m}-${d}-${y}`;
}

function daysAgoMs(n: number): number {
  return Date.now() - n * 86400 * 1000;
}

/** Resolve the set of users we should notify for a given ad. */
function adRecipients(ad: {
  ownerUserId: string | null;
  designerUserId: string | null;
  accountRepUserId: string | null;
}): Set<string> {
  const set = new Set<string>();
  if (ad.ownerUserId) set.add(ad.ownerUserId);
  if (ad.designerUserId) set.add(ad.designerUserId);
  if (ad.accountRepUserId) set.add(ad.accountRepUserId);
  return set;
}

interface ScanResult {
  notificationsCreated: number;
  emailsSent: number;
  errors: string[];
}

/**
 * Run all pacer alert scanners and queue notifications for digest emailing.
 * Returns counts and any errors collected.
 */
export async function scanPacerAlerts(): Promise<ScanResult> {
  const result: ScanResult = { notificationsCreated: 0, emailsSent: 0, errors: [] };
  const today = todayISO();
  const todayDate = new Date(today + 'T00:00:00');

  // Collected per-user, used for the digest at the end
  const digestByUser = new Map<string, NotificationEmailItem[]>();

  function pushToDigest(userId: string, item: NotificationEmailItem) {
    const arr = digestByUser.get(userId) ?? [];
    arr.push(item);
    digestByUser.set(userId, arr);
  }

  // Pull ALL ads with their plan account context (cheap; the dataset is small)
  let ads: Array<{
    id: string;
    name: string;
    period: string;
    flightStart: string | null;
    flightEnd: string | null;
    liveDate: string | null;
    dueDate: string | null;
    creativeDueDate: string | null;
    adStatus: string;
    designStatus: string;
    internalApproval: string;
    clientApproval: string;
    pacerActual: string | null;
    pacerDailyBudget: string | null;
    allocation: string | null;
    budgetType: string;
    budgetSource: string;
    metaEffectiveStatus: string | null;
    alertsMuted: boolean;
    ownerUserId: string | null;
    designerUserId: string | null;
    accountRepUserId: string | null;
    updatedAt: Date;
    plan: { accountKey: string; account: { dealer: string } };
  }>;
  try {
    ads = await prisma.metaAdsPacerAd.findMany({
      include: { plan: { include: { account: { select: { dealer: true } } } } },
    });
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : 'failed to load ads');
    return result;
  }

  // ── 1. Due date approaching / overdue ──
  for (const ad of ads) {
    if (!ad.dueDate) continue;
    if (DUE_DATE_DONE_STATUSES.has(ad.adStatus)) continue;
    const due = new Date(ad.dueDate + 'T00:00:00');
    const diffDays = Math.ceil((due.getTime() - todayDate.getTime()) / 86400000);
    const recipients = adRecipients(ad);

    let title: string | null = null;
    let severity: NotificationSeverity = 'info';
    let type: NotificationType = 'ad_due_soon';

    if (diffDays < 0) {
      title = `"${ad.name}" is overdue (${Math.abs(diffDays)}d)`;
      severity = 'critical';
      type = 'ad_overdue';
    } else if (diffDays === 0) {
      title = `"${ad.name}" is due today`;
      severity = 'warning';
    } else if (diffDays <= ACTIVE_BUSINESS_DAYS_BEFORE_DUE) {
      title = `"${ad.name}" is due in ${diffDays} day${diffDays !== 1 ? 's' : ''}`;
      severity = 'warning';
    }

    if (!title) continue;

    const link = `/tools/meta-ads-pacer`;
    const body = `${ad.plan.account.dealer} · ${ad.adStatus} · target start ${fmtFullDate(ad.flightStart)}`;
    const dedupeKey = `${ad.id}:${type}:${today}`;

    for (const userId of recipients) {
      const created = await createNotification({
        userId,
        type,
        severity,
        title,
        body,
        link,
        meta: { adId: ad.id, accountKey: ad.plan.accountKey, period: ad.period },
        dedupeKey,
        dedupeWindowHours: 20,
      });
      if (created) {
        result.notificationsCreated += 1;
        pushToDigest(userId, { title, body, link, severity });
      }
    }
  }

  // ── 2. Approval pending too long (>3 days unchanged) ──
  const approvalCutoff = new Date(daysAgoMs(APPROVAL_PENDING_DAYS));
  for (const ad of ads) {
    if (ad.updatedAt > approvalCutoff) continue; // recently moved
    const internalPending = ad.internalApproval === 'Pending Approval';
    const clientPending = ad.clientApproval === 'Pending Approval';
    if (!internalPending && !clientPending) continue;

    const which = internalPending && clientPending
      ? 'internal & client approval'
      : internalPending
        ? 'internal approval'
        : 'client approval';
    const title = `"${ad.name}" still waiting on ${which}`;
    const body = `${ad.plan.account.dealer} · pending for ${APPROVAL_PENDING_DAYS}+ days · ${ad.adStatus}`;
    const link = `/tools/meta-ads-pacer`;
    const dedupeKey = `${ad.id}:approval_pending:${today}`;

    const recipients = adRecipients(ad);
    for (const userId of recipients) {
      const created = await createNotification({
        userId,
        type: 'approval_pending',
        severity: 'warning',
        title,
        body,
        link,
        meta: { adId: ad.id, accountKey: ad.plan.accountKey },
        dedupeKey,
        dedupeWindowHours: 20,
      });
      if (created) {
        result.notificationsCreated += 1;
        pushToDigest(userId, { title, body, link, severity: 'warning' });
      }
    }
  }

  // ── 3. Status stuck (>2 days in `Stuck`) ──
  const stuckCutoff = new Date(daysAgoMs(STATUS_STUCK_DAYS));
  for (const ad of ads) {
    if (ad.adStatus !== 'Stuck') continue;
    if (ad.updatedAt > stuckCutoff) continue;

    const title = `"${ad.name}" has been Stuck for 2+ days`;
    const body = `${ad.plan.account.dealer} · last updated ${fmtFullDate(ad.updatedAt.toISOString().split('T')[0])}`;
    const link = `/tools/meta-ads-pacer`;
    const dedupeKey = `${ad.id}:status_stuck:${today}`;

    const recipients = adRecipients(ad);
    for (const userId of recipients) {
      const created = await createNotification({
        userId,
        type: 'status_stuck',
        severity: 'critical',
        title,
        body,
        link,
        meta: { adId: ad.id, accountKey: ad.plan.accountKey },
        dedupeKey,
        dedupeWindowHours: 20,
      });
      if (created) {
        result.notificationsCreated += 1;
        pushToDigest(userId, { title, body, link, severity: 'critical' });
      }
    }
  }

  // ── 4. Pacing alerts: overpacing, early underpacing, and (most valuable)
  //     a significant underspend with little flight left to recover. ──
  for (const ad of ads) {
    if (ad.alertsMuted) continue; // per-ad mute (Change 9)
    const isLifetime = ad.budgetType === 'Lifetime';
    const effectiveStart = ad.liveDate || ad.flightStart;
    if (!effectiveStart || !ad.flightEnd) continue;
    const startD = new Date(effectiveStart + 'T00:00:00');
    const endD = new Date(ad.flightEnd + 'T00:00:00');
    if (startD > todayDate || endD < todayDate) continue;

    const totalDays = Math.max(
      0,
      Math.ceil((endD.getTime() - startD.getTime()) / 86400000) + 1,
    );
    if (totalDays === 0) continue;
    const elapsed = Math.max(
      0,
      Math.ceil((todayDate.getTime() - startD.getTime()) / 86400000) + 1,
    );
    const remaining = Math.max(0, totalDays - elapsed);
    const timeLeftFraction = remaining / totalDays;

    const allocation = Number(ad.allocation ?? '');
    if (!Number.isFinite(allocation) || allocation === 0) continue;
    const dailyBudget = Number(ad.pacerDailyBudget ?? '');
    const totalBudget = isLifetime ? allocation : Number.isFinite(dailyBudget) ? dailyBudget * totalDays : 0;
    const expectedToDate = (totalBudget / totalDays) * elapsed;
    if (expectedToDate <= 0) continue;
    const actual = Number(ad.pacerActual ?? '');
    if (!Number.isFinite(actual)) continue;
    const pct = (actual / expectedToDate) * 100;
    let title: string | null = null;
    let severity: NotificationSeverity = 'warning';
    if (pct < UNDERSPEND_UNDER_PCT && timeLeftFraction < LOW_TIME_LEFT_FRACTION) {
      // Hard-to-recover underspend — fires even when little time remains.
      title = `"${ad.name}" underspending at ${pct.toFixed(0)}% with only ${remaining}d left`;
      severity = 'critical';
    } else if (pct > 110 && remaining > 3) {
      title = `"${ad.name}" overpacing at ${pct.toFixed(0)}%`;
    } else if (pct < 50 && remaining > 3) {
      title = `"${ad.name}" underpacing at ${pct.toFixed(0)}%`;
      severity = 'info';
    }
    if (!title) continue;

    const body = `${ad.plan.account.dealer} · day ${elapsed} of ${totalDays} · ${remaining}d left`;
    const link = `/tools/meta-ads-pacer`;
    const dedupeKey = `${ad.id}:pacing_alert:${today}`;

    const recipients = adRecipients(ad);
    for (const userId of recipients) {
      const created = await createNotification({
        userId,
        type: 'pacing_alert',
        severity,
        title,
        body,
        link,
        meta: { adId: ad.id, accountKey: ad.plan.accountKey, pct },
        dedupeKey,
        dedupeWindowHours: 20,
      });
      if (created) {
        result.notificationsCreated += 1;
        pushToDigest(userId, { title, body, link, severity });
      }
    }
  }

  // ── 4b. Ad went dark: planner says Live + in-flight, but Meta now reports
  //     it not delivering (paused/off/rejected) — easy to miss. ──
  for (const ad of ads) {
    if (ad.alertsMuted) continue;
    if (!ad.metaEffectiveStatus) continue; // only when linked + synced
    if (!PLANNER_LIVE_STATUSES.has(ad.adStatus)) continue;
    const effectiveStart = ad.liveDate || ad.flightStart;
    if (!effectiveStart || !ad.flightEnd) continue;
    const startD = new Date(effectiveStart + 'T00:00:00');
    const endD = new Date(ad.flightEnd + 'T00:00:00');
    if (startD > todayDate || endD < todayDate) continue; // must be in flight
    if (META_ACTIVE_STATUSES.has(ad.metaEffectiveStatus.toUpperCase())) continue;

    const title = `"${ad.name}" may have gone dark`;
    const body = `${ad.plan.account.dealer} · planner is Live but Meta shows ${ad.metaEffectiveStatus}`;
    const link = `/tools/meta-ads-pacer`;
    const dedupeKey = `${ad.id}:ad_dark:${today}`;
    const recipients = adRecipients(ad);
    for (const userId of recipients) {
      const created = await createNotification({
        userId,
        type: 'ad_dark',
        severity: 'critical',
        title,
        body,
        link,
        meta: { adId: ad.id, accountKey: ad.plan.accountKey, metaStatus: ad.metaEffectiveStatus },
        dedupeKey,
        dedupeWindowHours: 20,
      });
      if (created) {
        result.notificationsCreated += 1;
        pushToDigest(userId, { title, body, link, severity: 'critical' });
      }
    }
  }

  // ── 4c. End-of-flight approaching: active ad ending in 1–2 days. ──
  for (const ad of ads) {
    if (ad.alertsMuted) continue;
    if (!ad.flightEnd) continue;
    if (!PLANNER_LIVE_STATUSES.has(ad.adStatus)) continue;
    const endD = new Date(ad.flightEnd + 'T00:00:00');
    const diffDays = Math.ceil((endD.getTime() - todayDate.getTime()) / 86400000);
    if (diffDays < 1 || diffDays > 2) continue;

    const title = `"${ad.name}" flight ends in ${diffDays} day${diffDays !== 1 ? 's' : ''}`;
    const body = `${ad.plan.account.dealer} · ends ${fmtFullDate(ad.flightEnd)} · time for a final reconciliation`;
    const link = `/tools/meta-ads-pacer`;
    const dedupeKey = `${ad.id}:flight_ending:${today}`;
    const recipients = adRecipients(ad);
    for (const userId of recipients) {
      const created = await createNotification({
        userId,
        type: 'flight_ending',
        severity: 'info',
        title,
        body,
        link,
        meta: { adId: ad.id, accountKey: ad.plan.accountKey },
        dedupeKey,
        dedupeWindowHours: 20,
      });
      if (created) {
        result.notificationsCreated += 1;
        pushToDigest(userId, { title, body, link, severity: 'info' });
      }
    }
  }

  // ── 5. Period over-allocated (sum allocation > goal × markup) ──
  const globalDefaultMarkup = await getGlobalDefaultMarkup();
  let plans: Array<{
    id: string;
    accountKey: string;
    account: { dealer: string; markup: number | null };
    accountRepId: string | null;
    periodBudgets: Array<{ period: string; baseBudgetGoal: string | null; addedBudgetGoal: string | null }>;
  }>;
  try {
    plans = (await prisma.metaAdsPacerPlan.findMany({
      include: {
        account: { select: { dealer: true, accountRepId: true, markup: true } },
        periodBudgets: true,
      },
    })).map((p) => ({
      id: p.id,
      accountKey: p.accountKey,
      account: { dealer: p.account.dealer, markup: p.account.markup },
      accountRepId: p.account.accountRepId,
      periodBudgets: p.periodBudgets.map((b) => ({
        period: b.period,
        baseBudgetGoal: b.baseBudgetGoal,
        addedBudgetGoal: b.addedBudgetGoal,
      })),
    }));
  } catch {
    plans = [];
  }

  for (const plan of plans) {
    const markup = accountMarginSetting(plan.account.markup, globalDefaultMarkup);
    for (const budget of plan.periodBudgets) {
      const baseGoal = Number(budget.baseBudgetGoal ?? '');
      const addedGoal = Number(budget.addedBudgetGoal ?? '');
      const grossGoal =
        (Number.isFinite(baseGoal) ? baseGoal : 0) +
        (Number.isFinite(addedGoal) ? addedGoal : 0);
      const totalGoalActual = effectiveSpendTarget(grossGoal, markup);
      if (totalGoalActual <= 0) continue;

      const periodAds = ads.filter((a) => a.plan.accountKey === plan.accountKey && a.period === budget.period);
      const totalAlloc = periodAds.reduce((s, a) => s + (Number(a.allocation ?? '') || 0), 0);
      if (totalAlloc <= totalGoalActual * 1.05) continue;

      const overshoot = totalAlloc - totalGoalActual;
      const title = `${plan.account.dealer} period over-allocated`;
      const body = `${budget.period}: $${totalAlloc.toFixed(2)} allocated / $${totalGoalActual.toFixed(2)} actual budget · over by $${overshoot.toFixed(2)}`;
      const link = `/tools/meta-ads-pacer`;
      const dedupeKey = `${plan.accountKey}:${budget.period}:over_allocated:${today}`;

      const recipientUserIds = new Set<string>();
      if (plan.accountRepId) recipientUserIds.add(plan.accountRepId);
      // Also notify everyone tagged on any ad in this period
      for (const ad of periodAds) for (const u of adRecipients(ad)) recipientUserIds.add(u);

      for (const userId of recipientUserIds) {
        const created = await createNotification({
          userId,
          type: 'period_over_allocated',
          severity: 'warning',
          title,
          body,
          link,
          meta: { accountKey: plan.accountKey, period: budget.period },
          dedupeKey,
          dedupeWindowHours: 20,
        });
        if (created) {
          result.notificationsCreated += 1;
          pushToDigest(userId, { title, body, link, severity: 'warning' });
        }
      }
    }
  }

  // ── Purge audit entries past the retention window (Change 10) ──
  try {
    const purged = await purgeOldAuditEntries();
    if (purged > 0) {
      // eslint-disable-next-line no-console
      console.log(`[meta-ads-pacer] purged ${purged} expired audit entries`);
    }
  } catch (err) {
    result.errors.push(
      `audit_purge:${err instanceof Error ? err.message : 'unknown'}`,
    );
  }

  // ── Send digest emails (one per recipient, summarising all of today's items) ──
  if (digestByUser.size > 0) {
    const userIds = [...digestByUser.keys()];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, name: true },
    });
    const usersById = new Map(users.map((u) => [u.id, u]));
    for (const [userId, items] of digestByUser) {
      const user = usersById.get(userId);
      if (!user?.email) continue;
      try {
        await sendDigestNotificationEmail({
          to: user.email,
          recipientName: user.name,
          items,
        });
        result.emailsSent += 1;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[notifications] digest send failed', err);
        result.errors.push(`digest:${userId}:${err instanceof Error ? err.message : 'unknown'}`);
      }
    }
  }

  return result;
}

// ──────────────────────────────────────────────────────────────────────────
// Inline triggers — called from app code on user-facing events
// ──────────────────────────────────────────────────────────────────────────

interface AssignmentChangeInput {
  newUserId: string;
  triggeringUserId: string;
  adId: string;
  adName: string;
  accountDealer: string;
  role: 'owner' | 'designer' | 'account rep';
}

/** Notify a user that they were just assigned to an ad. */
export async function notifyAssignment(input: AssignmentChangeInput) {
  if (input.newUserId === input.triggeringUserId) return; // don't notify self-assigns
  const title = `You're the ${input.role} on "${input.adName}"`;
  const body = `${input.accountDealer} · open the pacer to review your assignment.`;
  await createNotification({
    userId: input.newUserId,
    type: 'ad_assigned',
    severity: 'info',
    title,
    body,
    link: `/tools/meta-ads-pacer`,
    meta: { adId: input.adId, role: input.role },
    sendEmailNow: true,
  });
}

interface ApprovalChangeInput {
  recipientUserId: string;
  adId: string;
  adName: string;
  accountDealer: string;
  source: 'Internal' | 'Client';
  newStatus: string;
}

/** Notify the owner/designer when an approval status changes. */
export async function notifyApprovalChange(input: ApprovalChangeInput) {
  const severity: NotificationSeverity =
    input.newStatus === 'Does Not Approve' ? 'critical'
      : input.newStatus === 'Changes Requested' ? 'warning'
        : 'info';
  const title = `${input.source} ${input.newStatus.toLowerCase()} — "${input.adName}"`;
  const body = `${input.accountDealer} · open the ad to see details.`;
  await createNotification({
    userId: input.recipientUserId,
    type: 'approval_changed',
    severity,
    title,
    body,
    link: `/tools/meta-ads-pacer`,
    meta: { adId: input.adId, source: input.source, newStatus: input.newStatus },
    sendEmailNow: true,
  });
}
