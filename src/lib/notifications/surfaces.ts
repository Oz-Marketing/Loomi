// Client-safe notification metadata — NO server imports (prisma/pg), so this can
// be imported by client components. The full registry lives in ./types.ts, which
// pulls in prisma and must stay server-only.

export type NotificationCategory =
  | 'Meta Ads Planner'
  | 'Projects'
  | 'Ad Generator'
  | 'Asset Library'
  | 'Playbooks'
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
  // The coverage sweep and the playbook library both live on Studio, and the
  // audit's checks straddle both hosts — see docs/playbooks.md §4b.
  Playbooks: 'studio',
  // Changelog entries describe the whole product, and the changelog panel is in
  // the top bar on every surface — so the opt-out has to be reachable from
  // wherever the user happens to be when they decide they've had enough.
  'Product Updates': 'both',
};

/**
 * How a category presents itself in the bell panel.
 *
 * WHY THIS IS DATA AND NOT INLINE IN THE PANEL. The panel is one reader; the
 * settings tab groups by the same categories and should wear the same colours.
 * A second copy in the component is how the two drift until an "Ad Generator"
 * row is blue in one place and amber in the other.
 *
 * `kind` is the distinction Connor asked for: PRODUCT news is about Loomi
 * itself and applies to everyone, TOOL output is a specific surface telling you
 * something happened in your account. They read differently, so they should
 * look different — product news is deliberately neutral, tools wear a colour.
 */
export interface NotificationCategoryStyle {
  /** Icon key — the panel maps this to a component; this file stays React-free. */
  icon: 'megaphone' | 'chart' | 'clipboard' | 'photo' | 'book' | 'sparkles';
  /** Icon-tile foreground and background classes. */
  accent: string;
  tint: string;
  kind: 'product' | 'tool';
  /**
   * Which SECTOR this category belongs to, in the vocabulary the permission
   * registry already uses (studio / reporting / projects).
   *
   * Distinct from `NOTIFICATION_CATEGORY_SURFACE`, which answers a narrower
   * question — which settings HOST shows the toggle, studio or app. A person
   * filtering their bell thinks in sectors, not hosts: "Projects" and "pacing"
   * both live on the App host but are nothing like each other.
   *
   * `null` means it belongs to no one sector and shows under every filter.
   */
  sector: 'studio' | 'reporting' | 'projects' | null;
}

export const NOTIFICATION_CATEGORY_STYLE: Record<
  NotificationCategory,
  NotificationCategoryStyle
> = {
  'Ad Generator': {
    icon: 'megaphone',
    accent: 'text-sky-500 dark:text-sky-400',
    tint: 'bg-sky-500/12',
    kind: 'tool',
    sector: 'studio',
  },
  'Meta Ads Planner': {
    icon: 'chart',
    accent: 'text-violet-500 dark:text-violet-400',
    tint: 'bg-violet-500/12',
    kind: 'tool',
    // PROJECTS, not Reporting. The chart icon and the word "Planner" make this
    // look like a reporting surface, but every notification in the category is
    // pacing — account pace, budget burn, ad went dark, flight ending — which
    // is paced media, and paced media is Projects. It also matches
    // NOTIFICATION_CATEGORY_SURFACE, which already puts it on the App host.
    sector: 'projects',
  },
  Projects: {
    icon: 'clipboard',
    accent: 'text-emerald-500 dark:text-emerald-400',
    tint: 'bg-emerald-500/12',
    kind: 'tool',
    sector: 'projects',
  },
  'Asset Library': {
    icon: 'photo',
    accent: 'text-amber-500 dark:text-amber-400',
    tint: 'bg-amber-500/12',
    kind: 'tool',
    sector: 'studio',
  },
  Playbooks: {
    icon: 'book',
    accent: 'text-rose-500 dark:text-rose-400',
    tint: 'bg-rose-500/12',
    kind: 'tool',
    sector: 'studio',
  },
  'Product Updates': {
    // Neutral on purpose — this is Loomi talking about itself, not your account
    // telling you something needs a decision.
    icon: 'sparkles',
    accent: 'text-[var(--muted-foreground)]',
    tint: 'bg-[var(--muted)]',
    kind: 'product',
    sector: null,
  },
};
