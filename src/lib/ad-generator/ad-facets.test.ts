import { describe, it, expect } from 'vitest';
import { facetsForAd, matchesFacets, buildFacetOptions, countSelected, offerEndsAt, matchesWindow } from './ad-facets';
import type { AdData } from './types';

const equinox: AdData = {
  offerType: 'lease',
  _vehYear: '2026',
  _vehMake: 'Chevrolet',
  _vehModel: 'Equinox',
  _vehTrim: 'LT',
  vehicleName: '2026 Chevrolet Equinox LT',
};

describe('facetsForAd', () => {
  it('reads the structured vehicle stash', () => {
    expect(facetsForAd(equinox)).toEqual({
      make: ['Chevrolet'],
      model: ['Equinox'],
      trim: ['LT'],
      year: ['2026'],
      offerType: ['lease'],
    });
  });

  it('collects both vehicles from a dual-offer ad', () => {
    const f = facetsForAd({
      ...equinox,
      o2_offerType: 'apr',
      o2__vehMake: 'GMC',
      o2__vehModel: 'Sierra 1500',
      o2__vehYear: '2025',
    });
    expect(f.make).toEqual(['Chevrolet', 'GMC']);
    expect(f.model).toEqual(['Equinox', 'Sierra 1500']);
    expect(f.offerType).toEqual(['lease', 'apr']);
  });

  it('falls back to the display name for make and year only', () => {
    // A hand-typed ad with no stash: make/year are recoverable, model and trim
    // are not guessable from "Silverado 1500 LT" and must stay empty.
    const f = facetsForAd({ offerType: 'discount', vehicleName: '2025 Chevrolet Silverado 1500 LT' });
    expect(f.make).toEqual(['Chevrolet']);
    expect(f.year).toEqual(['2025']);
    expect(f.model).toEqual([]);
    expect(f.trim).toEqual([]);
  });

  it('prefers the longest brand match', () => {
    expect(facetsForAd({ vehicleName: '2026 Land Rover Defender' }).make).toEqual(['Land Rover']);
    expect(facetsForAd({ vehicleName: '2026 Alfa Romeo Tonale' }).make).toEqual(['Alfa Romeo']);
  });

  it('de-duplicates a repeated vehicle without changing its spelling', () => {
    const f = facetsForAd({ _vehMake: 'Chevrolet', o2__vehMake: 'chevrolet' });
    expect(f.make).toEqual(['Chevrolet']);
  });

  it('returns empty facets for an ad that names no vehicle', () => {
    expect(facetsForAd({ headline: 'Presidents Day Sale' })).toEqual({
      make: [], model: [], trim: [], year: [], offerType: [],
    });
  });
});

describe('matchesFacets', () => {
  const f = facetsForAd(equinox);

  it('passes everything when nothing is selected', () => {
    expect(matchesFacets(f, {})).toBe(true);
    expect(matchesFacets(f, { make: [] })).toBe(true);
  });

  it('ORs within a facet and ANDs across facets', () => {
    expect(matchesFacets(f, { make: ['GMC', 'Chevrolet'] })).toBe(true);
    expect(matchesFacets(f, { make: ['Chevrolet'], offerType: ['lease'] })).toBe(true);
    expect(matchesFacets(f, { make: ['Chevrolet'], offerType: ['apr'] })).toBe(false);
  });

  it('excludes an ad that has no value for a filtered facet', () => {
    const bare = facetsForAd({ headline: 'Sale' });
    expect(matchesFacets(bare, { make: ['Chevrolet'] })).toBe(false);
  });
});

describe('buildFacetOptions', () => {
  const ads = [
    { facets: facetsForAd(equinox) },
    { facets: facetsForAd({ offerType: 'apr', _vehMake: 'Chevrolet', _vehModel: 'Traverse', _vehYear: '2026' }) },
    { facets: facetsForAd({ offerType: 'lease', _vehMake: 'Mazda', _vehModel: 'CX-5', _vehYear: '2025' }) },
  ];

  it('counts each value', () => {
    const opts = buildFacetOptions(ads, {});
    expect(opts.make).toEqual([
      { value: 'Chevrolet', label: 'Chevrolet', count: 2 },
      { value: 'Mazda', label: 'Mazda', count: 1 },
    ]);
  });

  it('narrows other facets to the current selection but leaves its own facet whole', () => {
    const opts = buildFacetOptions(ads, { make: ['Chevrolet'] });
    // Model is narrowed by the make…
    expect(opts.model.map((o) => o.value)).toEqual(['Equinox', 'Traverse']);
    // …but Make still lists Mazda, so you can switch instead of dead-ending.
    expect(opts.make.map((o) => o.value)).toEqual(['Chevrolet', 'Mazda']);
  });

  it('keeps a selected value listed even when it drops to zero', () => {
    const opts = buildFacetOptions(ads, { make: ['Mazda'], model: ['Equinox'] });
    const equinoxOpt = opts.model.find((o) => o.value === 'Equinox');
    expect(equinoxOpt).toEqual({ value: 'Equinox', label: 'Equinox', count: 0 });
  });

  it('labels offer types for humans and sorts years newest first', () => {
    const opts = buildFacetOptions(ads, {});
    expect(opts.offerType.map((o) => o.label)).toContain('APR Financing');
    expect(opts.year.map((o) => o.value)).toEqual(['2026', '2025']);
  });
});

describe('countSelected', () => {
  it('totals values across facets', () => {
    expect(countSelected({})).toBe(0);
    expect(countSelected({ make: ['Chevrolet', 'GMC'], offerType: ['lease'] })).toBe(3);
  });
});

describe('offerEndsAt', () => {
  it('reads the automation stamp', () => {
    const end = offerEndsAt({}, '2026-08-03T00:00:00.000Z');
    expect(end?.toISOString()).toBe('2026-08-03T00:00:00.000Z');
  });

  it('treats a plain date field as valid through end of that local day', () => {
    const end = offerEndsAt({ expiration: '2026-08-03' })!;
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(7);
    expect(end.getDate()).toBe(3);
    expect(end.getHours()).toBe(23);
  });

  it('takes whichever deadline comes first', () => {
    const end = offerEndsAt({ expiration: '2026-08-31' }, '2026-08-03T00:00:00.000Z');
    expect(end?.toISOString()).toBe('2026-08-03T00:00:00.000Z');
  });

  it('returns null when the ad names no deadline', () => {
    expect(offerEndsAt({ headline: 'Always open' })).toBeNull();
    expect(offerEndsAt({ expiration: '   ' })).toBeNull();
  });
});

describe('matchesWindow', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');

  it('passes everything on "all"', () => {
    expect(matchesWindow(null, 'all', now)).toBe(true);
    expect(matchesWindow(new Date('2026-01-01'), 'all', now)).toBe(true);
  });

  it('counts a past deadline as expired', () => {
    expect(matchesWindow(new Date('2026-08-03T00:00:00Z'), 'expired', now)).toBe(true);
    expect(matchesWindow(new Date('2026-08-03T00:00:00Z'), 'active', now)).toBe(false);
  });

  it('counts a future deadline as active', () => {
    expect(matchesWindow(new Date('2026-09-30T00:00:00Z'), 'active', now)).toBe(true);
    expect(matchesWindow(new Date('2026-09-30T00:00:00Z'), 'expired', now)).toBe(false);
  });

  it('treats an ad with no deadline as active, never expired', () => {
    expect(matchesWindow(null, 'active', now)).toBe(true);
    expect(matchesWindow(null, 'expired', now)).toBe(false);
  });
});
