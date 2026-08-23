import { describe, it, expect } from 'vitest';
import { OFFER_TOKENS, OFFER_TOKENS_O2, offerTokensNumbered } from './offer-tokens';
import { enrichOfferFields, OFFER_TYPES } from './offer-text';
import type { AdData } from './types';

/**
 * The guard this file exists for: every computed offer field the engine publishes
 * must be bindable in the builder.
 *
 * The offer LABEL failed this for months. `assembleOffer` resolved it, the code
 * templates bound it, and the picker simply didn't list it — so every template
 * grew four near-identical label elements gated by Show For, one per offer type.
 * Nothing caught it because nothing compared the two lists.
 */

const LEASE: AdData = { offerType: 'lease', monthlyPayment: '299', leaseTerm: '36', dueAtSigning: '2999' };

/** The `_offer*` keys `enrichOfferFields` adds for the first offer. */
function computedKeys(data: AdData): string[] {
  const before = new Set(Object.keys(data));
  return Object.keys(enrichOfferFields(data))
    .filter((k) => !before.has(k))
    .filter((k) => k.startsWith('_offer'));
}

describe('every computed offer field is bindable', () => {
  it('offers all six the engine publishes, and nothing it does not', () => {
    const computed = computedKeys(LEASE).sort();
    const offered = OFFER_TOKENS.map((t) => t.key).sort();
    expect(offered).toEqual(computed);
  });

  it('offers the label — the one that was missing', () => {
    const label = OFFER_TOKENS.find((t) => t.key === '_offerLabel');
    expect(label, 'the offer label must be bindable').toBeTruthy();
    expect(label!.hint).toMatch(/per offer type/i);
  });

  it('resolves the label for every offer type, so one element covers them all', () => {
    // What makes a single label element sufficient. If a type ever resolved to
    // nothing, a designer would need a hand-built element for it again.
    for (const t of OFFER_TYPES) {
      const enriched = enrichOfferFields({ ...LEASE, offerType: t.value });
      expect(String(enriched._offerLabel ?? ''), t.value).not.toBe('');
    }
  });

  it('the per-ad Offer label field still overrides the computed one', () => {
    const enriched = enrichOfferFields({ ...LEASE, offerLabel: 'SPRING SPECIAL' });
    expect(enriched._offerLabel).toBe('SPRING SPECIAL');
  });
});

describe('the second offer twins the first', () => {
  it('maps every token to its o2_ key and names it Offer 2', () => {
    expect(OFFER_TOKENS_O2.map((t) => t.key)).toEqual(OFFER_TOKENS.map((t) => t.key.replace('_offer', '_o2_offer')));
    for (const t of OFFER_TOKENS_O2) expect(t.label).toMatch(/^Offer 2/);
  });

  it('matches what the engine publishes for a second offer', () => {
    const data: AdData = { ...LEASE, o2_offerType: 'apr', o2_aprRate: '1.9', o2_aprTerm: '60' };
    const before = new Set(Object.keys(data));
    const computed = Object.keys(enrichOfferFields(data))
      .filter((k) => !before.has(k) && k.startsWith('_o2_offer'))
      .sort();
    expect(OFFER_TOKENS_O2.map((t) => t.key).sort()).toEqual(computed);
  });

  it('numbers the first offer only when there are two', () => {
    for (const t of offerTokensNumbered()) expect(t.label).toMatch(/^Offer 1/);
  });
});

describe('every token explains itself', () => {
  it('has a label and a hint', () => {
    for (const t of [...OFFER_TOKENS, ...OFFER_TOKENS_O2]) {
      expect(t.label.length, t.key).toBeGreaterThan(2);
      expect(t.hint.length, t.key).toBeGreaterThan(10);
    }
  });
});
