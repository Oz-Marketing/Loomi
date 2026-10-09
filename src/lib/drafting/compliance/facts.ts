import { MAJOR_US_OEMS, POWERSPORTS_BRANDS } from '@/lib/oems';

/**
 * Claims — the numbers, dates and makes a piece of copy asserts — and whether a
 * set of trusted sources supports them.
 *
 * House rule 1: generated copy may not state any offer term, price, rate, date
 * or claim that isn't in the extracted creative or the written request. This is
 * the deterministic half of that rule. It can't judge prose, but numbers, dates
 * and makes are exactly where a model invents things, and exactly where the
 * 2026-09 Young Mazda of Missoula blast went wrong: a CX-90 email that went to
 * 1,067 people under a subject about "$10,000 off the new Jeep Gladiator".
 *
 * Mirrors the ad engine's numeric-provenance check (automation/generate-copy.ts)
 * and goes further in two places email needs: units ("$10" is not "10%") and
 * dates ("Oct 31" is the same claim as "10/31/2026").
 *
 * Pure.
 */

export type Unit = '$' | '%' | null;

export interface NumberClaim {
  kind: 'number';
  raw: string;
  value: number;
  unit: Unit;
}

export interface DateClaim {
  kind: 'date';
  raw: string;
  month: number;
  day: number;
  /** Four digits when the text gave a year, else null. */
  year: number | null;
}

export type Claim = NumberClaim | DateClaim;

const MONTH_WORDS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const MONTH_ALTERNATION = Object.keys(MONTH_WORDS).sort((a, b) => b.length - a.length).join('|');

function fullYear(y: string | undefined): number | null {
  if (!y) return null;
  const n = parseInt(y, 10);
  return y.length === 2 ? 2000 + n : n;
}

function validDate(month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/**
 * Every claim in `text`. Dates are read first and blanked out, so the digits of
 * "10/31/2026" don't also count as three loose numbers.
 */
export function extractClaims(text: string): Claim[] {
  const claims: Claim[] = [];
  let rest = text;
  const blank = (m: RegExpMatchArray) => {
    const start = m.index ?? 0;
    rest = rest.slice(0, start) + ' '.repeat(m[0].length) + rest.slice(start + m[0].length);
  };

  // 2026-10-31 — monday's own date format, common in request text.
  for (const m of [...rest.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)]) {
    const [month, day] = [+m[2], +m[3]];
    if (!validDate(month, day)) continue;
    claims.push({ kind: 'date', raw: m[0], month, day, year: +m[1] });
    blank(m);
  }
  // 10/31, 10/31/26, 10/31/2026
  for (const m of [...rest.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/g)]) {
    const [month, day] = [+m[1], +m[2]];
    if (!validDate(month, day)) continue;
    claims.push({ kind: 'date', raw: m[0], month, day, year: fullYear(m[3]) });
    blank(m);
  }
  // Oct 31, Oct. 31st, October 31, 2026
  const named = new RegExp(
    `\\b(${MONTH_ALTERNATION})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`,
    'gi',
  );
  for (const m of [...rest.matchAll(named)]) {
    const month = MONTH_WORDS[m[1].toLowerCase()];
    const day = +m[2];
    if (!validDate(month, day)) continue;
    claims.push({ kind: 'date', raw: m[0], month, day, year: fullYear(m[3]) });
    blank(m);
  }

  // Numbers: $10,000  1.9%  $229/mo  10K  2026  CX-90 (→ 90)
  for (const m of rest.matchAll(/(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\s?[kK]\b)?(\s?%|\s?percent\b)?/g)) {
    const digits = m[2].replace(/,/g, '') + (m[3] ?? '');
    let value = parseFloat(digits);
    if (m[4]) value *= 1000;
    const unit: Unit = m[1] ? '$' : m[5] ? '%' : null;
    claims.push({ kind: 'number', raw: m[0].trim(), value, unit });
  }
  return claims;
}

/**
 * A bare single digit asserts nothing on its own — "3 rows of seating", the 2
 * in "ZR2" — and treating it as a claim would reject most sentences. Anything
 * with a unit is checked whatever its size: "0% APR" is the whole offer.
 */
export function isExempt(claim: Claim): boolean {
  return claim.kind === 'number' && claim.unit === null && Number.isInteger(claim.value) && claim.value < 10;
}

export interface FactIndex {
  /**
   * `unit: 'date'` marks a part of a date ("31" from 10/31/2026). It can vouch
   * for a bare number — "through the 31st", "2026 models" — but never for money
   * or a rate: the month of an expiry date is not evidence of "$10 off".
   */
  numbers: { value: number; unit: Unit | 'date' }[];
  dates: DateClaim[];
}

/** Everything the trusted sources assert, ready to check claims against. */
export function indexFacts(texts: string[]): FactIndex {
  const index: FactIndex = { numbers: [], dates: [] };
  for (const text of texts) {
    for (const claim of extractClaims(text)) {
      if (claim.kind === 'date') {
        index.dates.push(claim);
        index.numbers.push({ value: claim.day, unit: 'date' }, { value: claim.month, unit: 'date' });
        if (claim.year !== null) index.numbers.push({ value: claim.year, unit: 'date' });
      } else {
        index.numbers.push({ value: claim.value, unit: claim.unit });
      }
    }
  }
  return index;
}

/** Half a cent — "$229" and "$229.00" are the same claim. */
const EPSILON = 0.005;

/**
 * Money and rates must be matched in kind: "$3,500" needs a "$3,500" in the
 * sources, and "1.9%" a "1.9%". A bare number ("72 months", "2026", the 90 of
 * "CX-90") may be vouched for by any source number of the same value.
 */
export function isSupported(claim: Claim, facts: FactIndex): boolean {
  if (claim.kind === 'date') {
    return facts.dates.some(
      (f) =>
        f.month === claim.month
        && f.day === claim.day
        && (claim.year === null || f.year === null || f.year === claim.year),
    );
  }
  return facts.numbers.some(
    (f) => Math.abs(f.value - claim.value) < EPSILON && (claim.unit === null || f.unit === claim.unit),
  );
}

// ── Makes ────────────────────────────────────────────────────────────────────

/** Trade names copy uses for a make, beyond its canonical spelling. */
const MAKE_ALIASES: Record<string, string> = {
  Chevy: 'Chevrolet',
  VW: 'Volkswagen',
  Mercedes: 'Mercedes-Benz',
  Harley: 'Harley-Davidson',
};

/**
 * Brand names as they appear in copy, matched CASE-SENSITIVELY (plus an
 * all-caps form) on word boundaries. Case-sensitive on purpose: "ram", "ford",
 * "genesis" and "triumph" are ordinary words, and the brand is the capitalized one.
 * "Honda Powersports" is listed as plain "Honda" — copy says "Honda Pioneer".
 */
const MAKE_SPELLINGS: { spelling: string; make: string }[] = (() => {
  const canonical = [...MAJOR_US_OEMS, ...POWERSPORTS_BRANDS]
    .map((m) => (m === 'Honda Powersports' ? 'Honda' : m))
    .filter((m, i, all) => all.indexOf(m) === i);
  const list: { spelling: string; make: string }[] = [];
  for (const make of canonical) {
    list.push({ spelling: make, make });
    if (make.toUpperCase() !== make) list.push({ spelling: make.toUpperCase(), make });
  }
  for (const [spelling, make] of Object.entries(MAKE_ALIASES)) list.push({ spelling, make });
  // Longest first, so "Land Rover" wins over a shorter overlapping name.
  return list.sort((a, b) => b.spelling.length - a.spelling.length);
})();

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MAKE_RES = MAKE_SPELLINGS.map(({ spelling, make }) => ({
  make,
  re: new RegExp(`(?<![\\w-])${escapeRe(spelling)}(?![\\w-])`, 'g'),
}));

/** Canonical makes `text` names, each once. */
export function makesMentioned(text: string): string[] {
  const found = new Set<string>();
  for (const { make, re } of MAKE_RES) {
    re.lastIndex = 0;
    if (re.test(text)) found.add(make);
  }
  return [...found];
}

/**
 * May this draft name `make`? Yes when the dealer sells it — "Honda" is fine
 * for a "Honda Powersports" store — or when a trusted source names it, which is
 * how a conquest email aimed at Toyota owners gets to say "Toyota".
 */
export function makeIsSupported(make: string, dealerOems: string[], factTexts: string[]): boolean {
  const lower = make.toLowerCase();
  if (dealerOems.some((o) => o.toLowerCase() === lower || o.toLowerCase().startsWith(`${lower} `))) {
    return true;
  }
  return factTexts.some((t) => makesMentioned(t).includes(make));
}
