/**
 * Verifying that a drafted rule's quote really is in the guideline document.
 *
 * ── WHY THIS EXISTS ──
 *
 * AI drafting of co-op rules was rejected three times, and the objection that
 * mattered was that extraction can't be trusted unreviewed: a confident,
 * plausible, UNCHECKABLE rule is worse than no rule, because nobody goes looking
 * for it. This module removes that failure mode mechanically.
 *
 * A drafter must return the verbatim span it relied on. Before a human ever sees
 * the proposal, the quote is checked against the document's own stored text. A
 * fabricated section reference cannot survive that check, so review becomes
 * "is this interpretation right" — a judgement a person can actually make —
 * instead of "does this sentence exist", which they'd have to take on trust.
 *
 * The text comes from `AdGuidelineDoc.pageText`, extracted when the document was
 * registered. So this reads text we already have: no PDF parsing, no re-fetch.
 *
 * ── WHY MATCHING IS TOLERANT, AND WHY IT IS STILL EVIDENCE ──
 *
 * Exact substring matching was the first design and it does not survive contact
 * with these documents. Extracted text follows glyph positions, not reading order,
 * so a sidebar callout lands INSIDE a sentence. Real example, Mazda §5a:
 *
 *     ...must be used once and should be(top placed prominently in the ad.
 *
 * where `(top` and `priority)` belong to a pull-quote beside the paragraph. The
 * sentence a person reads is not a contiguous span of the text we store, so an
 * exact match rejects a true quote — and a check that rejects true quotes trains
 * whoever runs it to stop believing it.
 *
 * So matching is a bounded subsequence: every word of the quote must appear on the
 * page, IN ORDER, inside a window no more than {@link MAX_STRETCH} times the
 * quote's own length. That tolerates interleaved words and hyphenation while still
 * being something a fabricated sentence cannot satisfy — it has to be the real
 * words, in the real order, packed together on one real page. The stretch factor
 * is reported, so a loose match is visible to the reviewer rather than silent.
 *
 * ── WHY NORMALIZE ──
 *
 * pdf.js text extraction breaks lines mid-sentence, and these documents are full
 * of typographic quotes and en-dashes that a model reasonably retypes as ASCII. A
 * raw substring match would reject true quotes for punctuation, which would train
 * whoever ran it to stop trusting the check. So both sides are folded to a
 * comparable form — but the fold keeps an index MAP back to the original offsets,
 * because the reader highlights the match on a rendered page image and needs the
 * position in the untouched text.
 *
 * Pure: no DB, no network, no clock.
 */

/** A folded string, with each character's position in the original. */
export interface NormalizedText {
  text: string;
  /** `map[i]` is the index in the ORIGINAL string that produced `text[i]`. */
  map: number[];
}

/**
 * Below this, a quote is not evidence. A handful of words can coincide with the
 * document by accident, and "see dealer for details" appears in most of them.
 */
export const MIN_QUOTE_CHARS = 24;

/** How far either side of the stated page to look before widening to the document. */
export const PAGE_SEARCH_RADIUS = 2;

/**
 * A quote found on more pages than this is a running header, a footer, or
 * boilerplate — it locates nothing, so it cannot support a rule about a specific
 * requirement.
 */
export const MAX_EVIDENCE_PAGES = 4;

/**
 * How much interpolated text a match may carry, as a multiple of the quote's own
 * word count. 1.6 accommodates the interleaving above (Mazda §5a needs ~1.1) while
 * refusing a "match" assembled from words scattered across a whole page.
 */
export const MAX_STRETCH = 1.6;

/**
 * Minimum words for a quote to be evidence. Guards the subsequence matcher: a
 * short run of common words could align with ordinary prose by chance, and the
 * character floor alone does not prevent that.
 */
export const MIN_QUOTE_WORDS = 6;

/**
 * Floors for a LIST ENTRY — a short quote backed by a separate context quote.
 *
 * A prohibited-terms list is the case this exists for. Mazda's guideline lists
 * "Clearance", "Blowout", "E-Plan" and thirty more under one prohibitive sentence,
 * and for a `banned_phrase` rule the term IS the evidence — there is no longer
 * sentence to quote. Holding those to the full floor discarded 27 of 45 real
 * proposals on the first live run.
 *
 * They stay evidence because BOTH halves must verify on the SAME page: the term,
 * and a full-length quote establishing that the list forbids things. A fabricated
 * term cannot satisfy that, and neither can a real term paired with an invented
 * heading.
 */
export const MIN_LIST_ITEM_CHARS = 3;
export const MIN_LIST_ITEM_WORDS = 1;

/** Zero-width and formatting characters that carry no meaning for matching. */
const DROPPED = /[\u00AD\u200B-\u200D\uFEFF]/;
/** Hyphens, dashes and the minus sign, all of which get retyped as `-`. */
const DASHES = /[\u2010-\u2015\u2212]/;

/** Fold one character, or null to drop it entirely. Strictly 1:1 so the map holds. */
function fold(c: string): string | null {
  if (DROPPED.test(c)) return null;
  if (c === '\u2018' || c === '\u2019' || c === '\u02BC') return "'";
  if (c === '\u201C' || c === '\u201D') return '"';
  if (DASHES.test(c)) return '-';
  if (c === '\u00A0') return ' ';
  const lower = c.toLowerCase();
  // Some characters lowercase to two (U+1E9B, U+0130). Keeping the original preserves the
  // 1:1 invariant the offset map depends on; it costs nothing here because those
  // characters don't appear in these documents.
  return lower.length === 1 ? lower : c;
}

/**
 * Fold `raw` for comparison: lowercased, ASCII punctuation, whitespace runs
 * collapsed to one space, no leading or trailing space.
 */
export function normalizeForQuoteMatch(raw: string): NormalizedText {
  const chars: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < raw.length; i++) {
    const folded = fold(raw[i]);
    if (folded === null) continue;
    if (/\s/.test(folded)) {
      // Never emit a leading space; a run of whitespace becomes at most one.
      if (chars.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      chars.push(' ');
      map.push(i);
      pendingSpace = false;
    }
    chars.push(folded);
    map.push(i);
  }
  return { text: chars.join(''), map };
}

/** One word of a page, with its position in the ORIGINAL text. */
export interface Token {
  /** Folded word — lowercase alphanumerics only. */
  t: string;
  start: number;
  end: number;
}

/**
 * Split into words on any non-alphanumeric boundary.
 *
 * Deliberately discards punctuation rather than tokenizing it. Extraction glues
 * stray characters onto words (`be(top`), hyphenates across line breaks, and
 * renders `$3,500` inconsistently; splitting on those boundaries makes both sides
 * agree without having to model any of it.
 */
export function tokenize(raw: string): Token[] {
  const out: Token[] = [];
  let word: string[] = [];
  let start = -1;
  const flush = (end: number) => {
    if (word.length) out.push({ t: word.join(''), start, end });
    word = [];
    start = -1;
  };
  for (let i = 0; i < raw.length; i++) {
    const folded = fold(raw[i]);
    if (folded !== null && /[a-z0-9]/.test(folded)) {
      if (start === -1) start = i;
      word.push(folded);
    } else {
      flush(i);
    }
  }
  flush(raw.length);
  return out;
}

/** Pages folded once, so screening many proposals doesn't refold the document. */
export interface QuoteCorpus {
  /** Index 0 is page 1. */
  pages: NormalizedText[];
  /** Word tokens per page, index 0 is page 1. */
  tokens: Token[][];
}

export function prepareQuoteCorpus(pages: string[]): QuoteCorpus {
  const raw = pages.map((p) => p ?? '');
  return {
    pages: raw.map((p) => normalizeForQuoteMatch(p)),
    tokens: raw.map((p) => tokenize(p)),
  };
}

export type QuoteFailure =
  /** Too little text to be evidence of anything, and no context quote supplied. */
  | 'too_short'
  /** A short entry was supplied, but its supporting context quote didn't check out. */
  | 'context_not_found'
  /** The words are not on any page, in order, closely enough packed. */
  | 'not_found'
  /** Present on so many pages that it identifies no particular requirement. */
  | 'not_evidence';

export interface QuoteLocation {
  /** 1-based page the quote was actually found on. */
  page: number;
  /** 1-based page the drafter claimed. */
  statedPage: number;
  /** True when `page` differs from `statedPage` — shown to the reviewer. */
  pageCorrected: boolean;
  /** Offsets into the ORIGINAL text of `page`, for highlighting. */
  start: number;
  end: number;
  /** Every page the quote appears on, in order. */
  matchedPages: number[];
  /** `exact` = contiguous span. `loose` = words in order with text interleaved.
   *  `list_item` = a short entry verified together with its context quote. */
  matchType: 'exact' | 'loose' | 'list_item';
  /** For `list_item`: where the supporting context quote sits on the same page. */
  context?: { start: number; end: number; quote: string };
  /** Matched window length ÷ quote length, in words. 1 = nothing interleaved. */
  stretch: number;
}

export type QuoteCheck =
  | { ok: true; at: QuoteLocation }
  | { ok: false; reason: QuoteFailure; detail: string };

interface PageMatch {
  page: number;
  start: number;
  end: number;
  matchType: 'exact' | 'loose';
  stretch: number;
}

/**
 * Smallest window on this page containing every quote word in order, or null.
 *
 * Anchors on each occurrence of the quote's first word and matches greedily
 * forward — for a fixed start, the greedy end IS the minimal end, so this finds
 * the tightest window without scanning every pair.
 */
function findLooseWindow(pageTokens: Token[], quoteWords: string[]): PageMatch | null {
  const need = quoteWords.length;
  const budget = Math.floor(need * MAX_STRETCH);
  let best: { from: number; to: number } | null = null;

  for (let anchor = 0; anchor < pageTokens.length; anchor++) {
    if (pageTokens[anchor].t !== quoteWords[0]) continue;
    let qi = 1;
    let pi = anchor + 1;
    while (qi < need && pi < pageTokens.length && pi - anchor < budget) {
      if (pageTokens[pi].t === quoteWords[qi]) qi++;
      pi++;
    }
    if (qi < need) continue;
    const span = pi - anchor;
    if (span > budget) continue;
    if (!best || span < best.to - best.from) best = { from: anchor, to: pi };
  }

  if (!best) return null;
  return {
    page: 0,
    start: pageTokens[best.from].start,
    end: pageTokens[best.to - 1].end,
    matchType: 'loose',
    stretch: (best.to - best.from) / need,
  };
}

/** Every page a needle appears on, exact matches preferred over loose ones. */
function findMatches(corpus: QuoteCorpus, quote: string): PageMatch[] {
  const needle = normalizeForQuoteMatch(quote);
  const words = tokenize(quote).map((w) => w.t);
  const out: PageMatch[] = [];
  for (let i = 0; i < corpus.pages.length; i++) {
    const exact = corpus.pages[i].text.indexOf(needle.text);
    if (exact !== -1) {
      const map = corpus.pages[i].map;
      out.push({
        page: i + 1,
        start: map[exact],
        end: map[exact + needle.text.length - 1] + 1,
        matchType: 'exact',
        stretch: 1,
      });
      continue;
    }
    const loose = findLooseWindow(corpus.tokens[i], words);
    if (loose) out.push({ ...loose, page: i + 1 });
  }
  return out;
}

/** Pick the match nearest the stated page, tightest first on a tie. */
function preferred(matches: PageMatch[], statedPage: number): PageMatch {
  return [...matches].sort((a, b) => {
    const d = Math.abs(a.page - statedPage) - Math.abs(b.page - statedPage);
    return d !== 0 ? d : a.stretch - b.stretch;
  })[0];
}

export interface VerifyOptions {
  /**
   * A full-length quote establishing that a SHORT `quote` is an entry in a
   * prohibitive or mandatory list. Required whenever `quote` is below the normal
   * floor — see {@link MIN_LIST_ITEM_CHARS}.
   */
  context?: string;
}

/**
 * Is `quote` really on (or near) page `statedPage` of this document?
 *
 * Searches every page, preferring the stated one, then the nearest. A quote found
 * elsewhere is ACCEPTED with `pageCorrected` set rather than rejected: the sentence
 * is real and the rule may well be right, so that is a note for the reviewer, not
 * grounds to discard a true finding. Only a quote found nowhere is discarded.
 *
 * A short `quote` is accepted only with a verifying `context` quote on the same
 * page — the list-entry case in {@link MIN_LIST_ITEM_CHARS}.
 */
export function verifyQuoteIn(
  corpus: QuoteCorpus,
  statedPage: number,
  quote: string,
  opts: VerifyOptions = {},
): QuoteCheck {
  const needle = normalizeForQuoteMatch(quote ?? '');
  const words = tokenize(quote ?? '').map((w) => w.t);
  const meetsFloor = needle.text.length >= MIN_QUOTE_CHARS && words.length >= MIN_QUOTE_WORDS;

  if (!meetsFloor) {
    // ── the list-entry path ──
    const tooTiny =
      needle.text.length < MIN_LIST_ITEM_CHARS || words.length < MIN_LIST_ITEM_WORDS;
    if (tooTiny || !opts.context?.trim()) {
      return {
        ok: false,
        reason: 'too_short',
        detail: tooTiny
          ? `Quote is ${words.length} word(s) / ${needle.text.length} character(s), below the ${MIN_LIST_ITEM_WORDS}-word / ${MIN_LIST_ITEM_CHARS}-character minimum for a list entry.`
          : `Quote is only ${words.length} word(s); a quote below ${MIN_QUOTE_WORDS} words needs a supporting context quote naming the list it belongs to.`,
      };
    }

    // The context must stand on its own as evidence.
    const context = verifyQuoteIn(corpus, statedPage, opts.context);
    if (!context.ok) {
      return {
        ok: false,
        reason: 'context_not_found',
        detail: `The supporting context quote did not check out (${context.reason}): ${context.detail}`,
      };
    }

    // The entry itself must appear on the SAME page as its context. Anywhere else
    // and the two halves are not evidence about each other.
    const onContextPage = findMatches(corpus, quote).filter((m) => m.page === context.at.page);
    if (onContextPage.length === 0) {
      return {
        ok: false,
        reason: 'not_found',
        detail: `"${quote.trim()}" does not appear on page ${context.at.page}, where its context quote is.`,
      };
    }

    const entry = onContextPage[0];
    return {
      ok: true,
      at: {
        page: context.at.page,
        statedPage,
        pageCorrected: context.at.page !== statedPage,
        start: entry.start,
        end: entry.end,
        matchedPages: [context.at.page],
        matchType: 'list_item',
        stretch: 1,
        context: { start: context.at.start, end: context.at.end, quote: opts.context.trim() },
      },
    };
  }

  const matches = findMatches(corpus, quote);
  if (matches.length === 0) {
    return {
      ok: false,
      reason: 'not_found',
      detail: `Quote does not appear on any of the ${corpus.pages.length} page(s), even allowing for interleaved text.`,
    };
  }
  if (matches.length > MAX_EVIDENCE_PAGES) {
    return {
      ok: false,
      reason: 'not_evidence',
      detail: `Quote appears on ${matches.length} pages, so it is boilerplate rather than the source of a specific requirement.`,
    };
  }

  const chosen = preferred(matches, statedPage);
  return {
    ok: true,
    at: {
      page: chosen.page,
      statedPage,
      pageCorrected: chosen.page !== statedPage,
      start: chosen.start,
      end: chosen.end,
      matchedPages: matches.map((m) => m.page),
      matchType: chosen.matchType,
      stretch: Number(chosen.stretch.toFixed(2)),
    },
  };
}

/** Convenience for a one-off check; prefer {@link prepareQuoteCorpus} in a loop. */
export function verifyQuote(
  pages: string[],
  statedPage: number,
  quote: string,
  opts: VerifyOptions = {},
): QuoteCheck {
  return verifyQuoteIn(prepareQuoteCorpus(pages), statedPage, quote, opts);
}

/**
 * ── FREE-TEXT SEARCH ──────────────────────────────────────────────────────────
 *
 * A DIFFERENT JOB from verification above, and the distinction matters enough to
 * state: verification asks "is this claimed quote really in the document", and its
 * floors (six words, twenty-four characters) exist to stop a fragment being passed
 * off as evidence. A person typing "security deposit" into a search box is making no
 * claim, so NONE of those floors apply. Sharing the matcher and not the thresholds is
 * the whole point of keeping these separate.
 *
 * It replaces `guideline-search.ts::findHits` for callers that can take an async
 * corpus. That one is plain substring matching, which silently misses any passage
 * broken by the interleaving described at the top of this file — the failure is
 * invisible, because a search returning nothing looks like a document that says
 * nothing.
 */

/** Below this a query matches most of the document and the results are noise. */
export const MIN_SEARCH_CHARS = 2;

/**
 * Loose matching needs at least this many words to be meaningful. Under it, two
 * tokens could align almost anywhere, so short queries are matched exactly only —
 * which is also what a reader typing `$1,000` or `APR (24 mo.)` expects.
 */
const MIN_LOOSE_WORDS = 3;

/** Characters of surrounding context returned either side of a hit. */
export const SNIPPET_PAD = 70;

export interface CorpusHit {
  /** 1-based page. */
  page: number;
  /** Offsets into the ORIGINAL text of that page — what `matchBoxes` consumes. */
  start: number;
  end: number;
  /** `loose` means text was interleaved inside the match. */
  matchType: 'exact' | 'loose';
  /** Matched span ÷ query length, in words. 1 for an exact hit. */
  stretch: number;
  /** Whitespace-collapsed window around the hit, for a results list. */
  snippet: string;
  /** Where the match sits inside `snippet`, for highlighting it there. */
  snippetAt: number;
  snippetLen: number;
}

/** A readable window around [start,end) of `raw`, plus where the match landed. */
function snippetAround(raw: string, start: number, end: number, pad: number) {
  const from = Math.max(0, start - pad);
  const to = Math.min(raw.length, end + pad);
  const before = raw.slice(from, start).replace(/\s+/g, ' ');
  const hit = raw.slice(start, end).replace(/\s+/g, ' ');
  const after = raw.slice(end, to).replace(/\s+/g, ' ');
  const lead = from > 0 ? '…' : '';
  const tail = to < raw.length ? '…' : '';
  return {
    snippet: `${lead}${before}${hit}${after}${tail}`,
    snippetAt: lead.length + before.length,
    snippetLen: hit.length,
  };
}

/**
 * Every hit for `query` across the corpus, in page order.
 *
 * Exact occurrences first on each page — all of them, not just the first, since a
 * term can appear several times on one page and a reader wants each. Loose windows
 * are found only where a page has no exact hit, so a clean document never pays for
 * the tolerance.
 *
 * `limit` bounds the work as well as the result: matching stops once it is reached.
 *
 * Snippets come back EMPTY: building one needs the raw pages, which a corpus does not
 * retain. Use {@link searchPages} unless you are holding a corpus without its source.
 */
export function searchCorpus(
  corpus: QuoteCorpus,
  query: string,
  opts: { limit?: number } = {},
): CorpusHit[] {
  const limit = opts.limit ?? 100;
  const needle = normalizeForQuoteMatch(query ?? '');
  if (needle.text.length < MIN_SEARCH_CHARS || limit <= 0) return [];
  const words = tokenize(query ?? '').map((w) => w.t);

  const hits: CorpusHit[] = [];
  for (let i = 0; i < corpus.pages.length && hits.length < limit; i++) {
    const page = corpus.pages[i];
    let found = 0;

    // Exact occurrences, all of them.
    for (let at = page.text.indexOf(needle.text); at !== -1; ) {
      const start = page.map[at];
      const end = page.map[at + needle.text.length - 1] + 1;
      hits.push({ page: i + 1, start, end, matchType: 'exact', stretch: 1, snippet: '', snippetAt: 0, snippetLen: 0 });
      found++;
      if (hits.length >= limit) break;
      at = page.text.indexOf(needle.text, at + needle.text.length);
    }

    // Only fall back to loose matching where the page had no exact hit.
    if (found === 0 && words.length >= MIN_LOOSE_WORDS) {
      const loose = findLooseWindow(corpus.tokens[i], words);
      if (loose) {
        hits.push({
          page: i + 1,
          start: loose.start,
          end: loose.end,
          matchType: 'loose',
          stretch: Number(loose.stretch.toFixed(2)),
          snippet: '',
          snippetAt: 0,
          snippetLen: 0,
        });
      }
    }
  }
  return hits.slice(0, limit);
}

/**
 * {@link searchCorpus} with snippets filled in from the original page text.
 *
 * Separate because snippets need the RAW pages, which the corpus does not retain —
 * it keeps folded text and an offset map, not the source. Callers holding the pages
 * (everyone who built the corpus) should use this.
 */
export function searchPages(
  pages: string[],
  query: string,
  opts: { limit?: number; pad?: number } = {},
): CorpusHit[] {
  const corpus = prepareQuoteCorpus(pages);
  return searchCorpus(corpus, query, opts).map((hit) => ({
    ...hit,
    ...snippetAround(pages[hit.page - 1] ?? '', hit.start, hit.end, opts.pad ?? SNIPPET_PAD),
  }));
}

/**
 * The document as one prompt-ready string, with explicit page markers.
 *
 * The markers are the whole reason a drafter can cite a page at all, and they are
 * what {@link verifyQuoteIn} checks the answer against — so the format is part of
 * the contract between the prompt and the verifier, not a presentational choice.
 */
export function renderPagesForPrompt(pages: string[]): string {
  return pages
    .map((text, i) => `[page ${i + 1}]\n${(text ?? '').trim()}`)
    .join('\n\n');
}
