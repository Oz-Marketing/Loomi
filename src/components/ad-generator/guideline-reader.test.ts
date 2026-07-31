import { describe, it, expect } from 'vitest';
import { findHits, matchBoxes, pageHighlights, type TextItem } from './guideline-search';

const PAGES = [
  'Section 1: Introduction to the Subaru Advertising Fund Program.',
  'Mention of whether a security deposit is required or not must be stated in the body of the ad.',
  'A SECURITY DEPOSIT may also be referenced here. And again: security deposit.',
  '',
];

describe('findHits', () => {
  it('finds a phrase and reports its 1-based page', () => {
    const hits = findHits(PAGES, 'security deposit');
    expect(hits[0].page).toBe(2);
  });

  it('is case-insensitive', () => {
    // Guideline documents shout their headings, so a case-sensitive search would
    // miss half of what people look for.
    const pages = findHits(PAGES, 'SeCuRiTy DePoSiT').map((h) => h.page);
    expect(pages).toContain(2);
    expect(pages).toContain(3);
  });

  it('returns every occurrence on a page, not just the first', () => {
    expect(findHits(PAGES, 'security deposit').filter((h) => h.page === 3)).toHaveLength(2);
  });

  it('ignores queries under two characters', () => {
    // Otherwise typing the first letter matches most of the document and the
    // results list is useless noise.
    expect(findHits(PAGES, 'a')).toEqual([]);
    expect(findHits(PAGES, ' ')).toEqual([]);
  });

  it('returns nothing when there is no match', () => {
    expect(findHits(PAGES, 'snowmobile')).toEqual([]);
  });

  it('points `at` at the match inside the snippet', () => {
    const [hit] = findHits(PAGES, 'security deposit');
    expect(hit.snippet.slice(hit.at, hit.at + hit.len).toLowerCase()).toBe('security deposit');
  });

  it('marks truncation with an ellipsis and keeps the offset correct', () => {
    const long = ['x'.repeat(400) + 'needle' + 'y'.repeat(400)];
    const [hit] = findHits(long, 'needle');
    expect(hit.snippet.startsWith('…')).toBe(true);
    expect(hit.snippet.endsWith('…')).toBe(true);
    // The leading ellipsis shifts the text by one character; `at` has to account
    // for it or the highlight lands a character to the left.
    expect(hit.snippet.slice(hit.at, hit.at + hit.len)).toBe('needle');
  });

  it('handles a match at the very start of a page', () => {
    const [hit] = findHits(['needle at the start of the page'], 'needle');
    expect(hit.snippet.startsWith('…')).toBe(false);
    expect(hit.snippet.slice(hit.at, hit.at + hit.len)).toBe('needle');
  });

  it('treats punctuation literally rather than as a pattern', () => {
    // People search these for things like "$1,000" and "APR (24 mo.)"; a regex
    // engine would either throw or silently match the wrong thing.
    const pages = ['Offers of $1,000 or more require the disclaimer.'];
    expect(findHits(pages, '$1,000')).toHaveLength(1);
    expect(() => findHits(pages, 'a(b')).not.toThrow();
    expect(findHits(pages, 'a(b')).toEqual([]);
  });

  it('caps the result count so a common word cannot flood the list', () => {
    const many = Array.from({ length: 200 }, () => 'the retailer');
    expect(findHits(many, 'retailer').length).toBeLessThanOrEqual(100);
  });

  it('tolerates empty pages', () => {
    expect(() => findHits(['', '', ''], 'anything')).not.toThrow();
  });
});

describe('matchBoxes', () => {
  // "security deposit" split across three runs, as pdf.js routinely does when the
  // font or position changes mid-phrase.
  const ITEMS: TextItem[] = [
    { s: 0, n: 8, x: 0.1, y: 0.5, w: 0.08, h: 0.02 }, // "Mention "
    { s: 9, n: 8, x: 0.2, y: 0.5, w: 0.08, h: 0.02 }, // "security"
    { s: 18, n: 7, x: 0.3, y: 0.5, w: 0.07, h: 0.02 }, // "deposit"
    { s: 26, n: 2, x: 0.4, y: 0.5, w: 0.02, h: 0.02 }, // "is"
  ];

  it('returns a box for every run the match overlaps', () => {
    // The phrase starts at 9 and runs 16 chars, covering two runs.
    expect(matchBoxes(ITEMS, 9, 16)).toHaveLength(2);
  });

  it('ignores runs that only touch the boundary', () => {
    // A run ending exactly where the match starts is not part of it.
    const boxes = matchBoxes(ITEMS, 9, 8);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].x).toBeCloseTo(0.2);
  });

  it('returns nothing when the match falls in a gap', () => {
    expect(matchBoxes(ITEMS, 8, 1)).toEqual([]);
  });

  it('handles a match inside a single run', () => {
    expect(matchBoxes(ITEMS, 10, 3)).toHaveLength(1);
  });
});

describe('pageHighlights', () => {
  const ITEMS: TextItem[] = [{ s: 0, n: 6, x: 0.1, y: 0.2, w: 0.1, h: 0.02 }];

  it('only draws hits belonging to the page on screen', () => {
    const hits = [
      { page: 1, snippet: 'needle', at: 0, len: 6, index: 0 },
      { page: 2, snippet: 'needle', at: 0, len: 6, index: 0 },
    ];
    expect(pageHighlights(hits, 1, ITEMS)).toHaveLength(1);
    expect(pageHighlights(hits, 3, ITEMS)).toHaveLength(0);
  });
});
