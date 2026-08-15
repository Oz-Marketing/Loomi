/**
 * Campaign labels + the label-scoped event budget (google-pacing-card spec §9).
 *
 * Labels tag a line so it can be viewed as a slice — primarily for sales events,
 * where extra budget is added to a store's total and has to be tracked on its
 * own rather than disappearing into the regular allocation.
 *
 * Two deliberate boundaries:
 *
 *  1. A label is INDEPENDENT of `budgetSource` (base/added). They answer
 *     different questions — "which pool pays for this" vs "which push is this
 *     part of" — and a campaign can easily be base-funded and event-tagged. Any
 *     rule that derived one from the other would move money between pools as a
 *     side effect of tagging, which is exactly the accident this separation
 *     prevents.
 *  2. An event budget is a CHECK, never a denominator. Unfiltered, allocation is
 *     always measured against payable (§9); the event budget only says whether
 *     the dollars intended for a label actually landed on the tagged campaigns.
 *
 * Storage is a JSON array on the ad (`pacerTags`) and a JSON map on the period
 * budget (`googleEventBudgets`). Both are parsed exclusively through this file so
 * a malformed value degrades to "no labels" instead of throwing inside a render.
 * Pure data — no React, no DB, usable on both sides of the wire.
 */

/** Longest label we accept. Matches the mockup's input maxlength; long enough
 *  for "Summer Sales Event", short enough to stay a chip and not a paragraph. */
export const MAX_LABEL_LENGTH = 28;

/**
 * Read an ad's labels. Tolerates every shape a hand-edited or legacy row can
 * hold — null, "", "null", a bare string, a JSON object — because this runs
 * inside a table render where a throw is a blank page.
 */
export function parseTags(raw: string | null | undefined): string[] {
  if (raw == null) return [];
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === 'null' || trimmed === '[]') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Not JSON: treat a bare non-empty string as a single label rather than
    // silently dropping data someone clearly meant as a tag.
    return [normalizeLabel(trimmed)].filter(Boolean);
  }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'string') continue;
    const label = normalizeLabel(entry);
    // Case-insensitive de-dupe: "Branding" and "branding" are one label, and
    // keeping both would split a filter chip in two.
    if (label && !out.some((existing) => sameLabel(existing, label))) out.push(label);
  }
  return out;
}

/**
 * Serialize labels back to the stored column. Returns null (not "[]") for an
 * empty set so a never-tagged row and a de-tagged row look identical in the DB
 * and in the audit diff.
 */
export function serializeTags(tags: readonly string[]): string | null {
  const clean: string[] = [];
  for (const tag of tags) {
    const label = normalizeLabel(tag);
    if (label && !clean.some((existing) => sameLabel(existing, label))) clean.push(label);
  }
  return clean.length > 0 ? JSON.stringify(clean) : null;
}

/** Collapse whitespace and clamp length. Labels are typed by hand into a chip,
 *  so a stray double space or a pasted newline shouldn't fork a filter. */
export function normalizeLabel(raw: string): string {
  return String(raw).replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LENGTH);
}

/** Labels compare case-insensitively everywhere — filter, de-dupe, event budget
 *  lookup — so the same event can't exist twice under different casing. */
export function sameLabel(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function hasTag(raw: string | null | undefined, label: string): boolean {
  return parseTags(raw).some((tag) => sameLabel(tag, label));
}

/** Toggle one label on an ad's stored tag string, returning the new value. */
export function toggleTag(raw: string | null | undefined, label: string): string | null {
  const normalized = normalizeLabel(label);
  if (!normalized) return raw ?? null;
  const tags = parseTags(raw);
  const next = tags.some((tag) => sameLabel(tag, normalized))
    ? tags.filter((tag) => !sameLabel(tag, normalized))
    : [...tags, normalized];
  return serializeTags(next);
}

/**
 * Every label in use across a set of rows, in first-appearance order. Order is
 * stable rather than alphabetical so the filter chips don't reshuffle under the
 * cursor when a tag is added, and so each label's color (assigned by index)
 * stays put.
 */
export function collectLabels(
  ads: readonly { pacerTags?: string | null }[],
): string[] {
  const seen: string[] = [];
  for (const ad of ads) {
    for (const tag of parseTags(ad.pacerTags)) {
      if (!seen.some((existing) => sameLabel(existing, tag))) seen.push(tag);
    }
  }
  return seen;
}

export function countByLabel(
  ads: readonly { pacerTags?: string | null }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const label of collectLabels(ads)) {
    counts.set(
      label,
      ads.filter((ad) => hasTag(ad.pacerTags, label)).length,
    );
  }
  return counts;
}

/** Label palette — distinct from the per-campaign colors (which identify a ROW
 *  in the meter) so a label chip is never mistaken for a campaign swatch. */
export const LABEL_COLORS = [
  '#f59e0b',
  '#a78bfa',
  '#22c55e',
  '#f472b6',
  '#38bdf8',
  '#fb923c',
] as const;

/** A label's color, keyed by its position in the account's label list so the
 *  same event keeps its color across renders. Unknown labels fall to the first. */
export function labelColor(label: string, allLabels: readonly string[]): string {
  const idx = allLabels.findIndex((existing) => sameLabel(existing, label));
  return LABEL_COLORS[(idx < 0 ? 0 : idx) % LABEL_COLORS.length];
}

// ── Event budgets (§9) ──

/**
 * Parse the stored `label -> intended budget` map. Non-finite and negative
 * amounts are dropped rather than clamped: a garbage value would otherwise
 * render as a confident "≠ budget" mismatch against a number nobody entered.
 */
export function parseEventBudgets(
  raw: string | null | undefined,
): Record<string, number> {
  if (raw == null) return {};
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === 'null' || trimmed === '{}') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {};
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const label = normalizeLabel(key);
    const amount = Number(value);
    if (!label || !Number.isFinite(amount) || amount <= 0) continue;
    out[label] = amount;
  }
  return out;
}

export function serializeEventBudgets(
  map: Record<string, number> | null | undefined,
): string | null {
  if (!map) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(map)) {
    const label = normalizeLabel(key);
    const amount = Number(value);
    if (!label || !Number.isFinite(amount) || amount <= 0) continue;
    out[label] = amount;
  }
  return Object.keys(out).length > 0 ? JSON.stringify(out) : null;
}

/** Look a label's event budget up case-insensitively (labels are typed by hand,
 *  and the map's keys were typed at a different time than the tag). */
export function eventBudgetFor(
  budgets: Record<string, number> | null | undefined,
  label: string | null,
): number | null {
  if (!budgets || !label) return null;
  for (const [key, value] of Object.entries(budgets)) {
    if (sameLabel(key, label)) return value;
  }
  return null;
}
