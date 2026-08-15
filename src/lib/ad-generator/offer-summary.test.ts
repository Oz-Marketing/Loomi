import { describe, it, expect } from 'vitest';
import { calculatedRows, boardValues, boardValuesText } from './offer-summary';
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

describe('boardValues', () => {
  it('carries the offer facts and the composed disclaimer', () => {
    const rows = boardValues({ data: LEASE, disclaimer: 'Closed end lease…' });
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel.Vehicle).toBe('2026 Audi Q5 Premium');
    expect(byLabel['Offer type']).toBe('Lease');
    expect(byLabel.VIN).toBe('WAUZZZ8V9KA000123');
    expect(byLabel.MSRP).toBe('$45,630');
    expect(byLabel['Dealer code']).toBe('32-1234');
    expect(byLabel.Disclaimer).toBe('Closed end lease…');
  });

  it('omits fields that are empty instead of emitting blank rows', () => {
    const rows = boardValues({ data: { offerType: 'lease' }, disclaimer: 'x' });
    expect(rows.some((r) => r.label === 'VIN')).toBe(false);
    expect(rows.some((r) => r.label === 'Dealer code')).toBe(false);
  });

  it('leaves an MSRP the user already formatted exactly as typed', () => {
    const rows = boardValues({ data: { ...LEASE, msrp: '$45,630' }, disclaimer: 'x' });
    expect(rows.find((r) => r.label === 'MSRP')?.value).toBe('$45,630');
  });

  // "Needs review" is always present. A missing row would read as "no problems
  // found" when it actually means "nobody checked".
  it('always emits Needs review, naming what is missing', () => {
    const clean = boardValues({ data: LEASE, disclaimer: 'x' });
    expect(clean.at(-1)).toEqual({ label: 'Needs review', value: 'No' });

    const flagged = boardValues({
      data: LEASE,
      disclaimer: 'x',
      missingFields: [{ key: 'securityDeposit', label: 'Security deposit' }],
    });
    expect(flagged.at(-1)?.value).toBe('Yes — missing Security deposit');
  });

  // Co-op standing is held per template in the approval record. Deciding it here
  // would be a guess presented as a system of record.
  it('does not emit a co-op status', () => {
    const rows = boardValues({ data: LEASE, disclaimer: 'x' });
    expect(rows.some((r) => /co-?op/i.test(r.label))).toBe(false);
  });
});

describe('boardValuesText', () => {
  it('renders one Label: value per line for the clipboard', () => {
    const text = boardValuesText([
      { label: 'Vehicle', value: '2026 Audi Q5' },
      { label: 'Needs review', value: 'No' },
    ]);
    expect(text).toBe('Vehicle: 2026 Audi Q5\nNeeds review: No');
  });
});
