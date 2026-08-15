import { describe, it, expect } from 'vitest';
import { calculatedRows } from './offer-summary';
import { buildTokenValues } from './disclaimer';

const LEASE = {
  offerType: 'lease',
  vehicleName: '2026 Audi Q5 Premium',
  monthlyPayment: '389',
  leaseTerm: '36',
  milesPerYear: '10000',
  msrp: '45630',
  expiration: 'June 30, 2026',
  vin: 'wauzzz8v9ka000123',
  dealerCode: '32-1234',
  states: 'ID; UT; WA',
};

describe('calculatedRows', () => {
  it('shows each derived figure with the arithmetic that produced it', () => {
    const rows = calculatedRows(LEASE);
    expect(rows).toEqual([
      { label: 'Monthly payments total', value: '$14,004', math: '$389 × 36 mo' },
      { label: 'Total lease miles', value: '30,000', math: '10,000/yr × (36 ÷ 12)' },
    ]);
  });

  // The panel exists to let someone verify the legal text. If the two were
  // derived separately they could disagree, and the reader would have no way to
  // know which one shipped.
  it('agrees exactly with the values the disclaimer carries', () => {
    const rows = calculatedRows(LEASE);
    const tokens = buildTokenValues(LEASE);
    expect(rows[0].value).toBe(tokens.monthly_payments_total);
    expect(rows[1].value).toBe(tokens.total_miles);
  });

  it('omits a figure whose inputs are missing rather than showing a blank', () => {
    expect(calculatedRows({ offerType: 'lease', monthlyPayment: '389' })).toEqual([]);
  });

  it('drops total miles for a finance offer but keeps the payments total', () => {
    const rows = calculatedRows({
      offerType: 'apr',
      monthlyPayment: '549',
      aprTerm: '60',
      milesPerYear: '10000',
    });
    expect(rows.map((r) => r.label)).toEqual(['Monthly payments total']);
    expect(rows[0].math).toBe('$549 × 60 mo');
  });
});
