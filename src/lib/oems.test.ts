import { describe, it, expect } from 'vitest';
import {
  normalizeOems,
  getAccountOems,
  expandBrandGroup,
  brandsForIndustry,
  industryHasBrands,
  POWERSPORTS_BRANDS,
  MAJOR_US_OEMS,
} from './oems';

describe('normalizeOems', () => {
  it('canonicalizes casing against the known brand list', () => {
    expect(normalizeOems(['kia', 'SUBARU', 'cfmoto'])).toEqual(['Kia', 'Subaru', 'CFMoto']);
  });

  // The failure this prevents is silent: an account stored as "VW" matched no
  // co-op pack, no disclaimer template and no OEM rule, and looked identical to a
  // brand that genuinely has none on file.
  it('resolves trade shorthand to the canonical name', () => {
    expect(normalizeOems('VW')).toEqual(['Volkswagen']);
    expect(normalizeOems('Chevy')).toEqual(['Chevrolet']);
    expect(normalizeOems('Mercedes')).toEqual(['Mercedes-Benz']);
    expect(normalizeOems('harley davidson')).toEqual(['Harley-Davidson']);
    expect(normalizeOems('Can Am')).toEqual(['Can-Am']);
  });

  it('resolves a common misspelling seen in imported account data', () => {
    expect(normalizeOems('Volkswagon')).toEqual(['Volkswagen']);
  });

  it('de-duplicates once shorthand and canonical resolve to the same brand', () => {
    expect(normalizeOems(['VW', 'Volkswagen', 'vw'])).toEqual(['Volkswagen']);
  });

  it('splits comma-separated values', () => {
    expect(normalizeOems('Kia, VW,Subaru')).toEqual(['Kia', 'Volkswagen', 'Subaru']);
  });

  // Dropping an unknown brand would lose real account data; carrying it
  // uncanonicalized at least keeps it visible.
  it('passes an unrecognized brand through unchanged', () => {
    expect(normalizeOems('Koenigsegg')).toEqual(['Koenigsegg']);
  });

  it('ignores empty tokens', () => {
    expect(normalizeOems(['', '  ', 'Kia'])).toEqual(['Kia']);
  });

  // A group acronym is NOT a brand. Resolving it to one make would silently pick
  // Chrysler for a Jeep in every caller that takes the first result.
  it('does not resolve a dealer-group acronym to a single make', () => {
    expect(normalizeOems('CDJRF')).toEqual(['CDJRF']);
    expect(normalizeOems('BRP')).toEqual(['BRP']);
  });
});

describe('expandBrandGroup', () => {
  it('expands the dealer-group acronyms', () => {
    expect(expandBrandGroup('CDJR')).toEqual(['Chrysler', 'Dodge', 'Jeep', 'Ram']);
    expect(expandBrandGroup('cdjrf')).toEqual(['Chrysler', 'Dodge', 'Jeep', 'Ram', 'Fiat']);
    expect(expandBrandGroup('BRP')).toEqual(['Can-Am', 'Ski-Doo', 'Sea-Doo']);
  });

  it('returns null for anything that is not a group', () => {
    expect(expandBrandGroup('Volkswagen')).toBeNull();
    expect(expandBrandGroup('VW')).toBeNull();
  });

  it('expands only to brands that actually exist in the canonical lists', () => {
    const known = new Set<string>([...MAJOR_US_OEMS, ...POWERSPORTS_BRANDS]);
    for (const group of ['CDJR', 'CDJRF', 'BRP']) {
      for (const brand of expandBrandGroup(group)!) expect(known).toContain(brand);
    }
  });
});

describe('brand lists', () => {
  // Filed under powersports because Loomi has no agriculture industry — see the
  // comment on POWERSPORTS_BRANDS.
  it('includes the agricultural brands under powersports', () => {
    expect(POWERSPORTS_BRANDS).toContain('LS Tractor');
    expect(POWERSPORTS_BRANDS).toContain('New Holland');
  });

  it('offers the powersports list to powersports accounts and the OEM list otherwise', () => {
    expect(brandsForIndustry('powersports')).toBe(POWERSPORTS_BRANDS);
    expect(brandsForIndustry('automotive')).toBe(MAJOR_US_OEMS);
  });

  it('only claims brand selection for the two vehicle industries', () => {
    expect(industryHasBrands('Automotive')).toBe(true);
    expect(industryHasBrands('powersports')).toBe(true);
    expect(industryHasBrands('healthcare')).toBe(false);
  });
});

describe('getAccountOems', () => {
  it('reads and canonicalizes from either field', () => {
    expect(getAccountOems({ oems: ['vw'] })).toEqual(['Volkswagen']);
    expect(getAccountOems({ oem: 'chevy' })).toEqual(['Chevrolet']);
  });

  it('returns an empty list for a missing account', () => {
    expect(getAccountOems(null)).toEqual([]);
  });
});
