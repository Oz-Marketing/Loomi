/**
 * DAM metadata vocabularies for `MediaAsset` — Phase 1 of
 * docs/asset-management.md.
 *
 * Deliberately separate from `media-categories.ts`. That file's
 * `MEDIA_CATEGORIES` answers "which tab of the media picker does this show
 * under" (general / brand / texture / ad-creative / oem) and the ad builder's
 * Textures tab depends on it. The vocabularies here answer the DAM questions:
 * what kind of asset is this, and where did it come from. Merging the two would
 * produce an incoherent list — `texture` is a purpose, `oem` is a source,
 * `Display` is a medium — and would break the builder.
 *
 * Every value here is a controlled vocabulary, not free text: a classification
 * field that accepts anything stops being a filter within a quarter.
 */

// ── Asset category (what kind of asset) ──

export const ASSET_CATEGORIES = [
  { value: 'display', label: 'Display' },
  { value: 'social', label: 'Social' },
  { value: 'video', label: 'Video' },
  { value: 'print', label: 'Print' },
  { value: 'email', label: 'Email' },
  { value: 'logo', label: 'Logo' },
  { value: 'photography', label: 'Photography' },
  { value: 'template', label: 'Template' },
  { value: 'document', label: 'Document' },
] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number]['value'];

export function assetCategoryLabel(value?: string | null): string | null {
  if (!value) return null;
  return ASSET_CATEGORIES.find((c) => c.value === value)?.label ?? null;
}

export function isAssetCategory(value: unknown): value is AssetCategory {
  return typeof value === 'string' && ASSET_CATEGORIES.some((c) => c.value === value);
}

// ── Source (where it came from) ──
//
// Drives the card badge and, later, the rights defaults: an OEM-supplied asset
// carries the manufacturer's licence terms, an Oz-created one does not.

export const ASSET_SOURCES = [
  { value: 'oem-supplied', label: 'OEM-supplied' },
  { value: 'oz-created', label: 'Oz-created' },
  { value: 'stock', label: 'Stock' },
  { value: 'dealer-supplied', label: 'Dealer-supplied' },
] as const;

export type AssetSource = (typeof ASSET_SOURCES)[number]['value'];

export function assetSourceLabel(value?: string | null): string | null {
  if (!value) return null;
  return ASSET_SOURCES.find((s) => s.value === value)?.label ?? null;
}

export function isAssetSource(value: unknown): value is AssetSource {
  return typeof value === 'string' && ASSET_SOURCES.some((s) => s.value === value);
}

// ── Multi-value fields ──
//
// `modelYear` and `vehicleModel` are stored as JSON arrays because a single
// asset legitimately spans several values — an Audi "MY25_MY26 DAG" template
// covers two model years, and collapsing that to one loses the fact that it is
// valid for both. Same reason `ad-facets.ts` makes every facet a list.

/** Parse a stored JSON array column into a string[]. Never throws. */
export function parseListColumn(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => String(v).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Coerce a client-supplied value into a string list.
 *
 * Accepts an array (JSON bodies), a JSON-encoded array, or a comma-separated
 * string — because upload goes through `FormData`, where everything is a string,
 * while PATCH sends JSON. Both paths land here so the two can't diverge.
 */
export function coerceList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value !== 'string') return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch {
      // Fall through to comma-splitting — a malformed JSON array is more likely
      // a value that happens to start with '[' than a broken client.
    }
  }

  return trimmed.split(',').map((v) => v.trim()).filter(Boolean);
}

/** Serialize a list for storage. Empty → null, so "unset" stays distinguishable. */
export function serializeListColumn(values: unknown): string | null {
  if (!Array.isArray(values)) return null;
  const cleaned = values.map((v) => String(v).trim()).filter(Boolean);
  const unique = [...new Set(cleaned)];
  return unique.length > 0 ? JSON.stringify(unique) : null;
}

/**
 * Model years, normalized to 4-digit strings and sorted.
 *
 * Kept as strings rather than integers so the column round-trips through the
 * same JSON list helpers as `vehicleModel`, and so a malformed value degrades
 * to "dropped" instead of `NaN`.
 */
export function serializeModelYears(values: unknown): string | null {
  if (!Array.isArray(values)) return null;
  const years = values
    .map((v) => String(v).trim())
    .filter((v) => /^\d{4}$/.test(v));
  const unique = [...new Set(years)].sort();
  return unique.length > 0 ? JSON.stringify(unique) : null;
}
