import { describe, it, expect } from 'vitest';
import { offerTypeAccent, offerTypePill, offerTypeShort } from './offer-type-style';
import { OFFER_KINDS } from './offer-kinds';

/**
 * The palette is a claim of identity — violet means APR on the canvas tabs, in the
 * variable picker and on the proof sheet. These hold it to being complete (every
 * type a kind offers can be drawn) and stable (the hues the builder shipped with).
 */

describe('every offer type can be drawn', () => {
  const types = OFFER_KINDS.flatMap((k) => k.offerTypes.map((t) => t.value));

  it('gives every type an accent', () => {
    for (const t of types) expect(offerTypeAccent(t), t).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('gives every type a name short enough for a pill', () => {
    for (const t of types) {
      const label = offerTypeShort(t);
      expect(label.length, `${t}: ${label}`).toBeGreaterThan(1);
      expect(label.length, `${t}: ${label}`).toBeLessThanOrEqual(15);
    }
  });

  it('never returns a bare offer type id as a label', () => {
    for (const t of types) expect(offerTypeShort(t), t).not.toBe(t);
  });
});

describe('the hues are the ones the builder shipped with', () => {
  it('keeps the vehicle kind palette', () => {
    // Changing one of these re-tints an offer type everywhere at once, which is
    // the point — but it should be a deliberate edit, not a drift.
    expect(offerTypeAccent('lease')).toBe('#3b82f6');
    expect(offerTypeAccent('apr')).toBe('#8b5cf6');
    expect(offerTypeAccent('discount')).toBe('#f59e0b');
    expect(offerTypeAccent('sales_price')).toBe('#10b981');
  });

  it('shortens the two labels that are too long for a pill', () => {
    expect(offerTypeShort('discount')).toBe('Discount');
    expect(offerTypeShort('sales_price')).toBe('Sale price');
  });

  it('falls back to the spec label when that is already short', () => {
    expect(offerTypeShort('lease')).toBe('Lease');
  });
});

describe('an unknown type is grey, not broken', () => {
  it('returns the neutral for a retired or misspelled type', () => {
    expect(offerTypeAccent('lease_special_2019')).toBe('#64748b');
    expect(offerTypeShort('lease_special_2019')).toBe('lease_special_2019');
  });

  it('reads "Any" for no type at all', () => {
    expect(offerTypeShort(undefined)).toBe('Any');
    expect(offerTypeShort('')).toBe('Any');
  });
});

describe('a pill derives its border and fill from the accent', () => {
  it('uses the same hue at three opacities', () => {
    const pill = offerTypePill('apr');
    expect(pill.color).toBe('#8b5cf6');
    expect(pill.borderColor).toBe('#8b5cf666');
    expect(pill.backgroundColor).toBe('#8b5cf61f');
  });
});
