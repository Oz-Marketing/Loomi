// Client-safe notification metadata — NO server imports (prisma/pg), so this can
// be imported by client components. The full registry lives in ./types.ts, which
// pulls in prisma and must stay server-only.

export type NotificationCategory = 'Meta Ads Planner' | 'Projects';

/**
 * Which settings surface each notification category belongs to. The Notifications
 * settings tab shows only the categories for the current surface. Both current
 * categories live on the App — Projects, and the Ad Pacer (Meta Ads Planner)
 * which moved to the App. Studio has no notification types yet; add a
 * Studio-mapped category here when it does.
 */
export const NOTIFICATION_CATEGORY_SURFACE: Record<NotificationCategory, 'studio' | 'app'> = {
  'Meta Ads Planner': 'app',
  Projects: 'app',
};
