import { prisma } from '@/lib/prisma';
import type { NotificationCategory } from './surfaces';

export type NotificationType =
  | 'ad_due_soon'
  | 'ad_overdue'
  | 'approval_pending'
  | 'status_stuck'
  | 'pacing_alert'
  | 'ad_dark'
  | 'flight_ending'
  | 'period_over_allocated'
  | 'ad_assigned'
  | 'approval_changed'
  // §9 — config-driven alert engine (Meta channel)
  | 'alert_account_pace'
  | 'alert_budget_burn'
  // Projects (App surface)
  | 'task_assigned'
  | 'ticket_filed'
  | 'task_due_soon'
  | 'task_overdue'
  | 'task_comment'
  | 'task_mention'
  // Ad Generator (Studio surface) — autonomous generation
  | 'incentive_ads_ready'
  | 'coop_guideline_changed'
  // Playbooks (Studio surface) — nightly coverage sweep
  | 'playbook_drift'
  // Media Library (Studio surface) — rights management
  | 'asset_rights_expiring'
  | 'asset_rights_expired'
  // Changelog (both surfaces) — product release notes
  | 'product_update';

export interface NotificationTypeMeta {
  type: NotificationType;
  label: string;
  description: string;
  category: NotificationCategory;
  channel: 'digest' | 'immediate';
  /** Default for the in-app bell panel. */
  defaultEnabled: boolean;
  /**
   * Default for email. Separate from `defaultEnabled` so a type can show in the
   * panel by default without also defaulting to mail. Omit to follow
   * `defaultEnabled`, which is what every pre-split type does.
   */
  defaultEmailEnabled?: boolean;
}

/** A user's resolved delivery choice for one notification type. */
export interface NotificationChannels {
  inApp: boolean;
  email: boolean;
}

/** Single source of truth for the notification catalog. UI reads this, the
 *  service reads this, the digest job reads this. */
export const NOTIFICATION_TYPE_REGISTRY: NotificationTypeMeta[] = [
  {
    type: 'ad_due_soon',
    label: 'Ad due soon',
    description: 'Heads up when an ad is approaching its due date (within 2 days).',
    category: 'Meta Ads Planner',
    channel: 'digest',
    defaultEnabled: true,
  },
  {
    type: 'ad_overdue',
    label: 'Ad overdue',
    description: 'Alert when an ad has passed its due date and is not yet Live.',
    category: 'Meta Ads Planner',
    channel: 'digest',
    defaultEnabled: true,
  },
  {
    type: 'approval_pending',
    label: 'Approval stuck pending',
    description:
      'Internal or client approval has been pending for more than 3 days without movement.',
    category: 'Meta Ads Planner',
    channel: 'digest',
    defaultEnabled: false,
  },
  {
    type: 'status_stuck',
    label: 'Ad in Stuck status',
    description: 'An ad has been in `Stuck` status for more than 2 days.',
    category: 'Meta Ads Planner',
    channel: 'digest',
    defaultEnabled: true,
  },
  {
    type: 'pacing_alert',
    label: 'Pacing off-track',
    description:
      'Over-pacing (>110%), early under-pacing (<50%), or a significant underspend (>15% under) with little flight left to recover.',
    category: 'Meta Ads Planner',
    channel: 'digest',
    defaultEnabled: true,
  },
  {
    type: 'ad_dark',
    label: 'Ad went dark',
    description:
      'A live, in-flight ad that Meta now reports as paused/off — it may have stopped delivering unnoticed.',
    category: 'Meta Ads Planner',
    channel: 'digest',
    defaultEnabled: true,
  },
  {
    type: 'flight_ending',
    label: 'Flight ending soon',
    description: 'An active ad is ending in the next day or two — time for a final reconciliation.',
    category: 'Meta Ads Planner',
    channel: 'digest',
    defaultEnabled: true,
  },
  {
    type: 'period_over_allocated',
    label: 'Period over-allocated',
    description: 'Total allocation in a period exceeds the budget goal by more than 5%.',
    category: 'Meta Ads Planner',
    channel: 'digest',
    defaultEnabled: true,
  },
  {
    type: 'alert_account_pace',
    label: 'Account pacing off-target (alert engine)',
    description:
      'The account is pacing outside its target band (over 110% or under 85% of expected-to-date) for the live month. Thresholds are yours to set under Alerts.',
    category: 'Meta Ads Planner',
    channel: 'digest',
    defaultEnabled: true,
  },
  {
    type: 'alert_budget_burn',
    label: 'Budget burning early (alert engine)',
    description:
      'A campaign has spent most of its monthly budget with several flight-days still to go, so it may run dry early. Thresholds are yours to set under Alerts.',
    category: 'Meta Ads Planner',
    channel: 'digest',
    defaultEnabled: true,
  },
  {
    type: 'ad_assigned',
    label: 'You were assigned to an ad',
    description: 'You became the owner, designer, or account rep on an ad.',
    category: 'Meta Ads Planner',
    channel: 'immediate',
    defaultEnabled: false,
  },
  {
    type: 'approval_changed',
    label: 'Approval status changed',
    description: 'Account rep or client approval flipped on an ad you own or design.',
    category: 'Meta Ads Planner',
    channel: 'immediate',
    defaultEnabled: false,
  },
  // ── Projects ──
  {
    type: 'task_assigned',
    label: 'Task assigned to you',
    description: 'You were assigned a task in a Projects initiative.',
    category: 'Projects',
    channel: 'immediate',
    defaultEnabled: true,
  },
  {
    type: 'ticket_filed',
    label: 'Ticket filed to your team',
    description: 'A new ticket was filed to a team you lead.',
    category: 'Projects',
    channel: 'immediate',
    defaultEnabled: true,
  },
  {
    type: 'task_due_soon',
    label: 'Task due soon',
    description: 'A task assigned to you is approaching its due date.',
    category: 'Projects',
    channel: 'digest',
    defaultEnabled: true,
  },
  {
    type: 'task_overdue',
    label: 'Task overdue',
    description: 'A task assigned to you has passed its due date and is not done.',
    category: 'Projects',
    channel: 'digest',
    defaultEnabled: true,
  },
  {
    type: 'task_comment',
    label: 'New comment on your task',
    description: 'Someone commented on a task assigned to you.',
    category: 'Projects',
    channel: 'immediate',
    defaultEnabled: true,
  },
  {
    type: 'task_mention',
    label: 'You were mentioned',
    description: 'Someone @mentioned you in a task comment.',
    category: 'Projects',
    channel: 'immediate',
    defaultEnabled: true,
  },
  {
    type: 'incentive_ads_ready',
    label: 'OEM offer ads ready to review',
    description:
      'The Ad Generator built draft ads from new manufacturer offers. Nothing publishes until a person approves them.',
    category: 'Ad Generator',
    // Immediate, not digest: these are time-boxed by the offer's own expiry, and a
    // day's delay can be a meaningful chunk of the window an offer is valid for.
    channel: 'immediate',
    defaultEnabled: true,
  },
  {
    type: 'coop_guideline_changed',
    label: 'Co-op guideline document changed',
    description:
      'A manufacturer reissued a co-op guideline document. The templates for that make should be re-checked against it.',
    category: 'Ad Generator',
    // Immediate: every ad generated between the reissue and someone noticing is
    // built against rules that may no longer be in force.
    channel: 'immediate',
    defaultEnabled: true,
  },
  {
    type: 'playbook_drift',
    label: 'Playbook check started blocking',
    description:
      'The nightly coverage sweep found a blocking check that was passing before. Only NEW failures alert — a standing backlog does not re-announce itself every morning.',
    category: 'Playbooks',
    // Immediate: a blocking check means publishing is impossible for that
    // rooftop, so every day it sits unnoticed is a day of nothing shipping.
    channel: 'immediate',
    defaultEnabled: true,
  },
  {
    type: 'asset_rights_expiring',
    label: 'Asset licence expiring',
    description:
      'A media asset\u2019s licence or effective date is approaching (30 days out, then 7). Time to renew or plan a replacement.',
    category: 'Asset Library',
    // Digest: a licence 30 days out is a planning item, not an interruption.
    channel: 'digest',
    defaultEnabled: true,
  },
  {
    type: 'asset_rights_expired',
    label: 'Asset out of licence',
    description:
      'A media asset has passed its licence or effective date. Creative still using it should be replaced.',
    category: 'Asset Library',
    // Immediate: an asset in live creative past its licence is active exposure.
    channel: 'immediate',
    defaultEnabled: true,
  },
  {
    type: 'product_update',
    label: 'New in Loomi',
    description:
      'Release notes when something ships — new features, improvements, and fixes. One notification per release, not one per change.',
    category: 'Product Updates',
    // Immediate, but the fan-out batches a whole release into a single
    // notification, so "immediate" here means "when Publish is pressed", not
    // once per entry.
    channel: 'immediate',
    defaultEnabled: true,
    // In the panel by default, but not in the inbox: an unsolicited product
    // email is a different kind of intrusion from an alert someone's work
    // depends on. Users opt in from Settings → Notifications.
    defaultEmailEnabled: false,
  },
];

const REGISTRY_BY_TYPE: Record<NotificationType, NotificationTypeMeta> = Object.fromEntries(
  NOTIFICATION_TYPE_REGISTRY.map((meta) => [meta.type, meta]),
) as Record<NotificationType, NotificationTypeMeta>;

export function getNotificationTypeMeta(type: NotificationType): NotificationTypeMeta {
  return REGISTRY_BY_TYPE[type];
}

/** Registry defaults for a type, with `defaultEmailEnabled` falling back to the in-app default. */
export function defaultChannels(type: NotificationType): NotificationChannels {
  const meta = REGISTRY_BY_TYPE[type];
  const inApp = meta?.defaultEnabled ?? true;
  return { inApp, email: meta?.defaultEmailEnabled ?? inApp };
}

/**
 * Resolve effective delivery channels for a (userId, type) pair. Defaults come
 * from the registry when there's no explicit row.
 */
export async function resolveChannels(
  userId: string,
  type: NotificationType,
): Promise<NotificationChannels> {
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId_type: { userId, type } },
  });
  if (pref) return { inApp: pref.enabled, email: pref.emailEnabled };
  return defaultChannels(type);
}

/** Bulk-resolve channels for many users — one query instead of N. */
export async function loadChannelMap(
  userIds: string[],
  type: NotificationType,
): Promise<Map<string, NotificationChannels>> {
  const result = new Map<string, NotificationChannels>();
  if (userIds.length === 0) return result;

  const prefs = await prisma.notificationPreference.findMany({
    where: { userId: { in: userIds }, type },
    select: { userId: true, enabled: true, emailEnabled: true },
  });
  const explicit = new Map(
    prefs.map((p) => [p.userId, { inApp: p.enabled, email: p.emailEnabled }]),
  );

  const fallback = defaultChannels(type);
  for (const userId of userIds) {
    result.set(userId, explicit.get(userId) ?? fallback);
  }
  return result;
}
