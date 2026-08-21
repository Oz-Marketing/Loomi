import type { AdData, FieldSpec } from '../types';
import { CUSTOM_OFFER_TYPES } from '../offer-types';

/**
 * The CUSTOM offer kind's field schema — everything that is not a vehicle offer.
 *
 * Service, parts and accessories, hiring, events, sell-us-your-car,
 * sponsorships, a new location. One kind, deliberately.
 *
 * ── WHY ONE KIND AND NOT THREE ──
 *
 * This was built as two kinds first (`general`, then `service`) with `parts`
 * planned as a third, and building the second one is what showed the split was
 * wrong: parts shares 100% of service's offer math and all but three of its
 * fields, and a hiring ad is just a service offer with no offer. Three kinds
 * meant three copies of the same arithmetic, three parallel slug maps, and a
 * user having to know which bucket an ad belonged in before they could start it.
 *
 * What actually varies is the OFFER TYPE (a price, a percentage, dollars off, a
 * phrase, or nothing at all) and which restrictions apply — both of which are
 * already per-ad choices inside a kind. So they became exactly that.
 *
 * `no_offer` is the case that carries a hiring or event ad: it hides every offer
 * figure and assembles no offer block. An earlier version of this rejected a
 * `no_offer` sentinel — correctly, when "no offer" was its own KIND and the
 * field could simply be absent. Once one kind has to serve both, the user needs
 * a way to SAY there is no offer, and a sentinel is the honest way to say it.
 *
 * ── FIELD NAMES ARE KIND-NEUTRAL ──
 *
 * `offerName` / `offerPrice`, not `serviceName` / `servicePrice`: the same field
 * holds "Synthetic Blend Oil Change" and "Genuine Subaru All-Weather Floor
 * Mats". A key named for one of the things it holds is how a schema starts
 * lying about itself.
 *
 * ── THE SAVINGS ARITHMETIC IS THE COMPLIANCE RISK ──
 *
 * A coupon's characteristic failure is a savings claim that does not subtract:
 * "SAVE $50" printed over "$99 (reg. $139)". So `savingsAmount` and
 * `savingsPercent` are NOT fields — they are derived in `deriveOfferFigures`
 * from `regularPrice` and the advertised figure. There is deliberately nowhere
 * for a human to type them.
 */

/** Offer types that advertise a figure — i.e. everything except `no_offer`.
 *  Used by `visibleWhen` so a message-only ad shows no offer inputs at all. */
const WITH_OFFER = ['flat_price', 'percent_off', 'dollar_off', 'other_offer'];

/**
 * Keys shared with the vehicle kind on purpose — `expiration`, `disclaimer`,
 * `offerType`, `offerLabel`, `states` mean the same thing in both, so a saved
 * block, a field preference or a template element referring to any of them keeps
 * working across kinds. Field keys are NOT namespaced per kind; only offer TYPE
 * values have to be unique.
 */
export const customOfferFields: FieldSpec[] = [
  // ── Copy — everything the AI may write. `maxLength` is both the fit hint and
  //    the constraint the copywriter must respect.
  {
    key: 'headline',
    label: 'Headline',
    type: 'text',
    group: 'Copy',
    placeholder: 'Ready for winter?',
    help: 'The one thing the ad is saying.',
    copy: true,
    maxLength: 40,
  },
  {
    key: 'subheadline',
    label: 'Subheadline',
    type: 'text',
    group: 'Copy',
    placeholder: 'Book online in under a minute',
    copy: true,
    maxLength: 70,
  },
  {
    key: 'bodyText',
    label: 'Body text',
    type: 'textarea',
    group: 'Copy',
    placeholder: 'Two or three lines of detail.',
    help: 'Only fits the larger sizes.',
    copy: true,
    maxLength: 220,
  },
  {
    key: 'ctaText',
    label: 'Call to action',
    type: 'text',
    group: 'Copy',
    placeholder: 'Schedule service',
    help: 'The button or badge text.',
    copy: true,
    maxLength: 24,
  },

  // ── Offer ──
  {
    key: 'offerType',
    label: 'Offer type',
    type: 'select',
    group: 'Offer',
    options: CUSTOM_OFFER_TYPES,
    help: 'Drives the offer block + which fields show below. Pick “No offer” for a message-only ad.',
  },
  {
    key: 'offerName',
    label: 'What’s on offer',
    type: 'text',
    group: 'Offer',
    placeholder: 'Synthetic blend oil change',
    help: 'The service, part or package being sold. Appears on the ad and in the fine print.',
    visibleWhen: { field: 'offerType', in: WITH_OFFER },
  },
  {
    key: 'offerLabel',
    label: 'Offer label',
    type: 'text',
    group: 'Offer',
    placeholder: 'auto (e.g. SERVICE SPECIAL)',
    help: 'Optional — overrides the default label. AI can write this.',
    copy: true,
    maxLength: 18,
    visibleWhen: { field: 'offerType', in: WITH_OFFER },
  },
  {
    key: 'offerPrice',
    label: 'Price ($)',
    type: 'text',
    group: 'Offer',
    placeholder: '79.95',
    visibleWhen: { field: 'offerType', in: ['flat_price'] },
  },
  {
    key: 'percentOff',
    label: 'Percent off (%)',
    type: 'text',
    group: 'Offer',
    placeholder: '15',
    visibleWhen: { field: 'offerType', in: ['percent_off'] },
  },
  {
    key: 'dollarOff',
    label: 'Dollars off ($)',
    type: 'text',
    group: 'Offer',
    placeholder: '50',
    visibleWhen: { field: 'offerType', in: ['dollar_off'] },
  },
  {
    key: 'offerPhrase',
    label: 'Offer',
    type: 'text',
    group: 'Offer',
    placeholder: 'Buy 3 get 1 free',
    help: 'The headline stated as a phrase, for a BOGO, bundle or free-with offer.',
    maxLength: 24,
    visibleWhen: { field: 'offerType', in: ['other_offer'] },
  },
  {
    // Shown only for the two types a savings claim can be derived from. Not for
    // percent_off (the percentage IS the claim) or other_offer (no figure to
    // subtract from).
    key: 'regularPrice',
    label: 'Regular price ($)',
    type: 'text',
    group: 'Offer',
    placeholder: '139',
    help: 'What it normally costs. The savings figure is calculated from this — never typed.',
    visibleWhen: { field: 'offerType', in: ['flat_price', 'dollar_off'] },
  },
  {
    key: 'minimumSpend',
    label: 'Minimum spend ($)',
    type: 'text',
    group: 'Offer',
    placeholder: '200',
    help: 'If the offer requires one, e.g. “$50 off any service over $200”.',
    visibleWhen: { field: 'offerType', in: ['percent_off', 'dollar_off', 'other_offer'] },
  },
  { key: 'expiration', label: 'Expiration', type: 'text', group: 'Offer', placeholder: 'Offer ends August 31' },

  // ── Media ──
  {
    key: 'backgroundImage',
    label: 'Background image',
    type: 'image',
    group: 'Media',
    help: 'Full-bleed photo behind everything.',
  },
  {
    key: 'featureImage',
    label: 'Feature image',
    type: 'image',
    group: 'Media',
    help: 'A subject on top of the layout. Transparent PNG looks best.',
  },

  // ── Terms — the restrictions an offer has to state. Facts, so none of these is
  //    AI-writable: a model inventing an exclusion or a redemption limit is
  //    inventing a legal statement.
  {
    key: 'appliesTo',
    label: 'Applies to',
    type: 'text',
    group: 'Terms',
    placeholder: 'Most vehicles',
    help: 'What the offer covers. Required by some manufacturer programs.',
    visibleWhen: { field: 'offerType', in: WITH_OFFER },
  },
  {
    key: 'includedAllowance',
    label: 'Included allowance',
    type: 'text',
    group: 'Terms',
    placeholder: 'Up to 5 quarts',
    help: 'The fluid, parts or labor allowance the price includes, as it should read.',
    visibleWhen: { field: 'offerType', in: WITH_OFFER },
  },
  {
    key: 'exclusions',
    label: 'Exclusions',
    type: 'text',
    group: 'Terms',
    placeholder: 'Diesel and synthetic excluded',
    visibleWhen: { field: 'offerType', in: WITH_OFFER },
  },
  {
    key: 'partNumber',
    label: 'Part number',
    type: 'text',
    group: 'Terms',
    placeholder: 'J501SFL500',
    help: 'For a parts or accessory offer, where the program requires it.',
    visibleWhen: { field: 'offerType', in: WITH_OFFER },
  },
  {
    key: 'availabilityNote',
    label: 'Availability',
    type: 'text',
    group: 'Terms',
    placeholder: 'While supplies last',
    help: 'Any stock limitation the offer is subject to.',
    visibleWhen: { field: 'offerType', in: WITH_OFFER },
  },
  {
    key: 'couponCode',
    label: 'Coupon code',
    type: 'text',
    group: 'Terms',
    placeholder: 'OIL2695',
    visibleWhen: { field: 'offerType', in: WITH_OFFER },
  },
  {
    key: 'redemptionLimit',
    label: 'Redemption limit',
    type: 'text',
    group: 'Terms',
    placeholder: 'One per customer',
    visibleWhen: { field: 'offerType', in: WITH_OFFER },
  },
  {
    key: 'states',
    label: 'States / regions',
    type: 'text',
    group: 'Terms',
    placeholder: 'ID; UT; WA; OR; CO',
    help: 'Where the offer is valid, as it should read in the disclaimer.',
    visibleWhen: { field: 'offerType', in: WITH_OFFER },
  },

  // ── Details — always shown. These are what a hiring, event or new-location ad
  //    is mostly made of, and they are equally useful on a service coupon.
  { key: 'eventDates', label: 'Dates', type: 'text', group: 'Details', placeholder: 'August 22–24', help: 'As it should read on the ad.' },
  { key: 'location', label: 'Location', type: 'text', group: 'Details', placeholder: '1234 Riverdale Rd, Ogden' },
  { key: 'phone', label: 'Phone', type: 'text', group: 'Details', placeholder: '(801) 555-0100' },
  {
    key: 'websiteUrl',
    label: 'Website / link',
    type: 'text',
    group: 'Details',
    placeholder: 'youngautomotive.com/service',
    help: 'Shown as text. Not the click-through URL, which is set at launch.',
  },

  // ── Legal ──
  {
    key: 'disclaimer',
    label: 'Disclaimer',
    type: 'textarea',
    group: 'Legal',
    placeholder: 'Plus tax and shop supplies…',
    help: 'Auto-fills from the template + offer; edit to override.',
  },
];

/**
 * Starter / preview values.
 *
 * The offer FIGURES are placeholders ("XX.XX", "XX") for the same reason the
 * vehicle kind's are: a design must never look like a configured offer, and
 * preflight derives its placeholder-leak guard from exactly these entries.
 *
 * Every restriction and detail field starts EMPTY. A plausible-looking default
 * exclusion, redemption limit, phone number or address is a statement of fact
 * that nobody checked, and a default is exactly how one ships.
 */
export const customOfferDefaults: AdData = {
  dealerName: 'Oz Automotive',
  brandColor: '#4f46e5',
  logoUrl: '',
  headline: 'Ready For Winter?',
  subheadline: '',
  bodyText: '',
  ctaText: 'Schedule Service',
  offerType: 'flat_price',
  offerName: 'Synthetic Blend Oil Change',
  offerLabel: '',
  offerPrice: 'XX.XX',
  percentOff: 'XX',
  dollarOff: 'XX',
  offerPhrase: '',
  regularPrice: 'XXX',
  minimumSpend: 'XXX',
  expiration: 'Offer ends August 31',
  backgroundImage: '',
  featureImage: '',
  appliesTo: '',
  includedAllowance: '',
  exclusions: '',
  partNumber: '',
  availabilityNote: '',
  couponCode: '',
  redemptionLimit: '',
  states: '',
  eventDates: '',
  location: '',
  phone: '',
  websiteUrl: '',
  disclaimer: '',
};
