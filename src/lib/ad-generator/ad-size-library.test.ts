import { describe, it, expect } from 'vitest';
import {
  AD_SIZE_STARTERS,
  UNTAGGED,
  aspectLabel,
  filterSizes,
  normalizeTags,
  parseTags,
  tagFacets,
  type AdSize,
} from './ad-size-library';

describe('AD_SIZE_STARTERS', () => {
  it('has unique keys, unique names, positive dimensions and at least one tag', () => {
    const keys = new Set(AD_SIZE_STARTERS.map((s) => s.key));
    const names = new Set(AD_SIZE_STARTERS.map((s) => s.name));
    expect(keys.size).toBe(AD_SIZE_STARTERS.length);
    expect(names.size).toBe(AD_SIZE_STARTERS.length);
    for (const s of AD_SIZE_STARTERS) {
      expect(s.width).toBeGreaterThan(0);
      expect(s.height).toBeGreaterThan(0);
      // A starter with no tags would land in the Untagged bucket, which is
      // meant to flag sizes someone still has to classify.
      expect(s.tags.length).toBeGreaterThan(0);
    }
  });
});

describe('parseTags', () => {
  it('reads a JSON string[] column, tolerating null and junk', () => {
    expect(parseTags(null)).toEqual([]);
    expect(parseTags('')).toEqual([]);
    expect(parseTags('not json')).toEqual([]);
    expect(parseTags('{"a":1}')).toEqual([]);
    expect(parseTags('["Email","Display"]')).toEqual(['Display', 'Email']);
    expect(parseTags('["Email",3,null]')).toEqual(['Email']);
  });
});

describe('normalizeTags', () => {
  it('trims, drops blanks, de-dupes case-insensitively and sorts', () => {
    expect(normalizeTags([' Email ', 'email', '', '  ', 'Display'])).toEqual(['Display', 'Email']);
  });

  it('ignores non-arrays and non-strings', () => {
    expect(normalizeTags('Email')).toEqual([]);
    expect(normalizeTags([1, {}, 'Email'])).toEqual(['Email']);
  });
});

const sizes: AdSize[] = [
  { name: 'Instagram Square', width: 1080, height: 1080, tags: ['Instagram', 'Social'] },
  { name: 'Leaderboard', width: 728, height: 90, tags: ['Google', 'Display'] },
  { name: 'Dealer Banner', width: 1400, height: 400, tags: [] },
];

describe('tagFacets', () => {
  it('counts each tag and pins Untagged last', () => {
    expect(tagFacets(sizes)).toEqual([
      { tag: 'Display', count: 1 },
      { tag: 'Google', count: 1 },
      { tag: 'Instagram', count: 1 },
      { tag: 'Social', count: 1 },
      { tag: UNTAGGED, count: 1 },
    ]);
  });

  it('omits Untagged when every size is tagged', () => {
    expect(tagFacets(sizes.slice(0, 2)).some((f) => f.tag === UNTAGGED)).toBe(false);
  });
});

describe('filterSizes', () => {
  it('returns everything when nothing is selected', () => {
    expect(filterSizes(sizes, [])).toHaveLength(3);
  });

  it('ORs the selected tags rather than requiring all of them', () => {
    const out = filterSizes(sizes, ['Instagram', 'Display']).map((s) => s.name);
    expect(out).toEqual(['Instagram Square', 'Leaderboard']);
  });

  it('matches untagged sizes through the Untagged bucket', () => {
    expect(filterSizes(sizes, [UNTAGGED]).map((s) => s.name)).toEqual(['Dealer Banner']);
  });

  it('searches name, tags and dimensions (either × or x)', () => {
    expect(filterSizes(sizes, [], 'square').map((s) => s.name)).toEqual(['Instagram Square']);
    expect(filterSizes(sizes, [], 'display').map((s) => s.name)).toEqual(['Leaderboard']);
    expect(filterSizes(sizes, [], '728×90').map((s) => s.name)).toEqual(['Leaderboard']);
    expect(filterSizes(sizes, [], '1080x1080').map((s) => s.name)).toEqual(['Instagram Square']);
  });

  it('applies tag filter and query together', () => {
    expect(filterSizes(sizes, ['Display'], 'square')).toEqual([]);
  });
});

describe('aspectLabel', () => {
  it('reduces tidy ratios and falls back to decimal-to-1', () => {
    expect(aspectLabel(1080, 1080)).toBe('1:1');
    expect(aspectLabel(1080, 1920)).toBe('9:16');
    expect(aspectLabel(1280, 720)).toBe('16:9');
    expect(aspectLabel(300, 250)).toBe('6:5');
    expect(aspectLabel(160, 600)).toBe('4:15');
    expect(aspectLabel(1200, 628)).toBe('1.91:1'); // reduces to 300:157 → too big → decimal-to-1
    expect(aspectLabel(728, 90)).toBe('8.09:1'); // reduces to 364:45 → too big → decimal-to-1
  });
});
