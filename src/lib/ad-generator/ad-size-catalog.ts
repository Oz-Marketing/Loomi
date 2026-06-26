/**
 * Standard ad-size catalog — the canonical set of platform sizes the builder
 * designs against. Baked into code (not the DB) so they're always available in
 * every environment and never accidentally deleted. The DB `AdSizePreset`
 * library is for CUSTOM sizes a team adds on top of these.
 *
 * Grouped by `category` for the picker; `aspect` is derived (display only).
 */

export type AdSizeCategory = 'social' | 'display' | 'email';

export interface CatalogSize {
  /** Display name, e.g. "Instagram Square". Unique within the catalog. */
  name: string;
  /** Platform label, e.g. "Instagram", "Google". */
  platform: string;
  category: AdSizeCategory;
  width: number;
  height: number;
}

export const AD_SIZE_CATALOG: CatalogSize[] = [
  // ── Social ──
  { name: 'Facebook Feed', platform: 'Facebook', category: 'social', width: 1200, height: 628 },
  { name: 'Facebook Story', platform: 'Facebook', category: 'social', width: 1080, height: 1920 },
  { name: 'Instagram Square', platform: 'Instagram', category: 'social', width: 1080, height: 1080 },
  { name: 'Instagram Portrait', platform: 'Instagram', category: 'social', width: 1080, height: 1350 },
  { name: 'Instagram Story / Reels', platform: 'Instagram', category: 'social', width: 1080, height: 1920 },
  { name: 'TikTok Video', platform: 'TikTok', category: 'social', width: 1080, height: 1920 },
  { name: 'LinkedIn Sponsored', platform: 'LinkedIn', category: 'social', width: 1200, height: 627 },
  { name: 'X / Twitter Post', platform: 'X/Twitter', category: 'social', width: 1200, height: 675 },
  { name: 'YouTube Thumbnail', platform: 'YouTube', category: 'social', width: 1280, height: 720 },
  // ── Display ──
  { name: 'Medium Rectangle', platform: 'Google', category: 'display', width: 300, height: 250 },
  { name: 'Leaderboard', platform: 'Google', category: 'display', width: 728, height: 90 },
  { name: 'Wide Skyscraper', platform: 'Google', category: 'display', width: 160, height: 600 },
  { name: 'Large Rectangle', platform: 'Google', category: 'display', width: 336, height: 280 },
  { name: 'Half Page', platform: 'Google', category: 'display', width: 300, height: 600 },
  { name: 'Billboard', platform: 'Google', category: 'display', width: 970, height: 250 },
  // ── Email ──
  { name: 'Email Header', platform: 'Email', category: 'email', width: 600, height: 200 },
  { name: 'Email Banner', platform: 'Email', category: 'email', width: 600, height: 400 },
];

export const AD_SIZE_CATEGORY_LABEL: Record<AdSizeCategory, string> = {
  social: 'Social',
  display: 'Display',
  email: 'Email',
};

/** Catalog grouped by category, in a stable display order. */
export function catalogByCategory(): { category: AdSizeCategory; label: string; sizes: CatalogSize[] }[] {
  const order: AdSizeCategory[] = ['social', 'display', 'email'];
  return order.map((category) => ({
    category,
    label: AD_SIZE_CATEGORY_LABEL[category],
    sizes: AD_SIZE_CATALOG.filter((s) => s.category === category),
  }));
}

/** Reduce a W×H to its simplest ratio string, e.g. 1200×628 → "1.91:1". */
export function aspectLabel(width: number, height: number): string {
  const g = gcd(width, height);
  const w = width / g;
  const h = height / g;
  // Keep tidy ratios exact; otherwise show a decimal-to-1 form.
  if (w <= 32 && h <= 32) return `${w}:${h}`;
  return `${(width / height).toFixed(2)}:1`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
