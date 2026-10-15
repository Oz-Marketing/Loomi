import { prisma } from '@/lib/prisma';
import { prepareQuoteCorpus, verifyQuoteIn } from '@/lib/ad-generator/guideline-quotes';

/**
 * Co-op guideline documents as drafting INPUT (docs/email-drafting.md §8).
 *
 * For a co-op request, the copywriter is shown the pages of the make's
 * manufacturer guidelines that bear on an offer email, writes copy that
 * satisfies them where it can, and lists what it couldn't — each item citing
 * its document and page. Those become notes on the draft. Nothing here blocks
 * anything: a make with no document drafts exactly as before.
 */

// ── Which documents belong to a make ─────────────────────────────────────────

/**
 * The documents for an account's make, as `AdGuidelineDoc.make` plus an
 * optional title test. Explicit because a lookup by make finds the wrong
 * document or none: Chrysler, Dodge, Jeep and Ram are filed as "CDJR"; Honda's
 * car and powersports guides are both filed as "Honda"; Buick and GMC sit
 * under GM iMR, filed as Chevrolet; the BRP brands are one "BRP" document.
 * A make not listed here matches a document filed under its own name.
 */
interface Source {
  make: string;
  title?: RegExp;
}

const GM_IMR: Source = { make: 'Chevrolet', title: /\biMR\b/i };
const BRP: Source = { make: 'BRP' };

export const GUIDELINE_SOURCES: Record<string, Source[]> = {
  chrysler: [{ make: 'CDJR' }],
  dodge: [{ make: 'CDJR' }],
  jeep: [{ make: 'CDJR' }],
  ram: [{ make: 'CDJR' }],
  chevrolet: [GM_IMR],
  buick: [GM_IMR],
  gmc: [GM_IMR, { make: 'GMC' }],
  honda: [{ make: 'Honda', title: /^(?!.*powersports)/i }],
  'honda powersports': [{ make: 'Honda', title: /powersports/i }],
  'can-am': [BRP],
  'ski-doo': [BRP],
  'sea-doo': [BRP],
  lynx: [BRP],
};

/** Documents that are about something other than advertising, whatever they're filed under. */
const NOT_GUIDELINES = /claim status/i;

export function documentsFor<T extends { make: string; title: string }>(make: string, docs: T[]): T[] {
  const sources = GUIDELINE_SOURCES[make.toLowerCase()] ?? [{ make }];
  return docs.filter(
    (d) =>
      !NOT_GUIDELINES.test(d.title) &&
      sources.some((s) => s.make.toLowerCase() === d.make.toLowerCase() && (!s.title || s.title.test(d.title))),
  );
}

// ── Which pages bear on an offer email ───────────────────────────────────────

/** Terms that make a page worth the copywriter's attention, weighted. Email and digital rules first. */
const PAGE_TERMS: { re: RegExp; weight: number }[] = [
  { re: /\be-?mail\b/gi, weight: 4 },
  { re: /\bsubject line\b|\bdigital\b|\bonline\b/gi, weight: 2 },
  // Whether email is even eligible is the first thing a co-op email needs to know.
  { re: /\bineligible|not eligible|non-eligible|eligible media\b/gi, weight: 3 },
  { re: /\bdisclaimer|disclosure|fine print|legal\b/gi, weight: 2 },
  { re: /\boffer|incentive|APR|lease|financ|MSRP|price|pricing|payment\b/gi, weight: 1 },
  { re: /\btrademark|logo|brand name|model name|dealer name\b/gi, weight: 1 },
  { re: /\bprohibit|must not|may not|not permitted|required|must include\b/gi, weight: 1 },
];

export interface GuidelineDoc {
  title: string;
  /** Page text, page 1 first. */
  pages: string[];
}

export interface GuidelinePage {
  title: string;
  /** 1-based. */
  page: number;
  text: string;
}

/**
 * Email ADDRESSES say nothing about email as a channel, and a running page
 * footer ("Phone: … | Email: saf@ansira") would otherwise give every page of
 * the Subaru guide an email hit. Stripped before anything is counted.
 */
function forScoring(text: string): string {
  return text.replace(/\S+@\S+/g, ' ').replace(/\bE-?mail:\s*/gi, ' ');
}

export function pageScore(text: string): number {
  const t = forScoring(text);
  let score = 0;
  for (const { re, weight } of PAGE_TERMS) score += (t.match(re)?.length ?? 0) * weight;
  return score;
}

/** The page talks about email as a channel. */
export function aboutEmail(text: string): boolean {
  return /\be-?mail\b/i.test(forScoring(text));
}

/**
 * The most relevant pages across a make's documents, within `budget`
 * characters, in document and page order so the reader can follow them.
 * Pages about email as a channel go first, whatever their score — a dense
 * pricing page outscores a short eligibility list on raw counts, and whether
 * email qualifies at all matters more. A page that scores nothing is never sent.
 */
export function pickPages(docs: GuidelineDoc[], budget = 40_000, maxPages = 12): GuidelinePage[] {
  const scored = docs.flatMap((d) =>
    d.pages.map((text, i) => ({ title: d.title, page: i + 1, text: text.trim(), score: pageScore(text) })),
  );
  const chosen: typeof scored = [];
  let used = 0;
  const rank = (p: (typeof scored)[number]) => (aboutEmail(p.text) ? 1_000_000 : 0) + p.score;
  for (const p of [...scored].filter((p) => p.score > 0 && p.text).sort((a, b) => rank(b) - rank(a))) {
    if (chosen.length >= maxPages || used + p.text.length > budget) continue;
    chosen.push(p);
    used += p.text.length;
  }
  const order = (p: GuidelinePage) => docs.findIndex((d) => d.title === p.title) * 100_000 + p.page;
  return chosen.sort((a, b) => order(a) - order(b)).map(({ title, page, text }) => ({ title, page, text }));
}

export function renderGuidelinePages(pages: GuidelinePage[]): string {
  return pages.map((p) => `[${p.title}, page ${p.page}]\n${p.text}`).join('\n\n');
}

// ── What the copy couldn't satisfy ───────────────────────────────────────────

export interface CoopUnmet {
  requirement: string;
  document: string;
  page: number;
  quote: string;
}

/**
 * The copywriter's unmet co-op requirements as notes for the proofer. The
 * quote is checked against the stored page text: a verified one is cited at
 * the page it was found on; one that can't be found keeps its note, marked so nobody relies on a
 * page reference the document doesn't support.
 */
export function coopNotes(items: CoopUnmet[], docs: GuidelineDoc[]): string[] {
  const corpora = new Map(docs.map((d) => [d.title, prepareQuoteCorpus(d.pages)]));
  return items
    .filter((i) => i.requirement.trim())
    .map((i) => {
      const corpus = corpora.get(i.document);
      const check = corpus && i.quote.trim() ? verifyQuoteIn(corpus, i.page, i.quote) : null;
      // Cite the page the words are actually on, which isn't always the one stated.
      return check?.ok
        ? `Co-op (${i.document}, p. ${check.at.page}): ${i.requirement.trim()} — "${i.quote.trim()}"`
        : `Co-op (${i.document || 'guidelines'}): ${i.requirement.trim()} (Loomi couldn't find the quoted words on p. ${i.page}; check the document before relying on this.)`;
    });
}

// ── Loading ──────────────────────────────────────────────────────────────────

/** The make's documents with their page text. Empty when it has none, or none with text. */
export async function loadGuidelineDocs(make: string): Promise<GuidelineDoc[]> {
  const rows = await prisma.adGuidelineDoc.findMany({
    where: { pageText: { not: null } },
    select: { make: true, title: true, pageText: true },
    orderBy: { title: 'asc' },
  });
  return documentsFor(make, rows).flatMap((r) => {
    try {
      const pages = JSON.parse(r.pageText ?? '[]') as unknown;
      return Array.isArray(pages) && pages.length ? [{ title: r.title, pages: pages.map(String) }] : [];
    } catch {
      return [];
    }
  });
}
