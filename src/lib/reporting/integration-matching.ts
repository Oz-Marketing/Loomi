/**
 * Name/address matching used to PROPOSE GA4 properties and Google listings for
 * a sub-account. Pure, so the confidence rules can be tested without a network.
 *
 * These rules decide whether a proposed id gets applied automatically or waits
 * for a human, which makes them the safety-critical part of
 * scripts/map-reporting-integrations.ts. A dealer group is the adversarial case
 * by construction: several rooftops of the same brand, near-identical names,
 * plus separate service and parts listings for each. Being "first by relevance"
 * is not the same as being right, so confidence here means CLEARLY AHEAD of the
 * alternatives, not merely top.
 */

/** Lowercase, strip punctuation, and drop the words every dealership shares. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(
      /\b(the|inc|llc|ltd|co|company|auto|automotive|motors|dealership|ga4|analytics|ua|web|website|property)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token overlap, 0..1. Crude on purpose — it ranks; a human confirms. */
export function similarity(a: string, b: string): number {
  const A = new Set(normalize(a).split(' ').filter(Boolean));
  const B = new Set(normalize(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared += 1;
  return shared / Math.max(A.size, B.size);
}

/**
 * Auto-apply a GA4 property only when it is both a good match AND clearly
 * ahead of the next one. "Young Chevrolet" and "Young Chevrolet — Service"
 * score alike; picking either at random is worse than asking.
 */
export function ga4Confident(topScore: number, runnerUpScore: number | null): boolean {
  if (topScore < 0.6) return false;
  if (runnerUpScore === null) return true;
  return topScore - runnerUpScore >= 0.2;
}

/**
 * Auto-apply a listing only with the street number agreeing, the listing open,
 * and no close runner-up. Address is the tie-breaker name similarity cannot be:
 * two rooftops of one brand share a name but never a street.
 */
export function placeConfident(args: {
  nameScore: number;
  addressMatches: boolean;
  businessStatus: string;
  hasCloseRunnerUp: boolean;
}): boolean {
  return (
    args.nameScore >= 0.6 &&
    args.addressMatches &&
    args.businessStatus === 'OPERATIONAL' &&
    !args.hasCloseRunnerUp
  );
}

/**
 * Split one CSV line into cells, honouring quotes and doubled-quote escapes.
 *
 * Hand-rolled because the regex it replaces was silently wrong. It matched
 * /("([^"]|"")*"|[^,]*)/g and kept every other result, which assumes real cells
 * and zero-width matches alternate perfectly. A single EMPTY cell breaks that
 * assumption and shifts every field after it:
 *
 *     "key,,12345,,"  ->  ["key", "", "", ""]      // the id disappeared
 *
 * The importer then found no property id and skipped the row, reporting
 * "0 account(s) updated" for a file that looked correct. A partly-filled export
 * is the NORMAL case here — you fill in what you know and leave the rest — so
 * empty cells have to survive the round trip.
 */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        // "" inside a quoted cell is a literal quote.
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell);

  return cells.map((c) => c.trim());
}
