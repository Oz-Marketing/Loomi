import type { AdData } from './types';
import type { OfferType } from './offer-text';
import { parseOfferNumber } from './numbers';

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

const DEALER_FEE_BOILERPLATE =
  'Advertised price includes all dealer-imposed fees. Excludes tax, title, and registration.';

/** Code-defined per-offer-type defaults — used when no DB template matches. */
export const DEFAULT_DISCLAIMER_TEMPLATES: Record<OfferType, string> = {
  lease:
    'Closed-end lease. {{monthly_payment}}/month for {{lease_term}} months, {{due_at_signing}} due at signing. With approved credit. See dealer for details.',
  apr: '{{apr_rate}} APR financing for {{apr_term}} months with approved credit. See dealer for details.',
  discount: 'Save {{discount_amount}} off MSRP of {{msrp}}. See dealer for complete details.',
  sales_price:
    'Sale price {{sale_price}}. MSRP {{msrp}}. Plus tax, title, and license. See dealer for details.',
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

/** Parse a user-entered figure ("$3,999", "10,000", "36") to a Number, or null.
 *  Shared with the co-op rule engine so a rule can't disagree with the
 *  disclaimer about what a figure is — see numbers.ts. */
const num = parseOfferNumber;

/** Format a Number as whole dollars. */
function fmtMoney(n: number): string {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Format a Number as a whole-number count (miles, months — not money). */
function fmtCount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** A whole-number count with thousands separators (miles, not money). */
function count(n: number | null): string | null {
  return n == null ? null : fmtCount(n);
}

/** A figure the disclaimer states but nobody types, carried with its arithmetic. */
export interface DerivedFigure {
  /** Human label, for the "show your work" panel. */
  label: string;
  /** Formatted value — exactly what the disclaimer carries. */
  value: string;
  /** The arithmetic that produced it, e.g. "$389 × 36 mo". */
  math: string;
}

/**
 * Figures computed from the offer rather than entered: the payments total and
 * the lease's total mileage allowance.
 *
 * Exported so the form's summary panel can show the SAME values the disclaimer
 * carries. Deriving them twice would let the panel and the legal line disagree,
 * and a panel that disagrees with the disclaimer is worse than no panel — it
 * invites someone to trust the wrong one.
 */
export function deriveOfferFigures(data: AdData): Record<string, DerivedFigure> {
  const out: Record<string, DerivedFigure> = {};
  // The term lives under a different key per offer type; resolve it once rather
  // than letting each derivation guess.
  const term = num(data.offerType === 'apr' ? data.aprTerm : data.leaseTerm);
  const payment = num(data.monthlyPayment);
  if (term != null && payment != null) {
    out.monthly_payments_total = {
      label: 'Monthly payments total',
      value: fmtMoney(payment * term),
      math: `${fmtMoney(payment)} × ${fmtCount(term)} mo`,
    };
  }
  // Lease only — an APR offer has no mileage allowance to exceed.
  const perYear = num(data.milesPerYear);
  if (data.offerType === 'lease' && term != null && perYear != null) {
    out.total_miles = {
      label: 'Total lease miles',
      value: fmtCount(perYear * (term / 12)),
      math: `${fmtCount(perYear)}/yr × (${fmtCount(term)} ÷ 12)`,
    };
  }
  return out;
}

/** A rate value with a trailing `%` (idempotent). ODT's disclaimer templates
 *  write `{apr_rate} APR`, expecting the rate to already carry its percent sign. */
function pct(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  if (t === '') return null;
  return t.endsWith('%') ? t : `${t}%`;
}

/**
 * Options for the values that aren't carried by the offer itself.
 *
 * `now` exists so the copyright year is INJECTABLE rather than read from a
 * global clock. Reading the clock inside this function would make the composed
 * disclaimer non-deterministic — the same offer would produce different legal
 * text either side of midnight on 31 December, and no test could assert on it
 * without freezing time process-wide. It defaults, so no caller has to care.
 */
export interface TokenOptions {
  /** Treated as "today" for the copyright year. Defaults to the current date. */
  now?: Date;
}

/** Resolve `{slug}` values from the offer's structured fields (formatted). */
export function buildTokenValues(data: AdData, opts: TokenOptions = {}): Record<string, string> {
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
  set('security_deposit', money(data.securityDeposit));
  set('apr_rate', pct(data.aprRate));
  set('apr_term', plain(data.aprTerm));
  set('financial_institution', plain(data.financialInstitution));
  set('cost_per_thousand', plain(data.costPerThousand));
  set('discount_amount', money(data.discountAmount));
  set('discount_source', plain(data.discountSource));
  set('sale_price', money(data.salePrice));
  set('offer_end_date', plain(data.expiration));
  set('vin', data.vin ? data.vin.trim().toUpperCase() : null);
  set('stock_number', plain(data.stockNumber));

  // ── full-length OEM lease/finance clauses ──
  set('selling_price', money(data.sellingPrice));
  set('customer_down', money(data.customerDown));
  set('acquisition_fee', money(data.acquisitionFee));
  set('disposition_fee', money(data.dispositionFee));
  set('overage_rate', plain(data.overageRate));
  set('miles_per_year', count(num(data.milesPerYear)));
  set('amount_financed', money(data.amountFinanced));
  set('states', plain(data.states));
  set('dealer_code', plain(data.dealerCode));

  // ── derived ──
  // One source of truth, shared with the form's summary panel.
  for (const [slug, fig] of Object.entries(deriveOfferFigures(data))) set(slug, fig.value);

  // The manufacturer copyright line. A dealer may pin it via `copyrightYear`
  // (an ad built in December for a January campaign carries the new year);
  // otherwise it's the year the disclaimer is composed. Always resolves, so an
  // OEM body can never print a raw `{{copyright_year}}` on a legal line.
  // `getFullYear` is LOCAL time, which is the year we want: a Utah store
  // composing an ad at 5pm on 31 December is still in 2026, and a UTC-based year
  // would print 2027 on it.
  const pinned = plain(data.copyrightYear);
  set('copyright_year', pinned ?? String((opts.now ?? new Date()).getFullYear()));
  return v;
}

// Matches a `{slug}` or `{{slug}}` token (either brace style). The UI writes
// `{{slug}}` now; single-brace bodies from older data still resolve so no
// migration is needed. Shared with the editor's highlighter.
export const TOKEN_RE = /\{\{?([a-z_]+)\}\}?/g;

/**
 * Substitute `{{slug}}` (or legacy `{slug}`) tokens. Unknown or unfilled tokens
 * are LEFT VISIBLE (ODT's convention) so missing data is obvious rather than
 * silently dropped.
 */
export function substituteTokens(body: string, values: Record<string, string>): string {
  return body.replace(TOKEN_RE, (m, key: string) =>
    values[key] != null && values[key] !== '' ? values[key] : m,
  );
}

/**
 * Compose the final disclaimer: substitute tokens into the chosen template
 * (or the per-offer-type default), then append the dealer-fee boilerplate (if
 * not already present) and a VIN / Stock# line (if provided).
 *
 * `rawBody` overrides the template path: when set (e.g. a MarketCheck OEM
 * offer's authoritative fine print), it's used VERBATIM — no token substitution —
 * and only the shared boilerplate + VIN/Stock append still run (matching ODT).
 */
export function composeDisclaimer(
  data: AdData,
  templateBody?: string,
  rawBody?: string,
  opts: TokenOptions = {},
): string {
  const values = buildTokenValues(data, opts);
  let out: string;
  if (rawBody != null && rawBody.trim()) {
    out = rawBody.trim();
  } else {
    const type = (data.offerType as OfferType) || 'custom';
    const body =
      (templateBody && templateBody.trim()) ||
      DEFAULT_DISCLAIMER_TEMPLATES[type] ||
      DEFAULT_DISCLAIMER_TEMPLATES.custom;
    out = substituteTokens(body, values).trim();
  }

  // Only add the fee boilerplate when the body doesn't already speak to dealer
  // fees. The test used to require the exact phrase "dealer-imposed fees", but
  // manufacturer language says "and dealer fees" — so a full-length OEM body got
  // the boilerplate appended and the disclaimer ended up asserting both that
  // fees were INCLUDED and that they were EXCLUDED, in consecutive sentences.
  if (!/dealer[-\s]?(imposed\s+)?fees?\b/i.test(out)) {
    out = `${out} ${DEALER_FEE_BOILERPLATE}`;
  }
  // Append the identifiers only when the body doesn't already carry them. Testing
  // the substituted VALUE rather than the token catches every phrasing — a
  // full-length OEM body writes "VIN: {vin}." mid-sentence, and appending a
  // second copy on the end reads as a mistake in a legal line.
  const ids: string[] = [];
  if (values.vin && !out.includes(values.vin)) ids.push(`VIN: ${values.vin}`);
  if (values.stock_number && !out.includes(values.stock_number)) {
    ids.push(`Stock#: ${values.stock_number}`);
  }
  if (ids.length) out = `${out} ${ids.join('  ')}`;
  return out.trim();
}
