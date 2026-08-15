import type { AdData } from './types';
import { deriveOfferFigures, type DerivedFigure } from './disclaimer';
import { FIELD_LABELS } from './compliance';

/**
 * The custom-offer handoff — what a person needs to SEE before a disclaimer they
 * are legally responsible for goes out, and what they need to CARRY to the board
 * that tracks the offer.
 *
 * Two jobs, both deliberately dumb:
 *
 *  1. Show the arithmetic. The disclaimer states figures nobody typed — the
 *     payments total, the lease's total mileage. Printing the result alone asks
 *     the reader to trust it; printing "$389 × 36 mo" lets them check it in a
 *     second. The values come from `deriveOfferFigures`, the same function the
 *     disclaimer uses, so the panel cannot drift from the legal text.
 *
 *  2. Hand off to Monday. Loomi has no Monday integration and is due to replace
 *     it, so this produces TEXT to copy, not an API call. It disappears cleanly
 *     when Monday does — see docs/custom-offer-disclaimer-builder.md §7.
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
  // Payments total first: it's the number a reader is most likely to check, and
  // the one that was silently wrong in the seeded VW template.
  const order = ['monthly_payments_total', 'total_miles'];
  return order.map((k) => figures[k]).filter((f): f is CalculatedRow => f != null);
}

/** One field of the Monday handoff. */
export interface BoardValue {
  label: string;
  value: string;
}

export interface BoardValueInput {
  data: AdData;
  /** The composed disclaimer, exactly as it will appear on the creative. */
  disclaimer: string;
  /** Required fields still empty — from `missingRequired`. Drives "Needs review". */
  missingFields?: { key: string; label: string }[];
}

/**
 * Build the values for the Monthly Offer board.
 *
 * Every value here is something Loomi actually knows. The mock this replaces
 * also emitted a "Co-Op Status" column, decided by a language model from prose
 * guidelines — that column is deliberately absent. Co-op standing is held per
 * TEMPLATE in the approval record, not per offer, and a status invented here
 * would be a guess wearing the costume of a system of record.
 */
export function boardValues({ data, disclaimer, missingFields = [] }: BoardValueInput): BoardValue[] {
  const rows: BoardValue[] = [];
  const push = (label: string, value: string | undefined | null) => {
    const v = (value ?? '').toString().trim();
    if (v) rows.push({ label, value: v });
  };

  push('Vehicle', data.vehicleName);
  push('Offer type', OFFER_TYPE_LABELS[data.offerType ?? ''] ?? data.offerType);
  push('Expiration date', data.expiration);
  push('VIN', data.vin ? data.vin.trim().toUpperCase() : '');
  push('Stock #', data.stockNumber);
  push('MSRP', data.msrp ? formatIfBare(data.msrp) : '');
  push('Dealer code', data.dealerCode);
  push('States', data.states);
  push('Disclaimer', disclaimer);

  // Last, and always present — its absence would read as "no problems found"
  // rather than "nobody checked".
  rows.push({
    label: 'Needs review',
    value: missingFields.length
      ? `Yes — missing ${missingFields.map((m) => m.label || FIELD_LABELS[m.key] || m.key).join(', ')}`
      : 'No',
  });
  return rows;
}

const OFFER_TYPE_LABELS: Record<string, string> = {
  lease: 'Lease',
  apr: 'APR Financing',
  discount: 'Discount / Cash Back',
  sales_price: 'Sales Price',
  custom: 'Custom',
};

/** Add a `$` to a bare number so the board reads like money. Leaves any value
 *  the user already formatted (or wrote as a range) exactly as typed. */
function formatIfBare(v: string): string {
  const t = v.trim();
  if (!/^[0-9][0-9,]*(\.[0-9]+)?$/.test(t)) return t;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : t;
}

/** The whole handoff as one clipboard payload — `Label: value` per line. */
export function boardValuesText(rows: BoardValue[]): string {
  return rows.map((r) => `${r.label}: ${r.value}`).join('\n');
}
