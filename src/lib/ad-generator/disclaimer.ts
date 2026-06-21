import type { AdData } from './types';
import type { OfferType } from './offer-text';

/**
 * Disclaimer composition — the DETERMINISTIC, rule-based counterpart to the AI
 * copy. Templates hold `{slug}` tokens that are substituted from the offer's
 * structured fields; the AI never writes legal text. Port of Oz Dealer Tools'
 * DisclaimerTemplateModel (token engine + dealer-fee boilerplate + VIN/Stock#
 * append). Template bodies live in the `AdDisclaimerTemplate` DB model; these
 * code defaults are the fallback when no template matches the (make, type).
 */

/** Recognized `{slug}` tokens → what they resolve to (mirrors ODT's SLUGS). */
export const DISCLAIMER_SLUGS: Record<string, string> = {
  vehicle: 'Vehicle (e.g. 2024 Toyota Camry SE)',
  dealership_name: 'Dealership name',
  msrp: 'MSRP — formatted with thousands separators',
  monthly_payment: 'Lease / finance monthly payment — formatted',
  due_at_signing: 'Lease due-at-signing amount — formatted',
  lease_term: 'Lease term in months',
  apr_rate: 'APR rate (e.g. 1.9)',
  apr_term: 'APR term in months',
  financial_institution: 'Finance institution (e.g. Toyota Financial)',
  discount_amount: 'Discount / cash-back amount — formatted',
  discount_source: 'Source of the discount (e.g. Dealer Discount)',
  sale_price: 'Advertised sale price — formatted',
  offer_end_date: 'Offer end date as entered',
  vin: 'VIN — rendered uppercase',
  stock_number: 'Stock number',
};

const DEALER_FEE_BOILERPLATE =
  'Advertised price includes all dealer-imposed fees. Excludes tax, title, and registration.';

/** Code-defined per-offer-type defaults — used when no DB template matches. */
export const DEFAULT_DISCLAIMER_TEMPLATES: Record<OfferType, string> = {
  lease:
    'Closed-end lease. {monthly_payment}/month for {lease_term} months, {due_at_signing} due at signing. With approved credit. See dealer for details.',
  apr: '{apr_rate}% APR financing for {apr_term} months with approved credit. See dealer for details.',
  discount: 'Save {discount_amount} off MSRP of {msrp}. See dealer for complete details.',
  sales_price:
    'Sale price {sale_price}. MSRP {msrp}. Plus tax, title, and license. See dealer for details.',
  custom: 'See dealer for complete details.',
};

function money(v: string | undefined): string | null {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return null;
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function plain(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

/** Resolve `{slug}` values from the offer's structured fields (formatted). */
export function buildTokenValues(data: AdData): Record<string, string> {
  const v: Record<string, string> = {};
  const set = (k: string, val: string | null) => {
    if (val) v[k] = val;
  };
  set('vehicle', plain(data.vehicleName));
  set('dealership_name', plain(data.dealerName));
  set('msrp', money(data.msrp));
  set('monthly_payment', money(data.monthlyPayment));
  set('due_at_signing', money(data.dueAtSigning));
  set('lease_term', plain(data.leaseTerm));
  set('apr_rate', plain(data.aprRate));
  set('apr_term', plain(data.aprTerm));
  set('financial_institution', plain(data.financialInstitution));
  set('discount_amount', money(data.discountAmount));
  set('discount_source', plain(data.discountSource));
  set('sale_price', money(data.salePrice));
  set('offer_end_date', plain(data.expiration));
  set('vin', data.vin ? data.vin.trim().toUpperCase() : null);
  set('stock_number', plain(data.stockNumber));
  return v;
}

/**
 * Substitute `{slug}` tokens. Unknown or unfilled tokens are LEFT VISIBLE
 * (ODT's convention) so missing data is obvious rather than silently dropped.
 */
export function substituteTokens(body: string, values: Record<string, string>): string {
  return body.replace(/\{([a-z_]+)\}/g, (m, key: string) =>
    values[key] != null && values[key] !== '' ? values[key] : m,
  );
}

/**
 * Compose the final disclaimer: substitute tokens into the chosen template
 * (or the per-offer-type default), then append the dealer-fee boilerplate (if
 * not already present) and a VIN / Stock# line (if provided).
 */
export function composeDisclaimer(data: AdData, templateBody?: string): string {
  const type = (data.offerType as OfferType) || 'custom';
  const body =
    (templateBody && templateBody.trim()) ||
    DEFAULT_DISCLAIMER_TEMPLATES[type] ||
    DEFAULT_DISCLAIMER_TEMPLATES.custom;

  const values = buildTokenValues(data);
  let out = substituteTokens(body, values).trim();

  if (!/dealer[-\s]?imposed fees/i.test(out)) {
    out = `${out} ${DEALER_FEE_BOILERPLATE}`;
  }
  const ids: string[] = [];
  if (values.vin) ids.push(`VIN: ${values.vin}`);
  if (values.stock_number) ids.push(`Stock#: ${values.stock_number}`);
  if (ids.length) out = `${out} ${ids.join('  ')}`;
  return out.trim();
}
