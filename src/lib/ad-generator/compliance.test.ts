import { describe, it, expect } from 'vitest';
import { requiredFieldsFor, missingRequired, parseOemRule } from './compliance';

describe('requiredFieldsFor', () => {
  it('returns the baseline when there is no OEM rule', () => {
    expect(requiredFieldsFor('lease')).toEqual(['monthlyPayment', 'leaseTerm']);
    expect(requiredFieldsFor('apr')).toEqual(['aprRate', 'aprTerm']);
    expect(requiredFieldsFor('custom')).toEqual([]);
  });

  it('unions the baseline with the OEM rule (no duplicates)', () => {
    const rule = { make: 'GM', requiredFields: { apr: ['vin', 'aprTerm', 'financialInstitution'] } };
    expect(requiredFieldsFor('apr', rule)).toEqual(['aprRate', 'aprTerm', 'vin', 'financialInstitution']);
  });
});

describe('missingRequired', () => {
  it('flags empty baseline fields', () => {
    const missing = missingRequired({ offerType: 'lease', monthlyPayment: '299' });
    expect(missing.map((m) => m.key)).toEqual(['leaseTerm']);
    expect(missing[0].label).toBe('Lease term');
  });

  it('is empty when all required fields are filled', () => {
    expect(missingRequired({ offerType: 'lease', monthlyPayment: '299', leaseTerm: '36' })).toEqual([]);
  });

  it('treats whitespace-only values as missing', () => {
    const missing = missingRequired({ offerType: 'sales_price', salePrice: '   ' });
    expect(missing.map((m) => m.key)).toEqual(['salePrice']);
  });

  it('applies OEM-specific requirements on top of the baseline', () => {
    const rule = { make: 'GM', requiredFields: { apr: ['vin', 'financialInstitution'] } };
    const missing = missingRequired({ offerType: 'apr', aprRate: '1.9', aprTerm: '60' }, rule);
    expect(missing.map((m) => m.key).sort()).toEqual(['financialInstitution', 'vin']);
  });
});

describe('parseOemRule', () => {
  it('parses a valid rule and drops non-array / non-string entries', () => {
    const rule = parseOemRule('GM', JSON.stringify({ apr: ['vin', 1, 'aprTerm'], lease: 'nope' }));
    expect(rule).toEqual({ make: 'GM', requiredFields: { apr: ['vin', 'aprTerm'] } });
  });

  it('returns null on invalid JSON', () => {
    expect(parseOemRule('GM', 'not json')).toBeNull();
  });
});
