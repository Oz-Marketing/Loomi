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
});
