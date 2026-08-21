import type { AdData } from './types';
import { ALL_OFFER_TYPE_SPECS } from './offer-text';
import { OFFER_KINDS } from './offer-kinds';

/**
 * Offer compliance — which fields must be filled before an ad can be exported.
 * Port of Oz Dealer Tools' OemOfferRuleModel: a per-make required-field rule is
 * UNIONED with a code-defined baseline (the values an offer intrinsically needs
 * to render). Pure + testable; the generator blocks export while any are empty.
 */

/**
 * Baseline required fields per offer type — always required, any make.
 *
 * DERIVED from the offer type specs (`OfferTypeSpec.required`) rather than
 * hand-maintained, so each kind's types carry their own requirements and a new
 * kind can't be added with its baseline silently empty. Keyed by offer type
 * value across every kind, which is sound because those values are unique.
 *
 * An unlisted type (or one with no `required`) resolves to `[]` — nothing
 * intrinsically required, which is right for a free-text offer.
 */
export const BASELINE_REQUIRED: Record<string, string[]> = Object.fromEntries(
  ALL_OFFER_TYPE_SPECS.map((t) => [t.value, t.required ?? []]),
);

/**
 * Short display labels for field keys — the "missing required" message and the
 * OEM rules editor's chips.
 *
 * Two layers, and the order matters:
 *
 *  1. DERIVED from every registered kind's field schema, so a service or general
 *     field gets its real label. The hand map below covered vehicle fields only,
 *     and every reader falls back to the raw key — so a gap was invisible until a
 *     form showed a dealer "servicePrice".
 *  2. The hand-written SHORT forms on top, because these read in a sentence
 *     ("Required before export for Subaru: …") where a spec label carrying its
 *     input unit does not: "Lease term", not "Lease term (months)".
 *
 * A key declared by several kinds takes the first kind's label (registry order),
 * which is what keeps the shared `expiration` / `disclaimer` consistent.
 */
const DERIVED_FIELD_LABELS: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const kind of OFFER_KINDS) {
    for (const f of kind.fields) {
      if (!(f.key in out) && f.label) out[f.key] = f.label;
    }
  }
  return out;
})();

export const FIELD_LABELS: Record<string, string> = {
  ...DERIVED_FIELD_LABELS,
  vehicleName: 'Vehicle',
  offerLabel: 'Offer label',
  monthlyPayment: 'Monthly payment',
  leaseTerm: 'Lease term',
  dueAtSigning: 'Due at signing',
  securityDeposit: 'Security deposit',
  aprRate: 'APR rate',
  aprTerm: 'APR term',
  financialInstitution: 'Financial institution',
  costPerThousand: 'Cost per $1,000 financed',
  discountAmount: 'Discount amount',
  discountSource: 'Discount source',
  salePrice: 'Sale price',
  msrp: 'MSRP',
  expiration: 'Expiration',
  vin: 'VIN',
  stockNumber: 'Stock #',
  disclaimer: 'Disclaimer',
  // Custom-offer short forms, same reason as the vehicle ones above.
  offerName: 'What’s on offer',
  offerPrice: 'Price',
  regularPrice: 'Regular price',
  percentOff: 'Percent off',
  dollarOff: 'Dollars off',
  minimumSpend: 'Minimum spend',
};

export interface OemOfferRule {
  make: string;
  /** offer type → required field keys (FieldSpec keys, camelCase). */
  requiredFields: Record<string, string[]>;
  /**
   * offer type → { field: value } for disclosures the offer feed never carries.
   *
   * These are HUMAN ASSERTIONS about the programme, not values derived from the
   * offer, which is why applying one is recorded on the draft. See
   * `AdOemOfferRule.defaultValues`.
   */
  defaultValues?: Record<string, Record<string, string>>;
}

/** Parse a rule row's `requiredFields` (+ optional `defaultValues`) JSON. */
export function parseOemRule(
  make: string,
  requiredFieldsJson: string,
  defaultValuesJson?: string | null,
): OemOfferRule | null {
  try {
    const parsed = JSON.parse(requiredFieldsJson) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const requiredFields: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(v)) requiredFields[k] = v.filter((x): x is string => typeof x === 'string');
    }
    return { make, requiredFields, defaultValues: parseOemDefaults(defaultValuesJson) };
  } catch {
    return null;
  }
}

/** Parse `defaultValues` defensively — a malformed blob means "no defaults",
 *  never a thrown error mid-generation. */
export function parseOemDefaults(json?: string | null): Record<string, Record<string, string>> | undefined {
  if (!json?.trim()) return undefined;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object') return undefined;
    const out: Record<string, Record<string, string>> = {};
    for (const [offerType, fields] of Object.entries(parsed as Record<string, unknown>)) {
      if (!fields || typeof fields !== 'object') continue;
      const inner: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
        // Only non-empty strings: a blank default would "satisfy" a required field
        // with nothing, which is worse than leaving the ad blocked.
        if (typeof v === 'string' && v.trim()) inner[k] = v.trim();
      }
      if (Object.keys(inner).length) out[offerType] = inner;
    }
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fill required fields the offer didn't carry from the make's standing defaults.
 *
 * Only fills what is BOTH required for this offer type and currently empty, so a
 * default can never override a real value from the manufacturer's offer. Returns
 * the applied entries so the caller can record them on the draft — an approver has
 * to be able to tell an asserted value from a derived one.
 */
export function applyOemDefaults(
  data: AdData,
  rule?: OemOfferRule | null,
): { data: AdData; applied: { key: string; label: string; value: string }[] } {
  const offerType = data.offerType || 'custom';
  const defaults = rule?.defaultValues?.[offerType];
  if (!defaults) return { data, applied: [] };

  const required = new Set(requiredFieldsFor(offerType, rule));
  const next = { ...data };
  const applied: { key: string; label: string; value: string }[] = [];
  for (const [key, value] of Object.entries(defaults)) {
    if (!required.has(key)) continue;
    if (next[key] && String(next[key]).trim() !== '') continue;
    next[key] = value;
    applied.push({ key, label: FIELD_LABELS[key] ?? key, value });
  }
  return { data: next, applied };
}

/** Required field keys for an offer type: baseline ∪ the OEM rule's list. */
export function requiredFieldsFor(offerType: string, rule?: OemOfferRule | null): string[] {
  const baseline = BASELINE_REQUIRED[offerType] ?? [];
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
