import { prisma } from '@/lib/prisma';

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
  | 'approval_changed';

export interface NotificationTypeMeta {
  type: NotificationType;
  label: string;
  description: string;
  category: 'Meta Ads Planner';
  channel: 'digest' | 'immediate';
  defaultEnabled: boolean;
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
    defaultEnabled: true,
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
    type: 'ad_assigned',
    label: 'You were assigned to an ad',
    description: 'You became the owner, designer, or account rep on an ad.',
    category: 'Meta Ads Planner',
    channel: 'immediate',
    defaultEnabled: true,
  },
  {
    type: 'approval_changed',
    label: 'Approval status changed',
    description: 'Account rep or client approval flipped on an ad you own or design.',
    category: 'Meta Ads Planner',
    channel: 'immediate',
    defaultEnabled: true,
  },
];

const REGISTRY_BY_TYPE: Record<NotificationType, NotificationTypeMeta> = Object.fromEntries(
  NOTIFICATION_TYPE_REGISTRY.map((meta) => [meta.type, meta]),
) as Record<NotificationType, NotificationTypeMeta>;

export function getNotificationTypeMeta(type: NotificationType): NotificationTypeMeta {
  return REGISTRY_BY_TYPE[type];
}

/**
 * Resolve effective enabled state for a (userId, type) pair. Defaults follow
 * `defaultEnabled` from the registry when there's no explicit row.
 */
export async function isNotificationEnabled(
  userId: string,
  type: NotificationType,
): Promise<boolean> {
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId_type: { userId, type } },
  });
  if (pref) return pref.enabled;
  return REGISTRY_BY_TYPE[type]?.defaultEnabled ?? true;
}

/** Bulk-resolve preferences for many users — used by the scan job to avoid N queries. */
export async function loadEnabledMap(
  userIds: string[],
): Promise<Map<string, Set<NotificationType>>> {
  if (userIds.length === 0) return new Map();
  const prefs = await prisma.notificationPreference.findMany({
    where: { userId: { in: userIds } },
  });
  const explicit = new Map<string, Map<string, boolean>>();
  for (const p of prefs) {
    if (!explicit.has(p.userId)) explicit.set(p.userId, new Map());
    explicit.get(p.userId)!.set(p.type, p.enabled);
  }
  const result = new Map<string, Set<NotificationType>>();
  for (const userId of userIds) {
    const enabledTypes = new Set<NotificationType>();
    for (const meta of NOTIFICATION_TYPE_REGISTRY) {
      const explicitVal = explicit.get(userId)?.get(meta.type);
      const on = explicitVal === undefined ? meta.defaultEnabled : explicitVal;
      if (on) enabledTypes.add(meta.type);
    }
    result.set(userId, enabledTypes);
  }
  return result;
}
