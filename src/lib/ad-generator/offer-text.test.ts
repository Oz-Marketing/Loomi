import { describe, it, expect } from 'vitest';
import { assembleOffer, enrichOfferFields } from './offer-text';

describe('assembleOffer', () => {
  it('assembles a lease offer with formatted money + term', () => {
    const o = assembleOffer({
      offerType: 'lease',
      monthlyPayment: '299',
      leaseTerm: '36',
      dueAtSigning: '2999',
    });
    expect(o).toEqual({
      label: 'PER MONTH LEASE',
      main: '$299/mo',
      value: '299',
      currency: '$',
      percent: '',
      terms: '36-month lease · $2,999 due at signing',
    });
  });

  it('assembles an APR offer', () => {
    const o = assembleOffer({
      offerType: 'apr',
      aprRate: '1.9',
      aprTerm: '60',
      financialInstitution: 'Toyota Financial',
    });
    expect(o?.label).toBe('APR');
    expect(o?.main).toBe('1.9% APR');
    expect(o?.value).toBe('1.9');
    expect(o?.currency).toBe('');
    expect(o?.percent).toBe('%');
    expect(o?.terms).toBe('for 60 months'); // just the term — institution rides in the disclaimer
  });

  it('handles discount Off-MSRP vs Cash Back styles', () => {
    const off = assembleOffer({ offerType: 'discount', discountAmount: '3000', msrp: '42000', discountLabelStyle: 'off_msrp' });
    expect(off).toEqual({ label: 'OFF MSRP', main: '$3,000', value: '3,000', currency: '$', percent: '', terms: 'MSRP of $42,000' });

    const cash = assembleOffer({ offerType: 'discount', discountAmount: '3000', msrp: '42000', discountLabelStyle: 'cash_back' });
    expect(cash?.label).toBe('CASH BACK'); // label still distinguishes; terms are just the MSRP
    expect(cash?.terms).toBe('MSRP of $42,000');
  });

  it('assembles a sales-price offer', () => {
    const o = assembleOffer({ offerType: 'sales_price', salePrice: '28995', msrp: '34000' });
    expect(o).toEqual({ label: 'SALES PRICE', main: '$28,995', value: '28,995', currency: '$', percent: '', terms: 'MSRP of $34,000' });
  });

  it('lets offerLabel override the default label', () => {
    const o = assembleOffer({ offerType: 'lease', offerLabel: 'DRIVE HOME FOR', monthlyPayment: '349' });
    expect(o?.label).toBe('DRIVE HOME FOR');
  });

  it('tolerates pre-formatted / messy numeric input', () => {
    const o = assembleOffer({ offerType: 'lease', monthlyPayment: '$1,299', leaseTerm: '24' });
    expect(o?.main).toBe('$1,299/mo');
    expect(o?.terms).toBe('24-month lease');
  });

  it('uses a placeholder when the key number is missing, and omits empty terms', () => {
    const o = assembleOffer({ offerType: 'lease' });
    expect(o?.main).toBe('—');
    expect(o?.terms).toBe('');
  });

  it('returns null for custom (free-text price/terms are used instead)', () => {
    expect(assembleOffer({ offerType: 'custom', price: '$299/mo' })).toBeNull();
    expect(assembleOffer({})).toBeNull(); // defaults to custom
  });

  it('enriches the _offer* display fields the doc templates bind to', () => {
    const e = enrichOfferFields({ offerType: 'lease', monthlyPayment: '299', leaseTerm: '36' });
    expect(e._offerLabel).toBe('PER MONTH LEASE');
    expect(e._offerMain).toBe('$299/mo');
    expect(e._offerTerms).toContain('36-month lease');
  });

  it('enriches a custom offer from its free-text fields', () => {
    const e = enrichOfferFields({ offerType: 'custom', price: '$0 down', terms: '0% for 72 mo' });
    expect(e._offerMain).toBe('$0 down');
    expect(e._offerTerms).toBe('0% for 72 mo');
  });

  it('enriches the second offer (o2_) when present', () => {
    const e = enrichOfferFields({ offerType: 'lease', monthlyPayment: '299', o2_offerType: 'apr', o2_aprRate: '0', o2_aprTerm: '60' });
    expect(e._offerMain).toBe('$299/mo');
    expect(e._o2_offerMain).toBe('0% APR');
  });

  it('assembles a second offer from a prefixed field set (dual offers)', () => {
    const data = { offerType: 'lease', monthlyPayment: '299', o2_offerType: 'apr', o2_aprRate: '0', o2_aprTerm: '60' };
    expect(assembleOffer(data)?.main).toBe('$299/mo'); // default prefix → offer 1
    const offer2 = assembleOffer(data, 'o2_');
    expect(offer2?.main).toBe('0% APR');
    expect(offer2?.terms).toContain('60 months');
  });
});
