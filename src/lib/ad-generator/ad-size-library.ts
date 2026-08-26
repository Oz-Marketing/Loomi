/**
 * Ad size library — the one list of sizes the Ad Generator designs against.
 *
 * There is no "app default" tier: every size is a row in `AdSizePreset`, and the
 * starters below exist only to give a fresh environment something to work with.
 * They're seeded into the table once (see `size-library-store.ts`), after which
 * they are ordinary rows — renamable, retaggable, removable.
 *
 * Sizes are organized by TAGS describing what they're used for ("Facebook",
 * "Display", "Email"), not by a fixed category. A 1080×1080 gets used on
 * Instagram, in email and in display; one bucket could never say that, and the
 * fixed buckets also stranded anything bespoke in a "Custom" pile.
 *
 * Client-safe (no prisma import) — pickers and the library page share it.
 */

/** A size as the app uses it: a library row, or a starter before it's seeded. */
export interface AdSize {
  name: string;
  width: number;
  height: number;
  /** What it's used for. Free-form; the vocabulary is whatever's in use. */
  tags: string[];
}

/** A size as it comes back from `/api/ad-generator/sizes` (a real row). */
export interface LibrarySize extends AdSize {
  id: string;
  createdByName?: string | null;
  createdByEmail?: string | null;
  createdByImage?: string | null;
  createdAt?: string;
}

export interface AdSizeStarter extends AdSize {
  /** Stable seed key — identifies this starter forever, even if renamed. */
  key: string;
}

/**
 * The starter set. Seeded into an empty library so a new environment isn't a
 * blank page; NOT consulted at read time (the DB is the source of truth) except
 * as a fallback when the table hasn't been migrated yet.
 */
// NO 728x90 LEADERBOARD. It was here and was removed deliberately: 90px cannot
// carry an offer ad. After the disclaimer takes its 22px frame there is not
// enough height left to give the offer figure its 34px floor and the two copy
// rows 14px each, so every composition degrades to ~14px of offer figure —
// complete, in-bounds and unreadable. Re-adding it means either accepting that
// or building a horizontal STRIP arrangement for boards too short to stack.
export const AD_SIZE_STARTERS: AdSizeStarter[] = [
  { key: 'facebook-feed', name: 'Facebook Feed', width: 1200, height: 628, tags: ['Facebook', 'Social'] },
  { key: 'facebook-story', name: 'Facebook Story', width: 1080, height: 1920, tags: ['Facebook', 'Social', 'Story'] },
  { key: 'instagram-square', name: 'Instagram Square', width: 1080, height: 1080, tags: ['Instagram', 'Social'] },
  { key: 'instagram-portrait', name: 'Instagram Portrait', width: 1080, height: 1350, tags: ['Instagram', 'Social'] },
  { key: 'instagram-story', name: 'Instagram Story / Reels', width: 1080, height: 1920, tags: ['Instagram', 'Social', 'Story'] },
  { key: 'tiktok-video', name: 'TikTok Video', width: 1080, height: 1920, tags: ['TikTok', 'Social', 'Story'] },
  { key: 'linkedin-sponsored', name: 'LinkedIn Sponsored', width: 1200, height: 627, tags: ['LinkedIn', 'Social'] },
  { key: 'x-post', name: 'X / Twitter Post', width: 1200, height: 675, tags: ['X', 'Social'] },
  { key: 'youtube-thumbnail', name: 'YouTube Thumbnail', width: 1280, height: 720, tags: ['YouTube', 'Video'] },
  { key: 'medium-rectangle', name: 'Medium Rectangle', width: 300, height: 250, tags: ['Google', 'Display'] },
  { key: 'wide-skyscraper', name: 'Wide Skyscraper', width: 160, height: 600, tags: ['Google', 'Display'] },
  { key: 'large-rectangle', name: 'Large Rectangle', width: 336, height: 280, tags: ['Google', 'Display'] },
  { key: 'half-page', name: 'Half Page', width: 300, height: 600, tags: ['Google', 'Display'] },
  { key: 'billboard', name: 'Billboard', width: 970, height: 250, tags: ['Google', 'Display'] },
  { key: 'email-header', name: 'Email Header', width: 600, height: 200, tags: ['Email'] },
  { key: 'email-banner', name: 'Email Banner', width: 600, height: 400, tags: ['Email'] },
];

/** Label for sizes carrying no tags at all — its own bucket in filters. */
export const UNTAGGED = 'Untagged';

/** JSON string[] column → string[]. Tolerates null, junk, and non-string items. */
export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return normalizeTags(v.filter((t): t is string => typeof t === 'string'));
  } catch {
    return [];
  }
}

/** Trim, drop blanks, de-dupe case-insensitively (first spelling wins), sort. */
export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Map<string, string>();
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const trimmed = t.trim();
    if (!trimmed) continue;
    const k = trimmed.toLowerCase();
    if (!seen.has(k)) seen.set(k, trimmed);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Every tag in use across a set of sizes, A→Z, with counts. */
export function tagFacets(sizes: AdSize[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  let untagged = 0;
  for (const s of sizes) {
    if (!s.tags.length) untagged += 1;
    for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const facets = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
  // Untagged sits last — it's a gap to fill, not a category.
  if (untagged) facets.push({ tag: UNTAGGED, count: untagged });
  return facets;
}

/**
 * Filter by selected tags (OR — a size matching any selection shows) plus a
 * free-text query over name and dimensions. Empty selection = everything, which
 * is what makes "All" the default view rather than a bucket you have to pick.
 */
export function filterSizes<T extends AdSize>(sizes: T[], selectedTags: string[], query = ''): T[] {
  const q = query.trim().toLowerCase();
  return sizes.filter((s) => {
    if (selectedTags.length) {
      const hit = selectedTags.some((t) => (t === UNTAGGED ? s.tags.length === 0 : s.tags.includes(t)));
      if (!hit) return false;
    }
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      `${s.width}x${s.height}`.includes(q.replace(/[×x\s]/g, 'x')) ||
      s.tags.some((t) => t.toLowerCase().includes(q))
    );
  });
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
