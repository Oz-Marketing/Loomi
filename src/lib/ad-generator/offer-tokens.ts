/**
 * The computed offer fields a designer can bind an element to.
 *
 * `enrichOfferFields` assembles six values from the structured offer inputs —
 * label, formatted amount, bare number, the `$`, the `%`, and the terms line —
 * and publishes them as `_offer*` (plus `_o2_offer*` for a second offer). This is
 * the list the builder's binding picker offers, with the wording a designer
 * reads.
 *
 * IT LIVES HERE, not in the builder page, for one reason: a test can now assert
 * that every computed field the engine publishes is actually offered. The offer
 * LABEL was missing from the picker for months — the engine resolved it, the code
 * templates bound it, and only the builder withheld it, which is why every
 * template grew a hand-built label element per offer type gated by Show For.
 * `offer-tokens.test.ts` is the guard that stops the next one.
 *
 * See docs/ad-generator-archetypes.md §1, §8 Phase 1.
 */

import { offerSlotPrefix } from './doc-types';

export interface OfferToken {
  /** The `AdData` key, as bound (`field:<key>`). */
  key: string;
  /** What the picker calls it. */
  label: string;
  /** One line on what it is for, shown under the label. */
  hint: string;
}

/** The first offer's computed fields, in the order the picker lists them. */
export const OFFER_TOKENS: OfferToken[] = [
  {
    key: '_offerLabel',
    label: 'Offer label',
    hint: 'The line above the number, per offer type — PER MONTH LEASE · APR · OFF MSRP · SALES PRICE. One element covers every type; the Offer label field overrides it on a single ad.',
  },
  {
    key: '_offerMain',
    label: 'Offer amount',
    hint: 'The whole amount, formatted — $299/mo · 1.9% · $28,995. Pairs with the offer label above it.',
  },
  {
    key: '_offerValue',
    label: 'Offer number (no symbol)',
    hint: 'Just the digits — 299 · 1.9 · 28,995. Pair with the symbols below to style them separately.',
  },
  { key: '_offerCurrency', label: 'Offer $ symbol', hint: 'A “$”, and only when the offer is an amount' },
  { key: '_offerPercent', label: 'Offer % symbol', hint: 'A “%”, and only when the offer is a rate' },
  {
    key: '_offerTerms',
    label: 'Offer terms',
    hint: 'The small line under the number — 36 months, $2,999 due at signing',
  },
];

/**
 * One offer slot's tokens, named for the offer they belong to.
 *
 * `index` is 0-based, matching `offerSlotPrefix` and a plate's `offerIndex`, so a
 * third offer needs no new export here — which is the point. `OFFER_TOKENS_O2` was
 * that new export, and it was the reason every caller had to know how many offers
 * existed.
 */
export function offerTokensForSlot(index: number): OfferToken[] {
  const prefix = offerSlotPrefix(index);
  return OFFER_TOKENS.map((t) => ({
    key: prefix ? t.key.replace('_offer', `_${prefix}offer`) : t.key,
    label: t.label.replace('Offer', `Offer ${index + 1}`),
    hint: t.hint,
  }));
}

/** The second offer's twins, on a dual template. */
export const OFFER_TOKENS_O2: OfferToken[] = offerTokensForSlot(1);

/** The first offer's tokens, named "Offer 1" for a template that has two. */
export function offerTokensNumbered(): OfferToken[] {
  return offerTokensForSlot(0);
}
