/**
 * What a VIN looks like in printed copy, for a co-op rule that has to find one.
 *
 * Subaru (SAF §6a) wants at least the last eight characters of a valid VIN on
 * every offer ad, and the disclaimer is where Loomi prints it. A token counts
 * when it is:
 *
 *   - 8 characters (the tail) or 17 (the whole VIN), nothing in between;
 *   - drawn from the VIN alphabet: digits and capitals, never I, O or Q;
 *   - at least five digits, because the serial fills positions 12–17 and its
 *     last five are always numeric on a car or light truck.
 *
 * THE DIGITS, NOT THE CASE, ARE WHAT KEEP WORDS OUT. `matcher()` compiles every
 * rule pattern with the `i` flag, so as a rule this also accepts the same
 * letters in lowercase — harmless, since no word carries five digits. The rule
 * was first transcribed as `[A-Z0-9]{8}`, which leaned on a case-sensitivity it
 * never had: any eight-letter word ("Advertis…") satisfied it, and a Subaru ad
 * with no VIN passed.
 *
 * Shape only: the check digit isn't verified, and a stock number that happens
 * to be VIN-shaped passes too.
 *
 * A pattern SOURCE rather than a RegExp, because co-op packs store patterns as
 * strings. Compile it without `i` where case matters.
 */
const VIN_CHAR = '[A-HJ-NPR-Z0-9]';

export const VIN_TAIL_PATTERN = `\\b(?=${`${VIN_CHAR}*\\d`.repeat(5)})(?:${VIN_CHAR}{17}|${VIN_CHAR}{8})\\b`;
