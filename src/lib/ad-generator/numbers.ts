/**
 * The one way an offer figure becomes a Number.
 *
 * Shared deliberately. The disclaimer engine states a figure and the co-op rules
 * decide whether that figure is permitted — if the two parsed "$3,999" even
 * slightly differently, a rule could block an ad over a value the disclaimer
 * renders perfectly well, and the disagreement would be invisible to whoever got
 * blocked.
 *
 * (`offer-text.ts` keeps its own parser: it strips the minus sign so a negative
 * can't reach the canvas, which is a display concern rather than a numeric one.)
 */

/**
 * Parse a user-entered figure to a Number.
 *
 * Handles "$3,999", "1.9%", "10,000", "36", "-500". Returns null — never 0 — for
 * anything unparseable, including the preview placeholders ("X,XXX", "XX.XX")
 * the builder seeds a fresh canvas with. A placeholder coerced to 0 would read
 * as a real $0 offer to every check downstream.
 */
export function parseOfferNumber(v: string | undefined | null): number | null {
  if (v == null || String(v).trim() === '') return null;
  const cleaned = String(v).replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
