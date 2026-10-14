import { extractClaims, type Claim, type DateClaim, type NumberClaim } from './compliance/facts';
import { collapseWhitespace } from './compliance/html';
import type { ProjectRequest } from './monday-board';
import type { CreativeReading } from './reading';
import type { FieldKey } from './extraction';

/**
 * Where the creative and the written request disagree (docs/email-drafting.md
 * §4, stage 4). Hard rule 1: report both values and stop; never choose.
 *
 * A term is compared only when BOTH sides state it. The creative says it in a
 * field (`apr: "1.9% APR"`); the request says it in prose, so a request value
 * counts for a term when it sits in a clause naming that term ("1.9% APR for 72
 * months", "Offer ends 10/31"). The request disagrees when it states the term
 * and none of its values for it is the creative's — "1.9%" against a request
 * that only ever says "2.9% APR" stops the draft; a request that mentions both
 * a lease and a finance payment doesn't stop a creative showing one of them.
 *
 * The disclaimer is compared by what it asserts: a number or date in one that
 * the other lacks is a conflict. Wording alone isn't — the request's disclaimer
 * field is often a note to design or an older draft, and the creative's text
 * is the one carried verbatim — so a wording difference becomes a note.
 *
 * Pure.
 */

export interface DraftConflict {
  /** A field key, or `disclaimer`. */
  field: string;
  label: string;
  creative: string;
  request: string;
}

interface TermRule {
  key: FieldKey;
  label: string;
  /** Which claims the term is made of. */
  unit: '$' | '%' | 'bare' | 'date';
  /** The words that make a request clause about this term. */
  cue: RegExp;
}

const TERMS: TermRule[] = [
  { key: 'apr', label: 'APR', unit: '%', cue: /\bapr\b|\brate\b|financ/i },
  { key: 'term', label: 'Term', unit: 'bare', cue: /\b(?:mo|mos|months?)\b/i },
  { key: 'payment', label: 'Payment', unit: '$', cue: /\/\s?mo\b|per month|a month|monthly|payment|\blease\b/i },
  { key: 'dueAtSigning', label: 'Due at signing', unit: '$', cue: /due at signing|at signing|\bdown\b/i },
  { key: 'msrp', label: 'MSRP', unit: '$', cue: /\bmsrp\b/i },
  { key: 'savings', label: 'Savings', unit: '$', cue: /\boff\b|\bsave\b|savings|discount/i },
  { key: 'rebate', label: 'Rebate / cash back', unit: '$', cue: /rebate|cash back|bonus cash|cash allowance/i },
  { key: 'expiration', label: 'Offer ends', unit: 'date', cue: /expir|\bends?\b|through|\bthru\b|\bby\b|until|valid|good/i },
];

/** Clauses of request prose: lines, list items, sentences. */
function clauses(text: string): string[] {
  return text
    .split(/\r?\n|[;•|]|\.(?=\s|$)/)
    .map((c) => c.trim())
    .filter(Boolean);
}

function ofUnit(claims: Claim[], unit: TermRule['unit']): Claim[] {
  return claims.filter((c) =>
    unit === 'date'
      ? c.kind === 'date'
      : c.kind === 'number' && (unit === 'bare' ? c.unit === null : c.unit === unit),
  );
}

function same(a: Claim, b: Claim): boolean {
  if (a.kind === 'date' && b.kind === 'date') {
    return a.month === b.month && a.day === b.day && (a.year === null || b.year === null || a.year === b.year);
  }
  if (a.kind === 'number' && b.kind === 'number') return Math.abs(a.value - b.value) < 0.005 && a.unit === b.unit;
  return false;
}

/** "Term" values are months, so "2026" or "3" in a clause that says "months" isn't one. */
function plausible(rule: TermRule, c: Claim): boolean {
  if (rule.key !== 'term' || c.kind !== 'number') return true;
  return c.value >= 12 && c.value <= 96;
}

/** The claims of `unit` in every request clause that cues this term. */
function requestValues(rule: TermRule, texts: string[]): Claim[] {
  const out: Claim[] = [];
  for (const text of texts) {
    for (const clause of clauses(text)) {
      if (!rule.cue.test(clause)) continue;
      out.push(...ofUnit(extractClaims(clause), rule.unit).filter((c) => plausible(rule, c)));
    }
  }
  return out;
}

function show(c: Claim): string {
  return c.raw;
}

function claimKey(c: Claim): string {
  return c.kind === 'date'
    ? `d:${(c as DateClaim).month}/${(c as DateClaim).day}`
    : `n:${(c as NumberClaim).unit ?? ''}${(c as NumberClaim).value}`;
}

/** Numbers of 10 or more, money, rates and dates — what a disclaimer actually asserts. */
function assertions(text: string): Claim[] {
  return extractClaims(text).filter((c) => c.kind === 'date' || c.unit !== null || c.value >= 10);
}

export interface ConflictCheck {
  conflicts: DraftConflict[];
  /** Differences that don't stop the draft but a proofer should know about. */
  notes: string[];
}

export function findConflicts(
  reading: CreativeReading,
  request: Pick<ProjectRequest, 'details' | 'offerDisclaimer'> | null,
): ConflictCheck {
  const conflicts: DraftConflict[] = [];
  const notes: string[] = [];
  const requestTexts = [request?.details ?? '', request?.offerDisclaimer ?? ''].filter((t) => t.trim());
  if (requestTexts.length === 0) return { conflicts, notes };

  for (const rule of TERMS) {
    const field = reading.fields.find((f) => f.key === rule.key);
    if (!field) continue;
    const creative = ofUnit(extractClaims(field.value), rule.unit).filter((c) => plausible(rule, c));
    if (creative.length === 0) continue;
    const stated = requestValues(rule, requestTexts);
    if (stated.length === 0) continue;
    const missing = creative.filter((c) => !stated.some((s) => same(c, s)));
    if (missing.length === 0) continue;
    const unique = [...new Map(stated.map((s) => [claimKey(s), s])).values()];
    conflicts.push({
      field: rule.key,
      label: rule.label,
      creative: field.value,
      request: unique.map(show).join(', '),
    });
  }

  const theirs = request?.offerDisclaimer?.trim();
  const ours = reading.disclaimer?.text;
  if (theirs && ours && collapseWhitespace(theirs) !== collapseWhitespace(ours)) {
    const a = assertions(ours);
    const b = assertions(theirs);
    const onlyCreative = a.filter((x) => !b.some((y) => same(x, y)));
    const onlyRequest = b.filter((y) => !a.some((x) => same(x, y)));
    if (onlyCreative.length || onlyRequest.length) {
      conflicts.push({
        field: 'disclaimer',
        label: 'Disclaimer',
        creative: ours,
        request: theirs,
      });
    } else {
      notes.push(
        "The request's Offer Disclaimer is worded differently from the creative's. The figures agree, and the creative's text is the one in the email, word for word.",
      );
    }
  }
  return { conflicts, notes };
}
