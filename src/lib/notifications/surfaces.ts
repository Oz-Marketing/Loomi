// Client-safe notification metadata — NO server imports (prisma/pg), so this can
// be imported by client components. The full registry lives in ./types.ts, which
// pulls in prisma and must stay server-only.

export type NotificationCategory =
  | 'Meta Ads Planner'
  | 'Projects'
  | 'Ad Generator'
  | 'Asset Library'
  | 'Product Updates';

/**
 * Which settings surface each notification category belongs to. The Notifications
 * settings tab shows only the categories for the current surface. Most live on
 * the App — Projects, and the Ad Pacer (Meta Ads Planner) which moved to the App.
 * `both` puts a category on every surface, for things that aren't owned by one
 * side of the product.
 */
export const NOTIFICATION_CATEGORY_SURFACE: Record<
  NotificationCategory,
  'studio' | 'app' | 'both'
> = {
  'Meta Ads Planner': 'app',
  Projects: 'app',
  // First Studio-surfaced category: autonomous ad generation produces drafts that
  // need a human to review them, so somebody has to be told they exist.
  'Ad Generator': 'studio',
  // Asset rights expiry — the library lives on Studio alongside the generator
  // that consumes its assets.
  'Asset Library': 'studio',
  // Changelog entries describe the whole product, and the changelog panel is in
  // the top bar on every surface — so the opt-out has to be reachable from
  // wherever the user happens to be when they decide they've had enough.
  'Product Updates': 'both',
};
