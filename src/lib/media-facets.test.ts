import { describe, it, expect } from 'vitest';
import {
  UNSET,
  buildMediaFacetOptions,
  countMediaFacetsSelected,
  facetsForAsset,
  matchesMediaFacets,
  mediaFacetValueLabel,
} from './media-facets';

const audiTemplate = {
  oem: 'Audi',
  assetCategory: 'template',
  assetSource: 'oem-supplied',
  modelYear: ['2025', '2026'],
};

const hondaPhoto = {
  oem: 'Honda',
  assetCategory: 'photography',
  assetSource: 'oem-supplied',
  modelYear: ['2026'],
};

const untagged = { oem: null, assetCategory: null, assetSource: null, modelYear: [] };

describe('facetsForAsset', () => {
  it('reads the classification columns', () => {
    expect(facetsForAsset(audiTemplate)).toEqual({
      oem: ['Audi'],
      assetCategory: ['template'],
      assetSource: ['oem-supplied'],
      modelYear: ['2025', '2026'],
      rightsStatus: ['unknown'],
    });
  });

  it('files an unclassified asset under UNSET rather than guessing', () => {
    expect(facetsForAsset(untagged)).toEqual({
      oem: [UNSET],
      assetCategory: [UNSET],
      assetSource: [UNSET],
      modelYear: [UNSET],
      // Rights is never UNSET — 'unknown' is its own real value.
      rightsStatus: ['unknown'],
    });
  });

  it('keeps a multi-year package under every year it covers', () => {
    // The Audi MY25/MY26 case — it must appear under both filters.
    const f = facetsForAsset(audiTemplate);
    expect(f.modelYear).toContain('2025');
    expect(f.modelYear).toContain('2026');
  });
});

describe('matchesMediaFacets', () => {
  it('ORs within a facet', () => {
    const f = facetsForAsset(audiTemplate);
    expect(matchesMediaFacets(f, { oem: ['Audi', 'Honda'] })).toBe(true);
    expect(matchesMediaFacets(f, { oem: ['Honda'] })).toBe(false);
  });

  it('ANDs across facets', () => {
    const f = facetsForAsset(audiTemplate);
    expect(matchesMediaFacets(f, { oem: ['Audi'], assetCategory: ['template'] })).toBe(true);
    expect(matchesMediaFacets(f, { oem: ['Audi'], assetCategory: ['display'] })).toBe(false);
  });

  it('matches on a single year of a multi-year package', () => {
    expect(matchesMediaFacets(facetsForAsset(audiTemplate), { modelYear: ['2026'] })).toBe(true);
  });

  it('treats an empty selection as unfiltered', () => {
    expect(matchesMediaFacets(facetsForAsset(untagged), {})).toBe(true);
    expect(matchesMediaFacets(facetsForAsset(untagged), { oem: [] })).toBe(true);
  });

  it('can select the unclassified bucket', () => {
    expect(matchesMediaFacets(facetsForAsset(untagged), { oem: [UNSET] })).toBe(true);
    expect(matchesMediaFacets(facetsForAsset(audiTemplate), { oem: [UNSET] })).toBe(false);
  });
});

describe('buildMediaFacetOptions', () => {
  const assets = [audiTemplate, hondaPhoto, untagged].map((a) => ({ facets: facetsForAsset(a) }));

  it('counts each value across the whole set when nothing is selected', () => {
    const opts = buildMediaFacetOptions(assets, {});
    expect(opts.oem).toEqual([
      { value: 'Audi', label: 'Audi', count: 1 },
      { value: 'Honda', label: 'Honda', count: 1 },
      { value: UNSET, label: 'Unclassified', count: 1 },
    ]);
  });

  it('counts a facet against the OTHER facets, not its own', () => {
    // Narrowing to Audi must not collapse the Brand picker to just Audi —
    // otherwise you can never switch brands without clearing the filter first.
    const opts = buildMediaFacetOptions(assets, { oem: ['Audi'] });
    expect(opts.oem.map((o) => o.value)).toEqual(['Audi', 'Honda', UNSET]);
    // Asset type, however, IS narrowed by the Audi selection.
    expect(opts.assetCategory.map((o) => o.value)).toEqual(['template']);
  });

  it('keeps a selected value listed even when it counts zero', () => {
    const opts = buildMediaFacetOptions(assets, {
      oem: ['Audi'],
      assetCategory: ['photography'],
    });
    const photography = opts.assetCategory.find((o) => o.value === 'photography');
    expect(photography).toEqual({ value: 'photography', label: 'Photography', count: 0 });
  });

  it('sorts Unclassified last and years newest-first', () => {
    const opts = buildMediaFacetOptions(assets, {});
    expect(opts.assetSource.at(-1)?.value).toBe(UNSET);
    expect(opts.modelYear.map((o) => o.value)).toEqual(['2026', '2025', UNSET]);
  });
});

describe('mediaFacetValueLabel', () => {
  it('humanizes vocabulary values and leaves brands alone', () => {
    expect(mediaFacetValueLabel('assetCategory', 'template')).toBe('Template');
    expect(mediaFacetValueLabel('assetSource', 'oem-supplied')).toBe('OEM-supplied');
    expect(mediaFacetValueLabel('oem', 'Audi')).toBe('Audi');
    expect(mediaFacetValueLabel('oem', UNSET)).toBe('Unclassified');
  });
});

describe('countMediaFacetsSelected', () => {
  it('totals across facets', () => {
    expect(countMediaFacetsSelected({ oem: ['Audi', 'Honda'], assetCategory: ['template'] })).toBe(3);
    expect(countMediaFacetsSelected({})).toBe(0);
  });
});

describe('rightsStatus facet', () => {
  it('reads the server-derived status', () => {
    expect(facetsForAsset({ rights: { status: 'expiring_soon' } }).rightsStatus).toEqual([
      'expiring_soon',
    ]);
  });

  it('defaults to unknown rather than Unclassified', () => {
    // Every asset has a rights position, even if that position is "we don't
    // know" — so this facet has no empty bucket.
    expect(facetsForAsset({}).rightsStatus).toEqual(['unknown']);
  });

  it('labels the status for the rail', () => {
    expect(mediaFacetValueLabel('rightsStatus', 'lapsed')).toBe('Lapsed');
    expect(mediaFacetValueLabel('rightsStatus', 'unknown')).toBe('No licence recorded');
  });

  it('filters on it', () => {
    const expiring = facetsForAsset({ rights: { status: 'expiring_soon' } });
    const active = facetsForAsset({ rights: { status: 'active' } });
    expect(matchesMediaFacets(expiring, { rightsStatus: ['expiring_soon'] })).toBe(true);
    expect(matchesMediaFacets(active, { rightsStatus: ['expiring_soon'] })).toBe(false);
  });
});
