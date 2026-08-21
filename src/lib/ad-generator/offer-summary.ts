import type { AdData } from './types';
import { deriveOfferFigures, type DerivedFigure } from './disclaimer';

/**
 * The custom-offer summary — what a person needs to SEE before a disclaimer they
 * are legally responsible for goes out.
 *
 * The disclaimer states figures nobody typed: the payments total, the lease's
 * total mileage. Printing the result alone asks the reader to trust it; printing
 * "$389 × 36 mo" lets them check it in a second. The values come from
 * `deriveOfferFigures`, the same function the disclaimer uses, so the panel
 * cannot drift from the legal text.
 *
 * Pure: no DB, no network, no clock.
 */

/** One row of the "show your work" panel. */
export type CalculatedRow = DerivedFigure;

/**
 * The derived figures for this offer, in a stable display order.
 *
 * Returns only what could actually be computed. A row for a figure whose inputs
 * are missing would have to show a blank or a guess, and neither belongs in a
 * panel whose whole purpose is verifiability.
 */
export function calculatedRows(data: AdData): CalculatedRow[] {
  const figures = deriveOfferFigures(data);
  // A flat order works because the two groups are DISJOINT per offer type: a
  // lease derives payments and mileage, a service coupon derives savings. So
  // whichever group applies is the one that appears, and it appears first.
  //
  // Vehicle first within the list — the payments total is the number a reader is
  // most likely to check, and the one that was silently wrong in the seeded VW
  // template. For a service offer the savings figure plays that role: "SAVE $50"
  // over a price that does not subtract to $50 is the textbook FTC problem, and
  // this panel is where someone catches it.
  const order = ['monthly_payments_total', 'total_miles', 'savings_amount', 'savings_percent'];
  return order.map((k) => figures[k]).filter((f): f is CalculatedRow => f != null);
}
