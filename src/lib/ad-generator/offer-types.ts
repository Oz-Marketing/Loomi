/**
 * Offer type SPECS — the declarative description of how each offer type
 * assembles its on-image block.
 *
 * WHY THIS IS DATA. `assembleOffer` used to be a `switch` over a closed union of
 * five vehicle offer types. That was fine while vehicles were the only thing the
 * generator made ads for; it stops being fine the moment a service or parts
 * offer needs the same treatment, because four offer kinds × five-ish types is
 * twenty branches nobody can read back against a spec.
 *
 * So the shape stays exactly the same — label / main / value / currency /
 * percent / terms, the six pieces the offer-block artwork binds to — and only
 * the *description* of each type moves out of code into a record. The
 * interpreter lives in `offer-text.ts`.
 *
 * These specs are CODE-OWNED, not designer-authored. A type carries formatting
 * and arithmetic decisions, so a half-configured one would render a silently
 * empty offer block. See docs/ad-generator-offer-kinds.md §10.
 *
 * No imports beyond types: the specs sit BELOW `offer-text` in the import graph
 * so the field schemas (which reference `OFFER_TYPES` for their select options)
 * can sit above it without a cycle.
 */

/**
 * How a figure is formatted, and which symbol element it lights up.
 *
 * - `money`   → `$1,299`; the block's `currency` is `$`
 * - `percent` → `1.9`; the block's `percent` is `%`
 * - `number`  → `36`, `1.9` — thousands-separated, no symbol
 * - `text`    → passed through verbatim, no separators and no symbol
 *
 * `percent` and `number` format identically and differ only in the symbol they
 * report, which is why a month count is `number` and a rate is `percent`.
 *
 * `text` exists for a headline that is a PHRASE rather than a figure — "BUY 3
 * GET 1" on a service offer. It is the one format that must not add thousands
 * separators, because it is not a number.
 *
 * The symbols are deliberately NOT baked into `main`: the offer-block designs
 * style the `$` and the `%` as their own conditionally-shown elements, so the
 * block reports them separately from the number. Only `main` lights a symbol —
 * a term line never does.
 *
 * Any of the three passes a non-numeric value straight through (a preview
 * placeholder like `X,XXX`, or pre-formatted text), so the canvas can show
 * obvious placeholders rather than coercing them to zero.
 */
export type OfferFigureFormat = 'money' | 'percent' | 'number' | 'text';

/** The headline figure of an offer block. */
export interface OfferMainSpec {
  /** The `AdData` key holding the figure. */
  field: string;
  format: OfferFigureFormat;
  /** Appended verbatim to the formatted figure (`/mo`, `%`). Never appended
   *  to the em-dash placeholder — a missing number reads `—`, not `—/mo`. */
  suffix?: string;
  /**
   * Extra words the figure needs to make sense IN A SENTENCE, where there is no
   * label element beside it to carry the meaning.
   *
   * On the creative, "1.9%" sits under a label reading "APR" and the pair says
   * everything. In a caption — "2026 Trax — 1.9%." — the same figure says
   * nothing, so the prose form re-attaches the word. See `OfferBlock.prose`.
   */
  proseSuffix?: string;
}

/** One supporting line under the headline. Dropped entirely when its field is
 *  empty, so a lease with no due-at-signing simply doesn't mention one. */
export interface OfferTermSpec {
  field: string;
  format: OfferFigureFormat;
  /** Line text with `{value}` standing in for the formatted figure. */
  text: string;
}

export interface OfferTypeSpec {
  /** Stored in `AdData.offerType`. */
  value: string;
  /** Picker label (the Offer type dropdown). */
  label: string;
  /**
   * Default on-image label, overridden per ad by `offerLabel`.
   * Absent for a type that assembles nothing.
   */
  defaultLabel?: string;
  /**
   * Swap the default label based on another field's value — for the one real
   * case, a discount that reads OFF MSRP or CASH BACK from the same numbers.
   * An unmatched value falls back to `defaultLabel`.
   */
  labelWhen?: { field: string; map: Record<string, string> };
  /**
   * The headline figure. **Absent means this type assembles nothing** —
   * `assembleOffer` returns null and the template falls back to the free-text
   * `price` / `terms` fields. That is what `custom` is.
   */
  main?: OfferMainSpec;
  /** Supporting lines, in order, joined with ` · `. */
  terms?: OfferTermSpec[];
  /**
   * Fields an offer of this type INTRINSICALLY needs — the figures without which
   * it doesn't render as an offer at all. Unioned with the make's OEM rule by
   * `requiredFieldsFor`, and export is blocked while any is empty.
   *
   * Lives on the spec rather than in a `Record<OfferType, …>` table so a kind's
   * types carry their own requirements. It is also the contract the code default
   * disclaimer bodies rely on: an unresolved token renders as a literal
   * `{{token}}` in a legal line, so a default body may only reference fields
   * listed here.
   */
  required?: string[];
  /**
   * This type means "there is no offer on this ad" — a hiring, event or
   * new-location ad. Distinct from merely having no `main`: a vehicle free-text
   * offer also assembles nothing, but it IS still an offer and still carries
   * manufacturer claims, so it still needs compliance checking. This flag is
   * what tells the two apart.
   */
  noOffer?: boolean;
}

/**
 * The vehicle kind's five offer types — a verbatim transcription of the switch
 * these replaced. `offer-text.test.ts` is the characterization suite that holds
 * them to it; if a change here alters any assertion there, the change is wrong.
 */
export const VEHICLE_OFFER_TYPE_SPECS: OfferTypeSpec[] = [
  {
    value: 'lease',
    required: ['monthlyPayment', 'leaseTerm'],
    label: 'Lease',
    defaultLabel: 'PER MONTH LEASE',
    main: { field: 'monthlyPayment', format: 'money', suffix: '/mo' },
    terms: [
      { field: 'leaseTerm', format: 'number', text: '{value}-month lease' },
      { field: 'dueAtSigning', format: 'money', text: '{value} due at signing' },
    ],
  },
  {
    value: 'apr',
    required: ['aprRate', 'aprTerm'],
    label: 'APR Financing',
    defaultLabel: 'APR',
    // Just the rate. The word APR is the LABEL's job — `defaultLabel` above —
    // and carrying it here too made every design that showed both read
    // "APR / 1.9% APR". Changed deliberately 2026-08-22: it rewrites the
    // headline of existing APR ads from "1.9% APR" to "1.9%", which is the
    // point. See docs/ad-generator-archetypes.md §5.
    main: { field: 'aprRate', format: 'percent', suffix: '%', proseSuffix: ' APR' },
    // Just the financing term — the financial institution still rides in the
    // disclaimer, but the on-image terms line stays clean.
    terms: [{ field: 'aprTerm', format: 'number', text: 'for {value} months' }],
  },
  {
    value: 'discount',
    required: ['discountAmount'],
    label: 'Discount / Cash Back',
    defaultLabel: 'OFF MSRP',
    labelWhen: { field: 'discountLabelStyle', map: { cash_back: 'CASH BACK' } },
    main: { field: 'discountAmount', format: 'money' },
    // Just the MSRP reference (the discount source rides in the disclaimer).
    terms: [{ field: 'msrp', format: 'money', text: 'MSRP of {value}' }],
  },
  {
    value: 'sales_price',
    required: ['salePrice'],
    label: 'Sales Price',
    defaultLabel: 'SALES PRICE',
    main: { field: 'salePrice', format: 'money' },
    terms: [{ field: 'msrp', format: 'money', text: 'MSRP of {value}' }],
  },
  // No `main` — free text. The template uses `price` / `terms` directly.
  //
  // Labelled "Free text" rather than "Custom": there is now an offer KIND called
  // Custom, and a vehicle offer type sharing that word made the two impossible
  // to talk about. The stored VALUE stays `custom` — it is in ad data and
  // disclaimer-template rows.
  { value: 'custom', label: 'Free text' },
];

/**
 * The CUSTOM kind's offer types — everything that is not a vehicle offer.
 *
 * FIVE types covering service, parts/accessories, and message-only ads. What
 * used to be three separate kinds (`service`, `parts`, `general`) is this list,
 * because that is what actually varied between them — see
 * `templates/custom-offer.ts`.
 *
 * `other_offer` covers BOGO, bundles and free-with-purchase in one type: all
 * three have the same shape, a headline that is a PHRASE rather than a figure.
 * A type exists to make the block assemble and to key required fields,
 * disclaimer bodies and co-op rules; types that do all four the same way are one
 * type.
 *
 * ⚠️ VALUES ARE GLOBALLY UNIQUE across kinds — `assembleOffer` resolves a spec by
 * value with no kind in scope. That is why the phrase type is `other_offer` and
 * not `custom`, which the vehicle kind already owns.
 */
export const CUSTOM_OFFER_TYPE_SPECS: OfferTypeSpec[] = [
  {
    value: 'flat_price',
    label: 'Flat price',
    required: ['offerName', 'offerPrice'],
    defaultLabel: 'SPECIAL',
    main: { field: 'offerPrice', format: 'money' },
    // The regular price is the comparison a savings claim rests on, so it
    // belongs on the ad next to the number, not only in the fine print.
    terms: [{ field: 'regularPrice', format: 'money', text: 'Reg. {value}' }],
  },
  {
    value: 'percent_off',
    label: 'Percent off',
    required: ['offerName', 'percentOff'],
    defaultLabel: 'OFF',
    main: { field: 'percentOff', format: 'percent', suffix: '% OFF' },
    terms: [{ field: 'minimumSpend', format: 'money', text: 'on any purchase over {value}' }],
  },
  {
    value: 'dollar_off',
    label: 'Dollars off',
    required: ['offerName', 'dollarOff'],
    defaultLabel: 'OFF',
    main: { field: 'dollarOff', format: 'money', suffix: ' OFF' },
    terms: [{ field: 'minimumSpend', format: 'money', text: 'on any purchase over {value}' }],
  },
  {
    value: 'other_offer',
    label: 'BOGO, bundle or free with purchase',
    required: ['offerName', 'offerPhrase'],
    defaultLabel: 'SPECIAL',
    main: { field: 'offerPhrase', format: 'text' },
    terms: [{ field: 'minimumSpend', format: 'money', text: 'with any purchase over {value}' }],
  },
  {
    // No `main`, and flagged `noOffer`: a hiring or event ad. Every offer input
    // and every restriction field hides, no offer block assembles, and nothing
    // manufacturer-related applies because there is no claim to check.
    value: 'no_offer',
    label: 'No offer (message only)',
    noOffer: true,
  },
];

/** Picker options for the custom kind's Offer type dropdown. */
export const CUSTOM_OFFER_TYPES: { value: string; label: string }[] = CUSTOM_OFFER_TYPE_SPECS.map(
  (s) => ({ value: s.value, label: s.label }),
);
