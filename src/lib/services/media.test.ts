import { describe, it, expect } from 'vitest';
import { buildAssetMetadata, effectiveMediaWhere } from './media';

// Pure functions only — the query helpers around them are exercised against a
// real database under RUN_DB_TESTS.

describe('effectiveMediaWhere', () => {
  it('always includes global assets and the account\'s own', () => {
    const where = effectiveMediaWhere({
      accountKey: 'youngHonda',
      ancestorKeys: [],
      brands: [],
    });

    expect(where.OR).toEqual([
      { accountKey: { equals: null }, oem: { equals: null } },
      { accountKey: 'youngHonda' },
    ]);
  });

  it('adds an OEM branch scoped to the brands the account carries', () => {
    const where = effectiveMediaWhere({
      accountKey: 'youngAudi',
      ancestorKeys: [],
      brands: ['Audi'],
    });

    expect(where.OR).toContainEqual({
      accountKey: { equals: null },
      oem: { in: ['Audi'] },
    });
  });

  it('never lets a brand-agnostic asset answer to a brand filter', () => {
    // The global branch must pin oem to null. If it didn't, every Loomi-library
    // asset would surface as though it belonged to whatever brand was queried.
    const where = effectiveMediaWhere({
      accountKey: 'youngAudi',
      ancestorKeys: [],
      brands: ['Audi'],
    });

    const globalBranch = where.OR[0] as Record<string, unknown>;
    expect(globalBranch.oem).toEqual({ equals: null });
  });

  it('inherits from ancestors — the group account a rooftop hangs beneath', () => {
    const where = effectiveMediaWhere({
      accountKey: 'youngFordOgden',
      ancestorKeys: ['youngAutomotiveGroup'],
      brands: ['Ford'],
    });

    expect(where.OR).toContainEqual({ accountKey: { in: ['youngAutomotiveGroup'] } });
  });

  it('omits the brand and ancestor branches entirely when there are none', () => {
    // An empty `in: []` matches nothing but still costs a clause; more
    // importantly, its presence would make the no-brand case look like a bug.
    const where = effectiveMediaWhere({
      accountKey: 'ozInternal',
      ancestorKeys: [],
      brands: [],
    });

    expect(where.OR).toHaveLength(2);
  });
});

describe('buildAssetMetadata', () => {
  it('only returns keys that were actually supplied', () => {
    const result = buildAssetMetadata({ assetCategory: 'template' });
    expect(result).toEqual({ data: { assetCategory: 'template' } });
  });

  it('canonicalizes OEM casing', () => {
    const result = buildAssetMetadata({ oem: 'audi' });
    expect(result).toEqual({ data: { oem: 'Audi' } });
  });

  it('passes through a brand Loomi has not listed rather than blocking', () => {
    const result = buildAssetMetadata({ oem: 'Koenigsegg' });
    expect(result).toEqual({ data: { oem: 'Koenigsegg' } });
  });

  it('treats empty string as an explicit clear', () => {
    expect(buildAssetMetadata({ oem: '' })).toEqual({ data: { oem: null } });
    expect(buildAssetMetadata({ rightsHolder: '' })).toEqual({ data: { rightsHolder: null } });
    expect(buildAssetMetadata({ assetCategory: null })).toEqual({ data: { assetCategory: null } });
  });

  it('rejects an unknown vocabulary value instead of dropping it', () => {
    // Silently discarding a mistyped category is how a taxonomy fills with holes.
    expect(buildAssetMetadata({ assetCategory: 'banner' })).toEqual({
      error: 'Unknown asset category: banner',
    });
    expect(buildAssetMetadata({ assetSource: 'oem' })).toEqual({
      error: 'Unknown asset source: oem',
    });
  });

  it('stores multi-year packages as a sorted list', () => {
    expect(buildAssetMetadata({ modelYear: '2026,2025' })).toEqual({
      data: { modelYear: '["2025","2026"]' },
    });
  });

  it('accepts tags from either the form or the JSON path', () => {
    expect(buildAssetMetadata({ tags: 'lease, q3' })).toEqual({
      data: { tags: '["lease","q3"]' },
    });
    expect(buildAssetMetadata({ tags: ['lease', 'q3'] })).toEqual({
      data: { tags: '["lease","q3"]' },
    });
  });
});

describe('buildAssetMetadata — rights', () => {
  it('accepts a known licence type and rejects an unknown one', () => {
    expect(buildAssetMetadata({ licenseType: 'oem-licensed' })).toEqual({
      data: { licenseType: 'oem-licensed' },
    });
    expect(buildAssetMetadata({ licenseType: 'perpetual' })).toEqual({
      error: 'Unknown licence type: perpetual',
    });
  });

  it('validates usage scope against the vocabulary', () => {
    expect(buildAssetMetadata({ usageScope: 'digital,print' })).toEqual({
      data: { usageScope: '["digital","print"]' },
    });
    expect(buildAssetMetadata({ usageScope: 'billboards' })).toEqual({
      error: 'Unknown usage scope: billboards',
    });
  });

  it('leaves territory free-form — DAT assignments do not fit a fixed list', () => {
    expect(buildAssetMetadata({ territoryScope: 'Utah, Idaho' })).toEqual({
      data: { territoryScope: '["Utah","Idaho"]' },
    });
  });

  it('treats the permission flags as tri-state', () => {
    expect(buildAssetMetadata({ derivativesPermitted: false })).toEqual({
      data: { derivativesPermitted: false },
    });
    // null is "not recorded", which is not the same as "not permitted".
    expect(buildAssetMetadata({ derivativesPermitted: null })).toEqual({
      data: { derivativesPermitted: null },
    });
    expect(buildAssetMetadata({ derivativesPermitted: 'maybe' })).toEqual({
      error: 'derivativesPermitted must be true, false or null',
    });
  });

  it('rejects an unparseable date', () => {
    expect(buildAssetMetadata({ licenseExpiresAt: 'whenever' })).toEqual({
      error: 'licenseExpiresAt must be a valid date or null',
    });
  });

  it('re-arms expiry when a governing date moves', () => {
    // The renewal case: extending a licence must clear the sweep's verdict, or
    // a relicensed asset stays flagged expired forever.
    const result = buildAssetMetadata({ licenseExpiresAt: '2027-01-01T00:00:00.000Z' });
    expect(result).toEqual({
      data: {
        licenseExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
        expiredAt: null,
        expirationReason: null,
        expirationWarnedAt: null,
      },
    });
  });

  it('does not re-arm when only the licence START moves', () => {
    // The start date can't expire anything, so touching it must not resurrect
    // an asset the sweep correctly retired.
    const result = buildAssetMetadata({ licenseStartsAt: '2026-01-01T00:00:00.000Z' });
    expect(result).toEqual({
      data: { licenseStartsAt: new Date('2026-01-01T00:00:00.000Z') },
    });
  });
});
