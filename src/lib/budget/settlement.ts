/**
 * Settlement math — how a month's actual platform spend is attributed back to
 * the budget lines that funded it.
 *
 * Pure (no prisma, no React) so the arithmetic is unit testable. The service
 * layer owns fetching and writing; this owns the only part that can silently
 * lose money.
 *
 * The attribution problem: a month has N budget lines on a platform (a Managed
 * Marketing Service line, two ticket add-ons) and M pacer ad rows, with no
 * one-to-one mapping between them. The pacer does know actual spend per BUCKET
 * (base vs added, via each ad's budgetSource), so settlement splits by bucket
 * first and then distributes each bucket's actual across its own lines in
 * proportion to what they were targeting.
 */

export interface SettlementShare {
  id: string;
  /** Actual spend dollars attributed to this line. */
  actual: number;
}

export interface DistributableLine {
  id: string;
  /** amount × markupSnapshot — the line's share of the month in spend dollars. */
  spendTarget: number;
}

/**
 * Split `total` across `lines` in proportion to spendTarget, in whole cents,
 * such that the parts sum EXACTLY to the total.
 *
 * Uses largest-remainder: floor every share to a cent, then hand the leftover
 * cents out one at a time to the lines with the biggest truncated fraction.
 * Naive rounding would leave the month a few cents off, and a settlement report
 * that doesn't reconcile to the penny is one nobody trusts.
 *
 * Degenerate cases, both real:
 *   - every target is 0 (lines exist but were never funded) → split evenly,
 *     because proportional is undefined and dropping the spend would hide it.
 *   - no lines → returns empty; the caller decides what to do with orphan spend.
 */
export function distributeActual(
  lines: DistributableLine[],
  total: number,
): SettlementShare[] {
  if (lines.length === 0) return [];
  if (!Number.isFinite(total) || total <= 0) {
    return lines.map((l) => ({ id: l.id, actual: 0 }));
  }

  // Work in cents so the remainder logic is exact integer arithmetic.
  const totalCents = Math.round(total * 100);
  const weights = lines.map((l) => (Number.isFinite(l.spendTarget) && l.spendTarget > 0 ? l.spendTarget : 0));
  const weightSum = weights.reduce((a, b) => a + b, 0);

  // No line had a target — even split rather than losing the spend entirely.
  const effective = weightSum > 0 ? weights : lines.map(() => 1);
  const effectiveSum = weightSum > 0 ? weightSum : lines.length;

  const exact = effective.map((w) => (w / effectiveSum) * totalCents);
  const floored = exact.map((c) => Math.floor(c));
  let remaining = totalCents - floored.reduce((a, b) => a + b, 0);

  // Hand out the leftover cents to the largest fractional parts first. Ties
  // break by index, so the same input always produces the same output.
  const order = exact
    .map((c, i) => ({ i, frac: c - Math.floor(c) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const cents = [...floored];
  for (const { i } of order) {
    if (remaining <= 0) break;
    cents[i]! += 1;
    remaining -= 1;
  }

  return lines.map((l, i) => ({ id: l.id, actual: cents[i]! / 100 }));
}

/**
 * Variance in spend dollars: positive = overspent the target, negative = under.
 * Named rather than inlined because the sign convention is easy to flip and
 * every surface has to agree on it.
 */
export function variance(actual: number, spendTarget: number): number {
  return actual - spendTarget;
}

/** Actual as a share of target, or null when there was nothing to hit. */
export function attainment(actual: number, spendTarget: number): number | null {
  if (!Number.isFinite(spendTarget) || spendTarget <= 0) return null;
  return actual / spendTarget;
}
