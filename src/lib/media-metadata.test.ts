import { describe, it, expect } from 'vitest';
import {
  coerceList,
  isAssetCategory,
  isAssetSource,
  parseListColumn,
  serializeListColumn,
  serializeModelYears,
} from './media-metadata';

describe('coerceList', () => {
  it('accepts a real array', () => {
    expect(coerceList(['a', ' b '])).toEqual(['a', 'b']);
  });

  it('accepts a JSON-encoded array (the FormData path)', () => {
    expect(coerceList('["2025","2026"]')).toEqual(['2025', '2026']);
  });

  it('accepts a comma-separated string', () => {
    expect(coerceList('lease, q3 , launch')).toEqual(['lease', 'q3', 'launch']);
  });

  it('falls back to comma-splitting when JSON is malformed', () => {
    // A value that merely starts with '[' must not be swallowed.
    expect(coerceList('[draft, wip')).toEqual(['[draft', 'wip']);
  });

  it('treats blank and non-string input as empty', () => {
    expect(coerceList('   ')).toEqual([]);
    expect(coerceList(null)).toEqual([]);
    expect(coerceList(42)).toEqual([]);
  });

  it('unwraps the JSON-encoded Account.oems column', () => {
    // Regression: passing this column through raw produced the literal token
    // `["Honda"]` as if it were a marque, so a multi-brand dealer with `oems`
    // set and `oem` empty matched no OEM assets at all.
    expect(coerceList('["Honda"]')).toEqual(['Honda']);
    expect(coerceList('["Audi","Volkswagen"]')).toEqual(['Audi', 'Volkswagen']);
  });
});

describe('serializeListColumn', () => {
  it('dedupes and stores as JSON', () => {
    expect(serializeListColumn(['a', 'b', 'a'])).toBe('["a","b"]');
  });

  it('stores empty as null so "unset" stays distinguishable', () => {
    expect(serializeListColumn([])).toBeNull();
    expect(serializeListColumn(['  '])).toBeNull();
  });

  it('round-trips through parseListColumn', () => {
    const stored = serializeListColumn(['lease', 'q3']);
    expect(parseListColumn(stored)).toEqual(['lease', 'q3']);
  });
});

describe('parseListColumn', () => {
  it('degrades to empty rather than throwing on junk', () => {
    expect(parseListColumn('not json')).toEqual([]);
    expect(parseListColumn('{"a":1}')).toEqual([]);
    expect(parseListColumn(null)).toEqual([]);
  });
});

describe('serializeModelYears', () => {
  it('keeps both years of a multi-year package', () => {
    // The Audi "MY25_MY26" case: collapsing this to one year loses the fact
    // that the asset is valid for both.
    expect(serializeModelYears(['2026', '2025'])).toBe('["2025","2026"]');
  });

  it('drops anything that is not a 4-digit year', () => {
    expect(serializeModelYears(['2025', 'MY25', '25', ''])).toBe('["2025"]');
  });

  it('returns null when nothing survives', () => {
    expect(serializeModelYears(['MY25'])).toBeNull();
    expect(serializeModelYears([])).toBeNull();
  });
});

describe('vocabulary guards', () => {
  it('accepts known values', () => {
    expect(isAssetCategory('template')).toBe(true);
    expect(isAssetSource('oem-supplied')).toBe(true);
  });

  it('rejects unknown and mis-cased values rather than silently dropping them', () => {
    expect(isAssetCategory('Template')).toBe(false);
    expect(isAssetCategory('banner')).toBe(false);
    expect(isAssetSource('oem supplied')).toBe(false);
    expect(isAssetSource(null)).toBe(false);
  });
});
