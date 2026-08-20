import type { AdData } from './types';
import { parseOfferNumber } from './numbers';
import { OFFER_KINDS, kindForOfferType, offerKind, DEFAULT_OFFER_KIND } from './offer-kinds';

/**
 * Disclaimer composition — the DETERMINISTIC, rule-based counterpart to the AI
 * copy. Templates hold `{slug}` tokens that are substituted from the offer's
 * structured fields; the AI never writes legal text. Port of Oz Dealer Tools'
 * DisclaimerTemplateModel (token engine + dealer-fee boilerplate + VIN/Stock#
 * append). Template bodies live in the `AdDisclaimerTemplate` DB model; these
 * code defaults are the fallback when no template matches the (make, type).
 */

/**
 * Every recognized `{slug}` token across every offer kind, for the disclaimer
 * template editor's reference list.
 *
 * The per-KIND maps are the source of truth and live in `disclaimer-slugs.ts`; a
 * template body is only ever composed for one kind, so use
 * `offerKind(...).slugs` when you mean "the slugs valid HERE". This union exists
 * because the editor lists what a body may contain without knowing which kind the
 * author has in mind.
 */
export const DISCLAIMER_SLUGS: Record<string, string> = Object.assign(
  {},
  ...OFFER_KINDS.map((k) => k.slugs),
);


/**
 * Code-defined per-offer-type defaults — used when no DB template matches.
 *
 * Keyed by offer type value across every kind (values are globally unique).
 *
 * ⚠️ A body here may only reference tokens the type's `required` fields
 * guarantee. `substituteTokens` leaves an unresolved token as a LITERAL
 * `{{token}}`, so an optional field in a default body prints raw markup into a
 * legal line. (The `lease` body below has carried that risk since it was written:
 * `due_at_signing` is not baseline-required. Left as-is rather than changed
 * silently — it is real legal wording and a fix is the Co-op team's call.)
 *
 * The SERVICE bodies restate the offer and defer to the dealer, deliberately.
 * The real per-brand fixed-ops wording is legal text and is not invented here —
 * it arrives as `AdDisclaimerTemplate` rows from the Co-op team. See
 * docs/ad-generator-offer-kinds.md §9.
 */
export const DEFAULT_DISCLAIMER_TEMPLATES: Record<string, string> = {
  // ── vehicle ──
  lease:
    'Closed-end lease. {{monthly_payment}}/month for {{lease_term}} months, {{due_at_signing}} due at signing. With approved credit. See dealer for details.',
  apr: '{{apr_rate}} APR financing for {{apr_term}} months with approved credit. See dealer for details.',
  discount: 'Save {{discount_amount}} off MSRP of {{msrp}}. See dealer for complete details.',
  sales_price:
    'Sale price {{sale_price}}. MSRP {{msrp}}. Plus tax, title, and license. See dealer for details.',
  custom: 'See dealer for complete details.',
  // ── custom (service, parts, accessories) ──
  flat_price: '{{offer_name}} for {{offer_price}}. See dealer for complete details.',
  percent_off: '{{percent_off}}% off {{offer_name}}. See dealer for complete details.',
  dollar_off: '{{dollar_off}} off {{offer_name}}. See dealer for complete details.',
  other_offer: '{{offer_phrase}} on {{offer_name}}. See dealer for complete details.',
  // A message-only ad has no offer to describe. Empty rather than "See dealer for
  // complete details.", which would assert there are details to see.
  no_offer: '',
};

/**
 * Format a Number as USD.
 *
 * CENTS ARE PRESERVED WHEN PRESENT: an integer renders as `$299`, a non-integer
 * as `$79.95`. Fixed-ops pricing is quoted in cents — the canonical oil-change
 * price is $79.95 — and the old `maximumFractionDigits: 0` rounded that to `$80`,
 * advertising a price the dealer does not charge.
 *
 * The same rule is applied by the offer engine and the disclaimer engine, and it
 * has to stay that way: if only one rounded, the on-image price and the fine
 * print would state different numbers, which is worse than both rounding.
 */
function money(v: string | undefined): string | null {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return null;
  // Integer → no decimals (so a vehicle payment stays `$299`, unchanged).
  // Otherwise exactly two, because `$79.9` is not a way to write money.
  const digits = Number.isInteger(n) ? 0 : 2;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function plain(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

/** Parse a user-entered figure ("$3,999", "10,000", "36") to a Number, or null.
 *  Shared with the co-op rule engine so a rule can't disagree with the
 *  disclaimer about what a figure is — see numbers.ts. */
const num = parseOfferNumber;

/** Format a Number as USD, preserving cents when present. Same rule as `money`
 *  — a derived figure must be written the way the figures it came from are. */
function fmtMoney(n: number): string {
  const digits = Number.isInteger(n) ? 0 : 2;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
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

  // ── Service savings ──────────────────────────────────────────────────────
  //
  // The characteristic failure of a service coupon is a savings claim that does
  // not subtract: "SAVE $50" printed over "$99 (reg. $139)". So there is no
  // field for either of these — they are computed from the regular price and
  // whichever figure this offer type advertises.
  //
  // Guarded on `regular > advertised`: a regular price at or below the
  // advertised one is a data-entry error, and "SAVE $0" or a negative saving on
  // an ad is worse than no savings line. It stays absent, so the disclaimer and
  // the summary panel both simply have nothing to say.
  const regular = num(data.regularPrice);
  const advertised =
    data.offerType === 'flat_price'
      ? num(data.offerPrice)
      : data.offerType === 'dollar_off' && regular != null
        // A dollars-off offer states the DISCOUNT, not the price. Deriving the
        // resulting price is what makes the same savings arithmetic apply.
        ? (() => {
            const off = num(data.dollarOff);
            return off == null ? null : regular - off;
          })()
        : null;
  if (regular != null && advertised != null && regular > advertised) {
    const saved = regular - advertised;
    out.savings_amount = {
      label: 'You save',
      value: fmtMoney(saved),
      math: `${fmtMoney(regular)} − ${fmtMoney(advertised)}`,
    };
    out.savings_percent = {
      label: 'Savings',
      value: `${Math.round((saved / regular) * 100)}%`,
      math: `${fmtMoney(saved)} ÷ ${fmtMoney(regular)}`,
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
  /**
   * The offer KIND this disclaimer is being composed for.
   *
   * Only consulted when `data.offerType` is empty — which is the state a
   * from-scratch ad is in before anyone picks a type. Without it the offer type
   * falls back to `custom`, and `custom` belongs to the VEHICLE kind, so a
   * custom-offer ad was composing a disclaimer that ended
   * "Advertised price includes all dealer-imposed fees" — vehicle legal text on
   * an oil-change coupon.
   */
  offerKind?: string;
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

  // ── custom (service, parts, accessories, message-only) ──
  // The restriction fields are `plain`, not `money`: they are stated as entered
  // ("up to 5 quarts", "most vehicles", "one per customer"). Only the figures go
  // through the money formatter.
  set('offer_name', plain(data.offerName));
  set('offer_price', money(data.offerPrice));
  set('regular_price', money(data.regularPrice));
  set('percent_off', plain(data.percentOff));
  set('dollar_off', money(data.dollarOff));
  set('minimum_spend', money(data.minimumSpend));
  set('applies_to', plain(data.appliesTo));
  set('included_allowance', plain(data.includedAllowance));
  set('exclusions', plain(data.exclusions));
  set('part_number', plain(data.partNumber));
  set('availability_note', plain(data.availabilityNote));
  set('coupon_code', plain(data.couponCode));
  set('redemption_limit', plain(data.redemptionLimit));
  set('offer_phrase', plain(data.offerPhrase));
  set('event_dates', plain(data.eventDates));
  set('location', plain(data.location));
  set('phone', plain(data.phone));
  set('website_url', plain(data.websiteUrl));
  // `savings_amount` / `savings_percent` are NOT set here — they come from
  // `deriveOfferFigures` below, which is the only place that computes them.

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
  // Hoisted out of the else-branch: the boilerplate below is chosen from the
  // offer type too, and it applies to a verbatim OEM body just as much as to a
  // composed one.
  // The type as ACTUALLY SET, kept apart from the defaulted one below. The
  // difference matters: `custom` is the default, and `custom` is a real vehicle
  // offer type — so a defaulted value is indistinguishable from a chosen one
  // unless the raw value is kept.
  const rawType = (data.offerType ?? '').trim();
  const type = rawType || 'custom';
  let out: string;
  if (rawBody != null && rawBody.trim()) {
    out = rawBody.trim();
  } else {
    // `??` semantics on PRESENCE, not truthiness: `no_offer`'s body is
    // deliberately the empty string (a hiring ad has no offer to describe), and a
    // `||` chain would fall straight through it to the generic "See dealer for
    // complete details." — asserting there are details to see.
    // Which type's default body to compose from.
    //
    // A CHOSEN type uses its own. An UNSET one uses the generic body of the kind
    // being composed for — the first of that kind's types with no figures of its
    // own (vehicle's `custom`, custom's `no_offer`). Defaulting straight to
    // `custom` handed vehicle wording to every other kind, which is the same
    // cross-kind leak as the fee boilerplate above.
    const bodyType = rawType
      ? type
      : (offerKind(opts.offerKind ?? DEFAULT_OFFER_KIND).offerTypes.find((t) => !t.main)?.value ?? 'custom');
    const body =
      (templateBody && templateBody.trim()) ||
      (bodyType in DEFAULT_DISCLAIMER_TEMPLATES
        ? DEFAULT_DISCLAIMER_TEMPLATES[bodyType]
        : DEFAULT_DISCLAIMER_TEMPLATES.custom);
    out = substituteTokens(body, values).trim();
  }

  // The fee boilerplate comes from the KIND that owns this offer type, because
  // the vehicle sentence is a claim about an advertised VEHICLE price — appending
  // it to an oil-change coupon states something untrue about the offer. A kind
  // with an empty string appends nothing.
  //
  // Only added when the body doesn't already speak to dealer fees. The test used
  // to require the exact phrase "dealer-imposed fees", but manufacturer language
  // says "and dealer fees" — so a full-length OEM body got the boilerplate
  // appended and the disclaimer ended up asserting both that fees were INCLUDED
  // and that they were EXCLUDED, in consecutive sentences.
  // Only ask which kind OWNS the type when a type was actually chosen. Asking
  // for the defaulted `custom` always answers "vehicle", so the kind hint could
  // never take effect and a brand-new custom-offer ad picked up vehicle wording.
  const owningKind = rawType ? kindForOfferType(rawType) : undefined;
  const boilerplate = (owningKind ?? offerKind(opts.offerKind ?? DEFAULT_OFFER_KIND))
    .dealerFeeBoilerplate;
  if (boilerplate && !/dealer[-\s]?(imposed\s+)?fees?\b/i.test(out)) {
    out = `${out} ${boilerplate}`;
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
