import { describe, it, expect } from 'vitest';
import type { AdData } from '../types';
import { offerEmailKey, offerHeadline, rankOffers } from './generate-offer-email';

describe('offerHeadline', () => {
  it('formats a lease from the ad’s own fields', () => {
    const data: AdData = {
      offerType: 'lease',
      monthlyPayment: '299',
      leaseTerm: '36',
      dueAtSigning: '2999',
    };
    expect(offerHeadline(data)).toEqual({
      headline: '$299/mo · 36 months',
      subhead: '$2,999 due at signing',
    });
  });

  it('formats APR, naming the lender when the offer carries one', () => {
    const data: AdData = {
      offerType: 'apr',
      aprRate: '1.9',
      aprTerm: '60',
      financialInstitution: 'GM Financial',
    };
    expect(offerHeadline(data)).toEqual({
      headline: '1.9% APR for 60 months',
      subhead: 'Financing through GM Financial',
    });
  });

  it('distinguishes cash back from off-MSRP discounts', () => {
    expect(
      offerHeadline({ offerType: 'discount', discountAmount: '3000', discountLabelStyle: 'cash_back' })
        .headline,
    ).toBe('$3,000 cash back');
    expect(
      offerHeadline({ offerType: 'discount', discountAmount: '3000', discountLabelStyle: 'off_msrp' })
        .headline,
    ).toBe('$3,000 off MSRP');
  });

  it('adds thousands separators', () => {
    expect(offerHeadline({ offerType: 'sales_price', salePrice: '28995', msrp: '34000' })).toEqual({
      headline: '$28,995',
      subhead: 'MSRP $34,000',
    });
  });

  it('degrades to a label rather than emitting "$/mo" when numbers are missing', () => {
    expect(offerHeadline({ offerType: 'lease' })).toEqual({
      headline: 'Lease offer',
      subhead: '',
    });
    expect(offerHeadline({ offerType: 'apr' }).headline).toBe('Financing offer');
  });

  it('falls back to the custom offer’s own price/terms', () => {
    expect(offerHeadline({ offerType: 'custom', price: '$199/mo', terms: '24 months' })).toEqual({
      headline: '$199/mo',
      subhead: '24 months',
    });
  });
});

describe('offerEmailKey', () => {
  it('is stable regardless of offer order', () => {
    // The generate loop's iteration order isn't a contract — keying on it
    // would produce a fresh draft on a run that found nothing new.
    expect(offerEmailKey('youngchev', ['a', 'b', 'c'])).toBe(
      offerEmailKey('youngchev', ['c', 'a', 'b']),
    );
  });

  it('changes when an offer joins the set', () => {
    expect(offerEmailKey('youngchev', ['a', 'b'])).not.toBe(offerEmailKey('youngchev', ['a', 'b', 'c']));
  });

  it('is scoped per account', () => {
    expect(offerEmailKey('youngchev', ['a'])).not.toBe(offerEmailKey('youngford', ['a']));
  });

  it('is namespaced so it cannot collide with a flow key', () => {
    expect(offerEmailKey('youngchev', ['a']).startsWith('adgen:youngchev:')).toBe(true);
  });
});

describe('rankOffers', () => {
  const items = [
    { offerType: 'cash', name: 'a' },
    { offerType: 'lease', name: 'b' },
    { offerType: 'apr', name: 'c' },
  ];

  it('orders by the account’s configured offer-type preference', () => {
    expect(rankOffers(items, ['lease', 'apr', 'cash'], 10).map((i) => i.name)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('caps the list', () => {
    expect(rankOffers(items, ['lease', 'apr', 'cash'], 2).map((i) => i.name)).toEqual(['b', 'c']);
  });

  it('sorts unranked types last rather than dropping them', () => {
    const out = rankOffers(items, ['apr'], 10).map((i) => i.name);
    expect(out[0]).toBe('c');
    expect(out).toHaveLength(3);
  });

  it('never returns an empty list because the cap was zero or negative', () => {
    expect(rankOffers(items, ['lease'], 0)).toHaveLength(1);
  });
});
