import { describe, it, expect } from 'vitest';
import {
  MAX_EVIDENCE_PAGES,
  MAX_STRETCH,
  MIN_QUOTE_WORDS,
  tokenize,
  normalizeForQuoteMatch,
  prepareQuoteCorpus,
  renderPagesForPrompt,
  searchPages,
  verifyQuote,
} from './guideline-quotes';

/** A quote long enough to clear MIN_QUOTE_CHARS, so tests exercise the real path. */
const LONG = 'the dealer must clearly identify itself using its full dealership name';

describe('normalizeForQuoteMatch', () => {
  it('collapses whitespace and keeps a map back to the original', () => {
    const n = normalizeForQuoteMatch('A  b\n\nc');
    expect(n.text).toBe('a b c');
    // Every normalized character points at the character that produced it.
    expect(n.map).toHaveLength(n.text.length);
    expect('A  b\n\nc'[n.map[0]]).toBe('A');
    expect('A  b\n\nc'[n.map[n.text.length - 1]]).toBe('c');
  });

  it('drops leading and trailing whitespace', () => {
    expect(normalizeForQuoteMatch('  padded  ').text).toBe('padded');
  });

  it('folds typographic punctuation a drafter would retype as ASCII', () => {
    expect(normalizeForQuoteMatch('“dealer’s” 36–month').text).toBe(
      '"dealer\'s" 36-month',
    );
  });

  it('drops soft hyphens and zero-width characters', () => {
    expect(normalizeForQuoteMatch('co­op​ad').text).toBe('coopad');
  });

  it('keeps the map 1:1 so offsets stay exact', () => {
    const raw = 'X “y”';
    const n = normalizeForQuoteMatch(raw);
    for (let i = 0; i < n.text.length; i++) {
      expect(n.map[i]).toBeGreaterThanOrEqual(0);
      expect(n.map[i]).toBeLessThan(raw.length);
    }
  });
});

describe('verifyQuote', () => {
  const pages = ['cover page only', `Section 5e. ${LONG} in all media types.`, 'unrelated page'];

  it('finds a quote on the stated page and reports original offsets', () => {
    const r = verifyQuote(pages, 2, LONG);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.at.page).toBe(2);
    expect(r.at.pageCorrected).toBe(false);
    // The offsets must slice the ORIGINAL page text back to the quote.
    expect(pages[1].slice(r.at.start, r.at.end)).toBe(LONG);
  });

  it('matches across a line break in the document', () => {
    const broken = ['', 'Section 5e. the dealer must clearly identify\nitself using its full dealership name here.'];
    const r = verifyQuote(broken, 2, 'the dealer must clearly identify itself using its full dealership name');
    expect(r.ok).toBe(true);
  });

  it('corrects the page rather than discarding a real quote', () => {
    const r = verifyQuote(pages, 1, LONG);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.at.page).toBe(2);
    expect(r.at.statedPage).toBe(1);
    expect(r.at.pageCorrected).toBe(true);
  });

  it('rejects a quote that is nowhere in the document', () => {
    const r = verifyQuote(pages, 2, 'every advertisement must include a minimum eight point disclaimer');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not_found');
  });

  it('rejects a quote too short to be evidence, and says what would fix it', () => {
    const r = verifyQuote(pages, 2, 'Section 5e');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('too_short');
    // Short but not tiny: the message points at the context quote that would
    // make it admissible, rather than just refusing.
    expect(r.detail).toContain(String(MIN_QUOTE_WORDS));
    expect(r.detail).toContain('context');
  });

  it('rejects boilerplate that appears on too many pages', () => {
    const header = 'Kia America Advertising Standards and Support Guidelines';
    const many = Array.from({ length: MAX_EVIDENCE_PAGES + 1 }, () => `${header} page body`);
    const r = verifyQuote(many, 1, header);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not_evidence');
  });

  it('accepts a quote repeated on a few pages and reports all of them', () => {
    const twice = [`intro ${LONG}`, 'middle', `repeat ${LONG}`];
    const r = verifyQuote(twice, 3, LONG);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.at.matchedPages).toEqual([1, 3]);
    expect(r.at.page).toBe(3);
  });

  it('tolerates a page array with holes', () => {
    const holey = ['', '', `x ${LONG}`] as string[];
    expect(verifyQuote(holey, 3, LONG).ok).toBe(true);
  });

  it('reuses a prepared corpus', () => {
    const corpus = prepareQuoteCorpus(pages);
    expect(corpus.pages).toHaveLength(3);
    expect(corpus.pages[1].text).toContain('dealership name');
  });
});

describe('renderPagesForPrompt', () => {
  it('marks every page so a cited page number is checkable', () => {
    const out = renderPagesForPrompt(['first', 'second']);
    expect(out).toBe('[page 1]\nfirst\n\n[page 2]\nsecond');
  });
});

describe('tokenize', () => {
  it('splits on non-alphanumeric boundaries so glued-on punctuation still matches', () => {
    // Real extraction artefact: a sidebar word glued to a sentence word.
    expect(tokenize('should be(top placed').map((w) => w.t)).toEqual([
      'should',
      'be',
      'top',
      'placed',
    ]);
  });

  it('keeps offsets pointing into the original text', () => {
    const raw = 'the  Mazda logo';
    const tokens = tokenize(raw);
    expect(tokens.map((w) => raw.slice(w.start, w.end))).toEqual(['the', 'Mazda', 'logo']);
  });
});

describe('verifyQuote — interleaved extraction (the real-document case)', () => {
  // Verbatim from MCAP_Interactive_Guidelines_Aug_2025.pdf p.12 as pdftotext emits
  // it: the pull-quote "(top priority)" lands inside the sentence.
  const page =
    '5a. The Mazda brand mark must be used once and should\nbe(top\nplaced\nprominently\nin the ad. Exclusions may apply.';
  const pages = ['cover', page];
  const asRead = 'The Mazda brand mark must be used once and should be placed prominently in the ad';

  it('accepts the sentence as a person reads it, and marks the match loose', () => {
    const r = verifyQuote(pages, 2, asRead);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.at.matchType).toBe('loose');
    expect(r.at.stretch).toBeGreaterThan(1);
    expect(r.at.stretch).toBeLessThanOrEqual(MAX_STRETCH);
    // The highlight must still cover the real span in the original text.
    expect(page.slice(r.at.start, r.at.end)).toContain('brand mark must be used');
  });

  it('still calls a clean contiguous quote exact', () => {
    const r = verifyQuote(pages, 2, 'Exclusions may apply');
    // Too short on its own, so use a longer clean span.
    expect(r.ok).toBe(false);
    const r2 = verifyQuote(
      ['', 'The Mazda logo may not be displayed less than 10mm wide in any medium.'],
      2,
      'The Mazda logo may not be displayed less than 10mm wide',
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.at.matchType).toBe('exact');
    expect(r2.at.stretch).toBe(1);
  });
});

describe('verifyQuote — the tolerance stays bounded', () => {
  it('refuses a sentence assembled from words scattered across the page', () => {
    const scattered =
      'the dealer must file claims within ninety days. logos are available from the portal. ' +
      'advertising may not overstate savings. every claim requires a tear sheet and an invoice. ' +
      'the program year begins in january and reimbursement is capped per quarter.';
    // Every one of these words is on the page, in this order — but spread out.
    const fabricated = 'the dealer must not overstate savings in every advertising claim';
    const r = verifyQuote(['', scattered], 2, fabricated);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not_found');
  });

  it('rejects a quote with too few words even when the characters add up', () => {
    const r = verifyQuote(['', 'incomprehensibly overqualified antidisestablishmentarian'], 2,
      'incomprehensibly overqualified antidisestablishmentarian');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('too_short');
    expect(r.detail).toContain(String(MIN_QUOTE_WORDS));
  });
});

describe('verifyQuote — list entries (prohibited-terms lists)', () => {
  // Shaped like Mazda's real prohibited-terms page, which is what broke the
  // first live run: 27 of 45 proposals were single terms off a list like this.
  const LEAD = 'The following terms and phrases may not be used in any Mazda advertising:';
  const pages = [
    'cover',
    `${LEAD} Clearance. Blowout. Employee Pricing. E-Plan. Overstocked.`,
    'a later page that also happens to mention Blowout in passing text here',
  ];

  it('accepts a short term when its context quote checks out on the same page', () => {
    const r = verifyQuote(pages, 2, 'Clearance', { context: LEAD });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.at.matchType).toBe('list_item');
    expect(r.at.page).toBe(2);
    // The highlight lands on the TERM, with the context recorded alongside.
    expect(pages[1].slice(r.at.start, r.at.end)).toBe('Clearance');
    expect(r.at.context).toBeDefined();
    expect(pages[1].slice(r.at.context!.start, r.at.context!.end)).toBe(LEAD);
  });

  it('accepts a very short term like an initialism', () => {
    const withCpo = ['', `${LEAD} CPO. Certified Program.`];
    expect(verifyQuote(withCpo, 2, 'CPO', { context: LEAD }).ok).toBe(true);
  });

  it('refuses a short term with no context quote at all', () => {
    const r = verifyQuote(pages, 2, 'Clearance');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('too_short');
    expect(r.detail).toContain('context');
  });

  it('refuses a short term whose context quote is invented', () => {
    const r = verifyQuote(pages, 2, 'Clearance', {
      context: 'Dealers are forbidden from using any of the words listed in appendix four below.',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('context_not_found');
  });

  it('refuses a term that is real but sits on a different page from its context', () => {
    // "Blowout" also appears on page 3; the context is only on page 2. Pairing the
    // page-3 occurrence with the page-2 heading would not be evidence.
    const split = ['cover', LEAD, 'unrelated page mentioning Blowout in ordinary prose'];
    const r = verifyQuote(split, 3, 'Blowout', { context: LEAD });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not_found');
  });

  it('refuses something below even the list-entry floor', () => {
    const r = verifyQuote(pages, 2, '.', { context: LEAD });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('too_short');
  });
});

describe('searchPages — free-text search', () => {
  const pages = [
    'Cover page for the program guide',
    'A security deposit is not required on any advertised lease. Security deposit waivers apply.',
    '5a. The Mazda brand mark must be used once and should\nbe(top\nplaced\nprominently\nin the ad.',
    'Payments of $1,000 or more must be itemized. APR (24 mo.) offers need a term.',
  ];

  it('finds every occurrence on a page, in page order', () => {
    const hits = searchPages(pages, 'security deposit');
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.page === 2)).toBe(true);
    // Offsets index the ORIGINAL text, which is what the highlighter needs.
    for (const h of hits) {
      expect(pages[1].slice(h.start, h.end).toLowerCase()).toBe('security deposit');
    }
  });

  it('has no evidence floor — a one-word query is fine', () => {
    // The six-word floor is a rule about EVIDENCE, not about searching.
    const hits = searchPages(pages, 'brandmark');
    expect(hits).toEqual([]);
    expect(searchPages(pages, 'Mazda').length).toBeGreaterThan(0);
  });

  it('matches through interleaved extraction, and says the match was loose', () => {
    const hits = searchPages(pages, 'must be used once and should be placed prominently');
    expect(hits).toHaveLength(1);
    expect(hits[0].page).toBe(3);
    expect(hits[0].matchType).toBe('loose');
    expect(hits[0].stretch).toBeGreaterThan(1);
  });

  it('treats punctuation literally on the exact path', () => {
    // People search "$1,000" and "APR (24 mo.)" — these must not be regex or tokens.
    expect(searchPages(pages, '$1,000')).toHaveLength(1);
    expect(searchPages(pages, 'APR (24 mo.)')).toHaveLength(1);
  });

  it('returns a readable snippet with the match located inside it', () => {
    const [hit] = searchPages(pages, '$1,000');
    expect(hit.snippet).toContain('$1,000');
    expect(hit.snippet.slice(hit.snippetAt, hit.snippetAt + hit.snippetLen)).toBe('$1,000');
    // Whitespace is collapsed for a results list, so no raw newlines.
    expect(hit.snippet).not.toContain('\n');
  });

  it('bounds the result set', () => {
    const many = Array.from({ length: 30 }, () => 'security deposit waiver');
    expect(searchPages(many, 'security deposit', { limit: 5 })).toHaveLength(5);
    expect(searchPages(many, 'security deposit', { limit: 0 })).toEqual([]);
  });

  it('ignores a query too short to be useful', () => {
    expect(searchPages(pages, 'a')).toEqual([]);
  });

  it('does not loose-match a very short query', () => {
    // Two tokens could align almost anywhere; short queries stay exact-only.
    const spread = ['', 'the term is stated here and elsewhere the apr appears separately'];
    expect(searchPages(spread, 'term apr')).toEqual([]);
  });
});
