/**
 * Disclaimer `{slug}` tokens, per offer kind.
 *
 * A LEAF module — it imports nothing. That is the point: the kind registry needs
 * these maps (a kind declares the slugs its templates may use), and
 * `disclaimer.ts` needs the registry (to pick a kind's boilerplate from the
 * offer type). Leaving the maps in `disclaimer.ts` made those two requirements a
 * cycle, so the data moved down here and both import it.
 *
 * The token engine that resolves these lives in `disclaimer.ts::buildTokenValues`.
 * A slug listed here with no case there renders as a raw `{{token}}` in a legal
 * line, so the two must be added together — `disclaimer.test.ts` asserts it.
 */

/** Mirrors ODT's SLUGS. The vehicle kind's tokens. */
export const VEHICLE_DISCLAIMER_SLUGS: Record<string, string> = {
  vehicle: 'Vehicle (e.g. 2024 Toyota Camry SE)',
  dealership_name: 'Dealership name',
  msrp: 'MSRP — formatted with thousands separators',
  monthly_payment: 'Lease / finance monthly payment — formatted',
  due_at_signing: 'Lease due-at-signing amount — formatted',
  lease_term: 'Lease term in months',
  security_deposit: 'Lease security deposit — formatted ($0 renders as "$0")',
  apr_rate: 'APR rate (e.g. 1.9)',
  apr_term: 'APR term in months',
  financial_institution: 'Finance institution (e.g. Toyota Financial)',
  cost_per_thousand: 'Cost per $1,000 financed (e.g. 4.51)',
  discount_amount: 'Discount / cash-back amount — formatted',
  discount_source: 'Source of the discount (e.g. Dealer Discount)',
  sale_price: 'Advertised sale price — formatted',
  offer_end_date: 'Offer end date as entered',
  vin: 'VIN — rendered uppercase',
  stock_number: 'Stock number',
  // ── Full-length OEM lease/finance language ────────────────────────────────
  // Manufacturer disclaimers (Audi, VW, and the brands still to be transcribed)
  // itemize the lease economics clause by clause. Without these the templates
  // can only be stored with the fees hardcoded, which is how the seeded VW row
  // ended up quoting a $699 acquisition fee at every dealer.
  selling_price: 'Selling price / capitalized cost — formatted. NOT the MSRP.',
  customer_down:
    'Customer down payment — formatted. NOT `due_at_signing`, which also includes the first payment and the acquisition fee.',
  acquisition_fee: 'Lease acquisition fee — formatted',
  disposition_fee: 'Lease-end disposition fee — formatted',
  overage_rate: 'Per-mile overage charge as entered (e.g. $0.20)',
  miles_per_year: 'Permitted miles per year — thousands-separated',
  amount_financed: 'Amount financed on an APR offer — formatted',
  states: 'States / regions the offer is valid in, as entered',
  dealer_code: 'Manufacturer-assigned dealer code',
  // Derived — computed here, never typed. A human retyping either of these is a
  // chance to get the arithmetic wrong in a legal document.
  total_miles: 'DERIVED: miles per year × (term ÷ 12) — thousands-separated',
  monthly_payments_total: 'DERIVED: monthly payment × term — formatted',
  copyright_year:
    'DERIVED: the year the disclaimer is composed, for the manufacturer copyright line (e.g. "©2026 Audi of America, Inc.")',
};

/**
 * The CUSTOM kind's tokens — service, parts and accessories.
 *
 * Deliberately does NOT re-declare the shared ones — `dealership_name`,
 * `offer_end_date` and `states` mean exactly the same thing on a service coupon
 * as on a vehicle offer, and are merged in by the kind rather than copied. A
 * second copy of a slug description is a second thing to keep true.
 *
 * Named for what they HOLD, not for one of the things they hold: `offer_price`,
 * not `service_price`, because the same token carries an oil-change price and a
 * floor-mat price.
 */
export const CUSTOM_DISCLAIMER_SLUGS: Record<string, string> = {
  offer_name: 'What is being sold (e.g. "Synthetic Blend Oil Change")',
  offer_price: 'The advertised price — formatted',
  regular_price: 'The undiscounted price this is compared against — formatted',
  percent_off: 'Percentage off, as entered (e.g. 15)',
  dollar_off: 'Dollars off — formatted',
  minimum_spend: 'Minimum spend the offer requires — formatted',
  applies_to: 'What the offer covers (e.g. "most vehicles", "select brands")',
  included_allowance: 'Fluid / parts / labor allowance included, as entered (e.g. "up to 5 quarts")',
  exclusions: 'Parts or services the offer excludes, as entered',
  part_number: 'Manufacturer part number, for a parts or accessory offer',
  availability_note: 'Stock limitation, as entered (e.g. "while supplies last")',
  coupon_code: 'Coupon / redemption code, as entered',
  redemption_limit: 'How many times it can be used (e.g. "one per customer")',
  offer_phrase: 'The offer stated as a phrase, for a BOGO, bundle or free-with offer',
  event_dates: 'Dates the ad refers to, as entered',
  location: 'Location as entered',
  phone: 'Phone number as entered',
  website_url: 'Website / link as entered',
  // Derived — computed, never typed. A human retyping either of these is a chance
  // to get the arithmetic wrong in a legal document, and "SAVE $50" over a price
  // that does not subtract to $50 is the textbook FTC problem.
  savings_amount: 'DERIVED: regular price − advertised price — formatted',
  savings_percent: 'DERIVED: (regular − advertised) ÷ regular, as a whole percentage',
};

/** Slugs every kind that composes a disclaimer can use. */
export const SHARED_DISCLAIMER_SLUGS: Record<string, string> = {
  dealership_name: 'Dealership name',
  offer_end_date: 'Offer end date as entered',
  states: 'States / regions the offer is valid in, as entered',
};
