/**
 * Searching a guideline document, and locating the matches on the rendered page.
 *
 * Pure — no DOM, no fetch — so the matching rules are testable on their own.
 *
 * The reader shows pages as IMAGES (see the page-image route for why), so a match
 * can't be highlighted by selecting text. Instead the server hands back the
 * geometry of every text run on the page, and {@link matchBoxes} maps a match in
 * the page's plain text onto the boxes it covers. That's the same trick pdf.js's own
 * text layer uses.
 */

export interface Hit {
  /** 1-based page. */
  page: number;
  /** A window of text around the match, for the results list. */
  snippet: string;
  /** Offset of the matched term within `snippet`. */
  at: number;
  len: number;
  /** Offset of the match within the full page text — the key to locating it. */
  index: number;
}

/** One run of text on a page, with its box in normalized (0..1) page coordinates. */
export interface TextItem {
  /** Offset of this run's first character within the page's plain text. */
  s: number;
  /** Character length of the run. */
  n: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Characters of context to show either side of a match. */
const SNIPPET_PAD = 60;
export const MAX_HITS = 100;
/** Below this, a query matches most of the document and the list is just noise. */
export const MIN_QUERY = 2;

/**
 * Every match of `q` across the document, in page order.
 *
 * Plain case-insensitive substring matching, not regex: people search these for
 * "security deposit", "$1,000" and "APR (24 mo.)", and a regex engine would either
 * throw on the punctuation or need escaping that buys nothing here.
 */
export function findHits(pages: string[], q: string): Hit[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < MIN_QUERY) return [];
  const hits: Hit[] = [];
  for (let p = 0; p < pages.length && hits.length < MAX_HITS; p++) {
    const text = pages[p] ?? '';
    const hay = text.toLowerCase();
    let from = 0;
    while (hits.length < MAX_HITS) {
      const i = hay.indexOf(needle, from);
      if (i === -1) break;
      const start = Math.max(0, i - SNIPPET_PAD);
      const end = Math.min(text.length, i + needle.length + SNIPPET_PAD);
      const lead = start > 0 ? '…' : '';
      hits.push({
        page: p + 1,
        snippet: lead + text.slice(start, end) + (end < text.length ? '…' : ''),
        at: i - start + lead.length,
        len: needle.length,
        index: i,
      });
      from = i + needle.length;
    }
  }
  return hits;
}

/**
 * Boxes covering the match at `[index, index+len)` of a page's text.
 *
 * A phrase almost never lives in one run — pdf.js splits text wherever the font,
 * size or position changes, so "security deposit" is routinely three runs. Any run
 * that OVERLAPS the match range contributes a box, which is why a highlight can
 * appear as two rectangles across a line break. That's correct, and better than
 * drawing one box spanning the gap between them.
 *
 * Runs are matched by character range rather than by re-searching their text,
 * because the page string is the concatenation the offsets were taken from — going
 * back to string matching would re-introduce the split-run problem.
 */
export function matchBoxes(items: TextItem[], index: number, len: number): Box[] {
  const end = index + len;
  const out: Box[] = [];
  for (const it of items) {
    const itEnd = it.s + it.n;
    if (itEnd <= index || it.s >= end) continue;
    out.push({ x: it.x, y: it.y, w: it.w, h: it.h });
  }
  return out;
}

/** Every match on one page, as boxes — what the overlay actually draws. */
export function pageHighlights(hits: Hit[], page: number, items: TextItem[]): Box[] {
  return hits.filter((h) => h.page === page).flatMap((h) => matchBoxes(items, h.index, h.len));
}
