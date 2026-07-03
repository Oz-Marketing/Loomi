/**
 * Media library categories. Stored as free-text on `MediaAsset.category`; this
 * is the canonical list the UI offers plus display labels. `texture` backs the
 * ad builder's reusable background textures/patterns — raw materials (topo
 * lines, grain, etc.) uploaded once per brand and reused across templates and
 * sizes, instead of baking a background per size in Illustrator.
 */
export const MEDIA_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'brand', label: 'Brand' },
  { value: 'texture', label: 'Textures' },
  { value: 'ad-creative', label: 'Ad creative' },
  { value: 'oem', label: 'OEM' },
] as const;

export type MediaCategory = (typeof MEDIA_CATEGORIES)[number]['value'];

/** Human label for a stored category value (falls back to General). */
export function mediaCategoryLabel(value?: string | null): string {
  return MEDIA_CATEGORIES.find((c) => c.value === value)?.label ?? 'General';
}
