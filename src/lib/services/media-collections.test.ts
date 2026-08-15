import { describe, it, expect } from 'vitest';
import {
  derivedFacetKeys,
  parseCollectionQuery,
  smartCollectionWhere,
  type MediaCollectionQuery,
} from './media-collections';

/**
 * A smart collection is a stored query, so what it CONTAINS is decided here.
 * Getting the where-clause wrong doesn't error — it quietly returns the wrong
 * assets, which is the failure mode worth testing against.
 */

/** Flatten the AND array so assertions can look for a clause by shape. */
const clauses = (q: MediaCollectionQuery) => smartCollectionWhere(q).AND as Record<string, unknown>[];
const has = (q: MediaCollectionQuery, pred: (c: Record<string, unknown>) => boolean) =>
  clauses(q).some(pred);

describe('smartCollectionWhere', () => {
  it('always excludes archived assets', () => {
    expect(has({}, (c) => 'archivedAt' in c)).toBe(true);
  });

  it('distinguishes "any account" from "agency-level only"', () => {
    // Omitting the key means don't constrain; null means specifically unowned.
    expect(has({}, (c) => 'accountKey' in c)).toBe(false);
    expect(has({ accountKey: null }, (c) => JSON.stringify(c.accountKey) === '{"equals":null}')).toBe(true);
    expect(has({ accountKey: 'youngHondaOgden' }, (c) => c.accountKey === 'youngHondaOgden')).toBe(true);
  });

  it('treats oem "none" as brand-agnostic, not as a brand named none', () => {
    expect(has({ oem: 'none' }, (c) => JSON.stringify(c.oem) === '{"equals":null}')).toBe(true);
    expect(has({ oem: 'Audi' }, (c) => c.oem === 'Audi')).toBe(true);
  });

  it('pushes column-backed facets into the query', () => {
    const q: MediaCollectionQuery = {
      facets: { assetCategory: ['display'], status: ['approved'], assetSource: ['oem-supplied'] },
    };
    expect(has(q, (c) => JSON.stringify(c.assetCategory) === '{"in":["display"]}')).toBe(true);
    expect(has(q, (c) => JSON.stringify(c.status) === '{"in":["approved"]}')).toBe(true);
    expect(has(q, (c) => JSON.stringify(c.assetSource) === '{"in":["oem-supplied"]}')).toBe(true);
  });

  it('ignores empty facet arrays', () => {
    expect(has({ facets: { assetCategory: [] } }, (c) => 'assetCategory' in c)).toBe(false);
  });

  it('adds a search clause only when there is text', () => {
    expect(clauses({ search: '   ' })).toHaveLength(1); // archived only
    expect(clauses({ search: 'civic' }).length).toBeGreaterThan(1);
  });

  it('composes scope, brand, facets and search together', () => {
    const q: MediaCollectionQuery = {
      accountKey: null,
      oem: 'Audi',
      facets: { assetCategory: ['display'], status: ['approved'] },
      search: 'q7',
    };
    // archived + search + accountKey + oem + 2 facets
    expect(clauses(q)).toHaveLength(6);
  });
});

describe('derivedFacetKeys', () => {
  it('names the facets that cannot be a where clause', () => {
    // modelYear is a JSON array column; rightsStatus is computed from dates.
    // They're filtered in memory, and saying so is what keeps results honest.
    expect(derivedFacetKeys({ facets: { modelYear: ['2026'] } })).toEqual(['modelYear']);
    expect(derivedFacetKeys({ facets: { rightsStatus: ['expiring_soon'] } })).toEqual(['rightsStatus']);
  });

  it('excludes the column-backed ones and empty selections', () => {
    expect(derivedFacetKeys({ facets: { assetCategory: ['display'] } })).toEqual([]);
    expect(derivedFacetKeys({ facets: { modelYear: [] } })).toEqual([]);
    expect(derivedFacetKeys({})).toEqual([]);
  });
});

describe('parseCollectionQuery', () => {
  it('round-trips a stored query', () => {
    const q: MediaCollectionQuery = { oem: 'Audi', facets: { status: ['approved'] } };
    expect(parseCollectionQuery(JSON.stringify(q))).toEqual(q);
  });

  it('degrades to null rather than throwing', () => {
    expect(parseCollectionQuery('not json')).toBeNull();
    expect(parseCollectionQuery(null)).toBeNull();
    expect(parseCollectionQuery('')).toBeNull();
  });
});
