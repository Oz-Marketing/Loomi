import { assetCategoryLabel, assetSourceLabel } from '@/lib/media-metadata';
import { RIGHTS_STATUS_LABELS, type RightsStatus } from '@/lib/media-rights';

/**
 * Facets for filtering the media library — Phase 2 of docs/asset-management.md.
 *
 * Same shape and behaviour as `ad-generator/ad-facets.ts`, deliberately: the two
 * lists sit one click apart in the same product, and a filter bar that behaves
 * differently in each is a filter bar nobody trusts. Values within one facet are
 * OR'd, facets are AND'd.
 *
 * The important difference from ad facets is where the values come from. An ad's
 * facets are DERIVED from data it already carries, because nobody will hand-tag
 * machine-built ads. An asset's classification is editorial — a person decides
 * that a zip is a Template rather than a Display — so these read the metadata
 * columns directly. The one thing not to do is invent a value the person didn't
 * choose: an asset with no `assetCategory` is "Unclassified", not a guess from
 * its MIME type, because a guess that is wrong is worse than an honest blank.
 */

export type MediaFacetKey = 'oem' | 'assetCategory' | 'assetSource' | 'modelYear' | 'rightsStatus';

/** Facet order is the render order — broad to narrow. */
export const MEDIA_FACET_KEYS: MediaFacetKey[] = [
  'oem',
  'assetCategory',
  'assetSource',
  'modelYear',
  // Last: it's the one facet people reach for deliberately ("what's expiring?")
  // rather than while browsing.
  'rightsStatus',
];

export const MEDIA_FACET_LABELS: Record<MediaFacetKey, string> = {
  oem: 'Brand',
  assetCategory: 'Asset type',
  assetSource: 'Source',
  modelYear: 'Model year',
  rightsStatus: 'Rights',
};

/**
 * The sentinel for "this asset has no value for this facet".
 *
 * A real selectable option rather than a hidden state: on a library that is
 * mid-migration, "which of these has nobody classified yet?" is the single most
 * useful question the filter bar can answer.
 */
export const UNSET = '__unset__';

export const UNSET_LABEL = 'Unclassified';

/** The subset of an asset this module reads. */
export interface FacetableAsset {
  oem?: string | null;
  assetCategory?: string | null;
  assetSource?: string | null;
  modelYear?: string[] | null;
  /** Derived server-side by serializeMediaAsset. */
  rights?: { status: RightsStatus } | null;
}

/** One asset's values, per facet. Always at least one entry — UNSET if empty. */
export type MediaFacetValues = Record<MediaFacetKey, string[]>;

/** A selection: facet → chosen values. Absent/empty = that facet is unfiltered. */
export type MediaFacetSelection = Partial<Record<MediaFacetKey, string[]>>;

function orUnset(values: (string | null | undefined)[]): string[] {
  const clean = values
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
  return clean.length > 0 ? clean : [UNSET];
}

/** Read one asset's facet values. */
export function facetsForAsset(a: FacetableAsset): MediaFacetValues {
  return {
    oem: orUnset([a.oem]),
    assetCategory: orUnset([a.assetCategory]),
    assetSource: orUnset([a.assetSource]),
    // Multi-valued: an OEM package spanning MY25 and MY26 must appear under both.
    modelYear: orUnset(a.modelYear ?? []),
    // Rights status is already a total function — every asset has one, and
    // 'unknown' is its own meaningful value — so it never falls back to UNSET.
    rightsStatus: [a.rights?.status ?? 'unknown'],
  };
}

/** Human label for a facet value. */
export function mediaFacetValueLabel(key: MediaFacetKey, value: string): string {
  if (value === UNSET) return UNSET_LABEL;
  if (key === 'assetCategory') return assetCategoryLabel(value) ?? value;
  if (key === 'assetSource') return assetSourceLabel(value) ?? value;
  if (key === 'rightsStatus') return RIGHTS_STATUS_LABELS[value as RightsStatus] ?? value;
  return value;
}

/**
 * Does an asset match the selection? Values within one facet are OR'd (Audi or
 * Honda), facets are AND'd (an Audi **and** a template).
 */
export function matchesMediaFacets(
  values: MediaFacetValues,
  selection: MediaFacetSelection,
): boolean {
  for (const key of MEDIA_FACET_KEYS) {
    const chosen = selection[key];
    if (!chosen?.length) continue;
    if (!values[key].some((v) => chosen.includes(v))) return false;
  }
  return true;
}

export interface MediaFacetOption {
  value: string;
  label: string;
  count: number;
}

/**
 * Build the options for every facet.
 *
 * Each facet's counts are computed against the list filtered by all the OTHER
 * facets — so narrowing to Audi drops Honda's asset types out of the Asset type
 * picker, while the Brand picker still lists every brand, letting you switch
 * brands instead of dead-ending.
 */
export function buildMediaFacetOptions(
  assets: { facets: MediaFacetValues }[],
  selection: MediaFacetSelection,
): Record<MediaFacetKey, MediaFacetOption[]> {
  const out = {} as Record<MediaFacetKey, MediaFacetOption[]>;

  for (const key of MEDIA_FACET_KEYS) {
    const others: MediaFacetSelection = { ...selection };
    delete others[key];
    const pool = assets.filter((a) => matchesMediaFacets(a.facets, others));

    const counts = new Map<string, number>();
    for (const asset of pool) {
      for (const v of asset.facets[key]) {
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
    }

    // Anything already selected stays listed even at zero — otherwise the
    // checkbox you ticked disappears and the filter can't be undone.
    for (const v of selection[key] ?? []) {
      if (!counts.has(v)) counts.set(v, 0);
    }

    out[key] = [...counts.entries()]
      .map(([value, count]) => ({ value, label: mediaFacetValueLabel(key, value), count }))
      .sort((a, b) => {
        // Unclassified always sorts last: it is a bucket, not a peer of the
        // real values, and it is often the largest one on a fresh library.
        if (a.value === UNSET) return 1;
        if (b.value === UNSET) return -1;
        // Years read newest-first; everything else alphabetically.
        if (key === 'modelYear') return b.value.localeCompare(a.value);
        return a.label.localeCompare(b.label);
      });
  }

  return out;
}

/** How many individual values are selected across every facet. */
export function countMediaFacetsSelected(selection: MediaFacetSelection): number {
  return MEDIA_FACET_KEYS.reduce((n, k) => n + (selection[k]?.length ?? 0), 0);
}
