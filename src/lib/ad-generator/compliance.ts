import type { AdData } from './types';
import type { OfferType } from './offer-text';

/**
 * Offer compliance — which fields must be filled before an ad can be exported.
 * Port of Oz Dealer Tools' OemOfferRuleModel: a per-make required-field rule is
 * UNIONED with a code-defined baseline (the values an offer intrinsically needs
 * to render). Pure + testable; the generator blocks export while any are empty.
 */

/** Baseline required fields per offer type — always required, any make. */
export const BASELINE_REQUIRED: Record<OfferType, string[]> = {
  lease: ['monthlyPayment', 'leaseTerm'],
  apr: ['aprRate', 'aprTerm'],
  discount: ['discountAmount'],
  sales_price: ['salePrice'],
  custom: [],
};

/** Human labels for field keys, for the "missing required" message. */
export const FIELD_LABELS: Record<string, string> = {
  vehicleName: 'Vehicle',
  offerLabel: 'Offer label',
  monthlyPayment: 'Monthly payment',
  leaseTerm: 'Lease term',
  dueAtSigning: 'Due at signing',
  aprRate: 'APR rate',
  aprTerm: 'APR term',
  financialInstitution: 'Financial institution',
  discountAmount: 'Discount amount',
  discountSource: 'Discount source',
  salePrice: 'Sale price',
  msrp: 'MSRP',
  expiration: 'Expiration',
  vin: 'VIN',
  stockNumber: 'Stock #',
  disclaimer: 'Disclaimer',
};

export interface OemOfferRule {
  make: string;
  /** offer type → required field keys (FieldSpec keys, camelCase). */
  requiredFields: Record<string, string[]>;
}

/** Parse a rule row's `requiredFields` JSON into a typed map (defensive). */
export function parseOemRule(make: string, requiredFieldsJson: string): OemOfferRule | null {
  try {
    const parsed = JSON.parse(requiredFieldsJson) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const requiredFields: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(v)) requiredFields[k] = v.filter((x): x is string => typeof x === 'string');
    }
    return { make, requiredFields };
  } catch {
    return null;
  }
}

/** Required field keys for an offer type: baseline ∪ the OEM rule's list. */
export function requiredFieldsFor(offerType: string, rule?: OemOfferRule | null): string[] {
  const baseline = BASELINE_REQUIRED[offerType as OfferType] ?? [];
  const oem = rule?.requiredFields?.[offerType] ?? [];
  return Array.from(new Set([...baseline, ...oem]));
}

/** Required fields that are still empty in `data` (with display labels). */
export function missingRequired(
  data: AdData,
  rule?: OemOfferRule | null,
): { key: string; label: string }[] {
  return requiredFieldsFor(data.offerType || 'custom', rule)
    .filter((k) => !(data[k] && String(data[k]).trim() !== ''))
    .map((k) => ({ key: k, label: FIELD_LABELS[k] ?? k }));
}
