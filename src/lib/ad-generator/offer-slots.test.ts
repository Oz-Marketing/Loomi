import { describe, it, expect } from 'vitest';
import {
  OFFER_SLOT_RE,
  offerFieldPrefix,
  offerSlotBaseKey,
  offerSlotIndex,
  offerSlotPrefix,
  offerSlotPrefixes,
} from './doc-types';
import { enrichOfferFields } from './offer-text';
import { offerTokensForSlot, OFFER_TOKENS, OFFER_TOKENS_O2 } from './offer-tokens';
import { preflight } from './preflight';
import type { TemplateDoc, DocElement } from './doc-types';
import type { AdData } from './types';

/**
 * OFFER SLOTS ARE A LIST, not a pair.
 *
 * The doc format always allowed a third offer — a plate with `offerIndex: 2` reads
 * `o3_*` — but the engine iterated the literal `['', 'o2_']` in half a dozen
 * places. A third offer therefore got no computed values, no placeholder guard and
 * no compliance check, while looking to a designer like any other offer. These
 * hold the engine to the format.
 */

describe('the prefix is one rule', () => {
  it('names each slot', () => {
    expect(offerSlotPrefix(0)).toBe('');
    expect(offerSlotPrefix(1)).toBe('o2_');
    expect(offerSlotPrefix(2)).toBe('o3_');
    expect(offerSlotPrefix(4)).toBe('o5_');
  });

  it('agrees with what a plate reads', () => {
    expect(offerFieldPrefix({ offerIndex: 2 })).toBe('o3_');
    expect(offerFieldPrefix({})).toBe('');
  });

  it('reads a slot back off a key', () => {
    expect(offerSlotIndex('o3_monthlyPayment')).toBe(2);
    expect(offerSlotIndex('monthlyPayment')).toBe(0);
    expect(offerSlotBaseKey('o3_monthlyPayment')).toBe('monthlyPayment');
    expect(offerSlotBaseKey('monthlyPayment')).toBe('monthlyPayment');
    // Not a slot prefix: a field that merely starts with the letter o.
    expect(offerSlotBaseKey('offerType')).toBe('offerType');
    expect(OFFER_SLOT_RE.test('offerType')).toBe(false);
  });

  it('finds every slot the data carries, first one always', () => {
    expect(offerSlotPrefixes({})).toEqual(['']);
    expect(offerSlotPrefixes({ offerType: 'lease' })).toEqual(['']);
    expect(offerSlotPrefixes({ offerType: 'lease', o2_offerType: 'apr' })).toEqual(['', 'o2_']);
    expect(offerSlotPrefixes({ o3_offerType: 'discount', o2_offerType: 'apr' })).toEqual(['', 'o2_', 'o3_']);
  });

  it('ignores a key that merely ends in offerType without a slot', () => {
    expect(offerSlotPrefixes({ customOfferType: 'x' })).toEqual(['']);
  });
});

describe('a third offer is computed like the first two', () => {
  const data: AdData = {
    offerType: 'lease',
    monthlyPayment: '299',
    leaseTerm: '36',
    o2_offerType: 'apr',
    o2_aprRate: '1.9',
    o2_financeTerm: '60',
    o3_offerType: 'discount',
    o3_discountAmount: '2500',
  };
  const out = enrichOfferFields(data);

  it('publishes the third offer display fields', () => {
    // This is the bug: before, `_o3_offerMain` was never computed, so a plate
    // bound to it rendered the em-dash placeholder on a live ad.
    expect(out._o3_offerMain).toBe('$2,500');
    expect(out._o3_offerLabel).toBeTruthy();
  });

  it('leaves the first two exactly as they were', () => {
    expect(out._offerMain).toBe('$299/mo');
    expect(out._o2_offerMain).toBe('1.9%');
  });

  it('computes nothing for a slot the data does not carry', () => {
    expect(enrichOfferFields({ offerType: 'lease', monthlyPayment: '299' })._o2_offerMain).toBeUndefined();
  });
});

describe('a third offer is checked like the first two', () => {
  const plate = (id: string, offerIndex: number): DocElement =>
    ({ id, type: 'offer', offerIndex }) as DocElement;

  const doc: TemplateDoc = {
    id: 'three',
    name: 'Three offers',
    sizes: [{ id: 'sq', label: 'Square', width: 1080, height: 1080 }],
    fields: [],
    elements: [plate('o1', 0), plate('o2', 1), plate('o3', 2)],
    layouts: { sq: { o1: { x: 0, y: 0, w: 0.3, h: 0.2, z: 1 }, o2: { x: 0.35, y: 0, w: 0.3, h: 0.2, z: 1 }, o3: { x: 0.7, y: 0, w: 0.3, h: 0.2, z: 1 } } },
    defaults: {},
  } as TemplateDoc;

  it('catches a placeholder in the third offer', () => {
    // `X,XXX` is the canonical placeholder. Unguarded, an unattended run would
    // have published it.
    const r = preflight({
      doc,
      data: {
        offerType: 'lease', monthlyPayment: '299', leaseTerm: '36',
        o2_offerType: 'lease', o2_monthlyPayment: '349', o2_leaseTerm: '36',
        o3_offerType: 'lease', o3_monthlyPayment: 'X,XXX', o3_leaseTerm: '36',
      },
    });
    // The field reported is the COMPUTED one the plate renders, `_o3_offerMain` —
    // not the raw `o3_monthlyPayment` that fed it.
    expect(r.issues.some((i) => i.code === 'placeholder_value' && i.field === '_o3_offerMain')).toBe(true);
  });

  it('exempts the third offer terms, like the first two', () => {
    const r = preflight({
      doc,
      data: {
        offerType: 'lease', monthlyPayment: '299', leaseTerm: '36',
        o3_offerType: 'apr', o3_aprRate: '1.9',
      },
    });
    // An APR programme with no stated term has no terms line, and that is not a
    // hole — whichever slot it is in.
    expect(r.issues.some((i) => i.code === 'empty_binding' && i.field === '_o3_offerTerms')).toBe(false);
  });
});

describe('the picker can name any slot', () => {
  it('numbers a slot own tokens', () => {
    const third = offerTokensForSlot(2);
    expect(third.map((t) => t.key)).toContain('_o3_offerMain');
    expect(third[0].label).toContain('Offer 3');
  });

  it('leaves the first slot keys unprefixed', () => {
    expect(offerTokensForSlot(0).map((t) => t.key)).toEqual(OFFER_TOKENS.map((t) => t.key));
  });

  it('still produces what the dual builder binds today', () => {
    expect(OFFER_TOKENS_O2.map((t) => t.key)).toEqual(offerTokensForSlot(1).map((t) => t.key));
    expect(OFFER_TOKENS_O2).toHaveLength(OFFER_TOKENS.length);
  });
});

describe('an offer plate is inspected at all', () => {
  /**
   * The plate arrived with Phase 2 and preflight was never taught about it: it
   * only looked at elements whose `binding.kind === 'field'`, and a plate has no
   * binding. So a plate-based design — which is what the builder's Offer element
   * creates — got NO placeholder guard, and on the unattended pipeline that means
   * publishing "$X,XXX/mo".
   */
  const plateDoc = (offerIndex = 0): TemplateDoc =>
    ({
      id: 't',
      name: 'T',
      sizes: [{ id: 'sq', label: 'Square', width: 1080, height: 1080 }],
      fields: [],
      elements: [{ id: 'plate', type: 'offer', offerIndex }],
      layouts: { sq: { plate: { x: 0.1, y: 0.1, w: 0.8, h: 0.3, z: 1 } } },
      defaults: {},
    }) as unknown as TemplateDoc;

  it('blocks a plate that would render the placeholder figure', () => {
    const r = preflight({ doc: plateDoc(), data: { offerType: 'lease', monthlyPayment: 'X,XXX', leaseTerm: '36' } });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'placeholder_value' && i.field === '_offerMain')).toBe(true);
  });

  it('passes a plate with real numbers', () => {
    const r = preflight({ doc: plateDoc(), data: { offerType: 'lease', monthlyPayment: '299', leaseTerm: '36' } });
    expect(r.issues.map((i) => `${i.code}:${i.field}`)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('reports the plate keys as bound, so a run log shows what it read', () => {
    const r = preflight({ doc: plateDoc(), data: { offerType: 'lease', monthlyPayment: '299', leaseTerm: '36' } });
    expect(r.boundFields).toContain('_offerMain');
    expect(r.boundFields).toContain('_offerLabel');
  });

  it('reads the slot its own offerIndex names', () => {
    const r = preflight({
      doc: plateDoc(1),
      data: { offerType: 'lease', monthlyPayment: '299', leaseTerm: '36', o2_offerType: 'lease', o2_monthlyPayment: 'X,XXX', o2_leaseTerm: '36' },
    });
    expect(r.issues.some((i) => i.field === '_o2_offerMain')).toBe(true);
    // The first offer is fine and must not be blamed for the second's placeholder.
    expect(r.issues.some((i) => i.field === '_offerMain')).toBe(false);
  });
});
