import { describe, expect, it } from 'vitest';
import { changedOfferFields, offerFieldKeys, offerValuesChanged } from './offer-edit';

const base = {
  offerType: 'lease',
  monthlyPayment: '329',
  leaseTerm: '36',
  dueAtSigning: '3999',
  expiration: '2026-09-30',
  vehicleName: '2026 Honda CR-V',
  disclaimer: 'Ends 9/30. With approved credit.',
};

describe('offerValuesChanged', () => {
  it('is false for an identical save', () => {
    // The form autosaves as you type and posts the whole blob, so an unchanged
    // save must not mark the ad.
    expect(offerValuesChanged(base, { ...base })).toBe(false);
  });

  it('catches a changed payment', () => {
    expect(offerValuesChanged(base, { ...base, monthlyPayment: '299' })).toBe(true);
  });

  it('catches a changed expiration', () => {
    // Moving the date an offer runs to changes what is advertised.
    expect(offerValuesChanged(base, { ...base, expiration: '2026-10-31' })).toBe(true);
  });

  it('catches a changed second-slot offer', () => {
    const dual = { ...base, o2_offerType: 'apr', o2_aprRate: '3.9' };
    expect(offerValuesChanged(dual, { ...dual, o2_aprRate: '1.9' })).toBe(true);
  });

  it('ignores the vehicle name', () => {
    // A corrected name or a different trim is not a change to the terms.
    expect(offerValuesChanged(base, { ...base, vehicleName: '2026 Honda CR-V EX' })).toBe(false);
  });

  it('ignores the disclaimer', () => {
    // The disclaimer is recomposed from the offer rather than being one of its
    // values; treating it as an edit would mark every regeneration.
    expect(offerValuesChanged(base, { ...base, disclaimer: 'Different wording.' })).toBe(false);
  });

  it('ignores generation bookkeeping', () => {
    expect(offerValuesChanged(base, { ...base, _oemApplied: '1', _oemZip: '84041' })).toBe(false);
  });

  it('treats absent, null and empty as the same', () => {
    // Clearing an already-empty field is not an edit.
    expect(offerValuesChanged({ ...base, msrp: '' }, { ...base })).toBe(false);
    expect(offerValuesChanged({ ...base, msrp: '  ' }, { ...base, msrp: '' })).toBe(false);
  });

  it('catches setting a field that was previously empty', () => {
    expect(offerValuesChanged({ ...base, msrp: '' }, { ...base, msrp: '38000' })).toBe(true);
  });

  it('is false when there is nothing to compare against', () => {
    // A first save has no prior version; treating that as an edit would mark
    // every newly created ad.
    expect(offerValuesChanged(null, base)).toBe(false);
  });
});

describe('changedOfferFields', () => {
  it('names the fields that moved', () => {
    const next = { ...base, monthlyPayment: '299', expiration: '2026-10-31' };
    expect(changedOfferFields(base, next).sort()).toEqual(['expiration', 'monthlyPayment']);
  });

  it('is empty when nothing moved', () => {
    expect(changedOfferFields(base, { ...base })).toEqual([]);
  });
});

describe('offerFieldKeys', () => {
  it('covers both offer slots', () => {
    const keys = offerFieldKeys();
    expect(keys).toContain('monthlyPayment');
    expect(keys).toContain('o2_monthlyPayment');
  });

  it('does not duplicate the shared fields per slot', () => {
    // `expiration` belongs to the ad, not to one of its offers.
    expect(offerFieldKeys().filter((k) => k.endsWith('expiration'))).toEqual(['expiration']);
  });
});
