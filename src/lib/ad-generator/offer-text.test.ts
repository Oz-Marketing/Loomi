import { describe, it, expect } from 'vitest';
import { assembleOffer } from './offer-text';

describe('assembleOffer', () => {
  it('assembles a lease offer with formatted money + term', () => {
    const o = assembleOffer({
      offerType: 'lease',
      monthlyPayment: '299',
      leaseTerm: '36',
      dueAtSigning: '2999',
    });
    expect(o).toEqual({
      label: 'LEASE FOR',
      main: '$299/mo',
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
    expect(o?.label).toBe('FINANCE AT');
    expect(o?.main).toBe('1.9% APR');
    expect(o?.terms).toBe('for 60 months · through Toyota Financial');
  });

  it('handles discount Off-MSRP vs Cash Back styles', () => {
    const off = assembleOffer({ offerType: 'discount', discountAmount: '3000', msrp: '42000', discountLabelStyle: 'off_msrp' });
    expect(off).toEqual({ label: 'SAVE', main: '$3,000', terms: 'Off MSRP $42,000' });

    const cash = assembleOffer({ offerType: 'discount', discountAmount: '3000', msrp: '42000', discountLabelStyle: 'cash_back' });
    expect(cash?.label).toBe('CASH BACK');
    expect(cash?.terms).toBe('MSRP $42,000');
  });

  it('assembles a sales-price offer', () => {
    const o = assembleOffer({ offerType: 'sales_price', salePrice: '28995', msrp: '34000' });
    expect(o).toEqual({ label: 'SALE PRICE', main: '$28,995', terms: 'MSRP $34,000' });
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

  it('assembles a second offer from a prefixed field set (dual offers)', () => {
    const data = { offerType: 'lease', monthlyPayment: '299', o2_offerType: 'apr', o2_aprRate: '0', o2_aprTerm: '60' };
    expect(assembleOffer(data)?.main).toBe('$299/mo'); // default prefix → offer 1
    const offer2 = assembleOffer(data, 'o2_');
    expect(offer2?.main).toBe('0% APR');
    expect(offer2?.terms).toContain('60 months');
  });
});
