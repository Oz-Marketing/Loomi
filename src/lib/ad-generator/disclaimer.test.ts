import { describe, it, expect } from 'vitest';
import { buildTokenValues, substituteTokens, composeDisclaimer } from './disclaimer';

describe('substituteTokens', () => {
  it('fills known tokens and leaves unfilled ones visible', () => {
    const out = substituteTokens('{apr_rate}% APR for {apr_term} months via {missing}', {
      apr_rate: '1.9',
      apr_term: '60',
    });
    expect(out).toBe('1.9% APR for 60 months via {missing}');
  });
});

describe('buildTokenValues', () => {
  it('formats money fields and uppercases the VIN', () => {
    const v = buildTokenValues({
      offerType: 'lease',
      monthlyPayment: '299',
      msrp: '42000',
      vin: 'wbadt43452g928370',
    });
    expect(v.monthly_payment).toBe('$299');
    expect(v.msrp).toBe('$42,000');
    expect(v.vin).toBe('WBADT43452G928370');
  });

  it('omits empty fields entirely (so their tokens stay visible)', () => {
    const v = buildTokenValues({ offerType: 'apr', aprRate: '1.9' });
    // apr_rate carries its own percent sign (templates write `{apr_rate} APR`).
    expect(v.apr_rate).toBe('1.9%');
    expect(v).not.toHaveProperty('msrp');
  });
});

describe('composeDisclaimer', () => {
  it('uses the per-offer-type default and appends the dealer-fee boilerplate', () => {
    const out = composeDisclaimer({
      offerType: 'lease',
      monthlyPayment: '299',
      leaseTerm: '36',
      dueAtSigning: '2999',
    });
    expect(out).toContain('$299/month for 36 months, $2,999 due at signing');
    expect(out).toContain('dealer-imposed fees');
  });

  it('prefers a provided template body over the default', () => {
    const out = composeDisclaimer(
      // apr_rate already carries its %, so the template writes `{apr_rate}` (no
      // literal % — that would double it).
      { offerType: 'apr', aprRate: '0.9', aprTerm: '48' },
      '{apr_rate} for {apr_term} mo. — special.',
    );
    expect(out).toContain('0.9% for 48 mo. — special.');
  });

  it('appends VIN + Stock# when provided', () => {
    const out = composeDisclaimer({
      offerType: 'sales_price',
      salePrice: '28995',
      vin: 'abc123',
      stockNumber: 'H4421A',
    });
    expect(out).toContain('VIN: ABC123');
    expect(out).toContain('Stock#: H4421A');
  });

  it('does not double-append the boilerplate if the template already has it', () => {
    const out = composeDisclaimer(
      { offerType: 'custom' },
      'Custom terms. Advertised price includes all dealer-imposed fees.',
    );
    expect(out.match(/dealer-imposed fees/g)?.length).toBe(1);
  });

  // Manufacturer language says "and dealer fees", not "dealer-imposed fees".
  // Appending the boilerplate to it produced a disclaimer that asserted fees were
  // both included and excluded, one sentence apart.
  it('suppresses the fee boilerplate when the body already excludes dealer fees', () => {
    const out = composeDisclaimer(
      { offerType: 'lease' },
      'Excludes tax, title, license, options and dealer fees.',
    );
    expect(out).not.toContain('dealer-imposed fees');
    expect(out).toBe('Excludes tax, title, license, options and dealer fees.');
  });

  it('does not append a second VIN when the body already carries one', () => {
    const out = composeDisclaimer(
      { offerType: 'lease', vin: 'abc123', stockNumber: 'H4421A' },
      'Lease terms. VIN: {vin}. Stock {stock_number}.',
    );
    expect(out.match(/ABC123/g)?.length).toBe(1);
    expect(out.match(/H4421A/g)?.length).toBe(1);
  });
});

describe('full-length OEM lease clauses', () => {
  const LEASE = {
    offerType: 'lease',
    monthlyPayment: '389',
    leaseTerm: '36',
    msrp: '45630',
    sellingPrice: '42500',
    customerDown: '3999',
    acquisitionFee: '699',
    dispositionFee: '395',
    milesPerYear: '10000',
    overageRate: '$0.20',
    states: 'ID; UT; WA',
    dealerCode: '32-1234',
  };

  it('formats the new lease fields', () => {
    const v = buildTokenValues(LEASE);
    expect(v.selling_price).toBe('$42,500');
    expect(v.customer_down).toBe('$3,999');
    expect(v.acquisition_fee).toBe('$699');
    expect(v.disposition_fee).toBe('$395');
    expect(v.miles_per_year).toBe('10,000');
    expect(v.overage_rate).toBe('$0.20');
    expect(v.states).toBe('ID; UT; WA');
    expect(v.dealer_code).toBe('32-1234');
  });

  it('derives total miles and the payments total from the lease term', () => {
    const v = buildTokenValues(LEASE);
    expect(v.total_miles).toBe('30,000'); // 10,000/yr × (36 ÷ 12)
    expect(v.monthly_payments_total).toBe('$14,004'); // $389 × 36
  });

  it('derives the payments total from the APR term on a finance offer', () => {
    const v = buildTokenValues({
      offerType: 'apr',
      monthlyPayment: '549',
      aprTerm: '60',
      leaseTerm: '36', // stale lease value must not win
    });
    expect(v.monthly_payments_total).toBe('$32,940'); // $549 × 60, not × 36
  });

  it('omits total miles on a finance offer — there is no mileage allowance', () => {
    const v = buildTokenValues({
      offerType: 'apr',
      aprTerm: '60',
      milesPerYear: '10000',
    });
    expect(v).not.toHaveProperty('total_miles');
  });

  it('omits derived values rather than guessing when an input is missing', () => {
    const v = buildTokenValues({ offerType: 'lease', monthlyPayment: '389' });
    expect(v).not.toHaveProperty('monthly_payments_total');
    expect(v).not.toHaveProperty('total_miles');
  });

  it('keeps customer down distinct from due at signing', () => {
    const v = buildTokenValues({ ...LEASE, dueAtSigning: '5087' });
    expect(v.customer_down).toBe('$3,999');
    expect(v.due_at_signing).toBe('$5,087');
  });
});
