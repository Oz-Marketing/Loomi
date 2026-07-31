import { describe, it, expect } from 'vitest';
import { requiredFieldsFor, missingRequired, parseOemRule, applyOemDefaults } from './compliance';

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

describe('OEM standing defaults', () => {
  // Subaru §6x: the ad must state whether a security deposit is required, and
  // "none required" satisfies it. MarketCheck has no such field, so before
  // defaults existed every Subaru lease failed preflight and was skipped.
  const subaru = parseOemRule(
    'Subaru',
    JSON.stringify({ lease: ['securityDeposit', 'disclaimer'] }),
    JSON.stringify({ lease: { securityDeposit: 'No security deposit required' } }),
  );

  it('reproduces the block when no default is set', () => {
    const bare = parseOemRule('Subaru', JSON.stringify({ lease: ['securityDeposit', 'disclaimer'] }));
    const data = { offerType: 'lease', disclaimer: 'x' };
    expect(missingRequired(data, bare).map((m) => m.key)).toContain('securityDeposit');
  });

  it('fills the field from the standing default', () => {
    // The baseline lease fields are unioned in by requiredFieldsFor, so a realistic
    // offer has to carry them for "nothing missing" to mean anything.
    const offer = { offerType: 'lease', disclaimer: 'x', monthlyPayment: '329', leaseTerm: '36' };
    const { data, applied } = applyOemDefaults(offer, subaru);
    expect(data.securityDeposit).toBe('No security deposit required');
    expect(missingRequired(data, subaru)).toEqual([]);
    expect(applied.map((a) => a.key)).toEqual(['securityDeposit']);
  });

  it('reports what it applied, so a draft can say the value was asserted', () => {
    // An approver has to be able to tell an assertion from a derived value.
    const { applied } = applyOemDefaults({ offerType: 'lease', disclaimer: 'x' }, subaru);
    expect(applied[0]).toMatchObject({ key: 'securityDeposit', value: 'No security deposit required' });
    expect(applied[0].label).toBeTruthy();
  });

  it('never overrides a value the offer actually carried', () => {
    const { data, applied } = applyOemDefaults(
      { offerType: 'lease', disclaimer: 'x', securityDeposit: '$395' },
      subaru,
    );
    expect(data.securityDeposit).toBe('$395');
    expect(applied).toEqual([]);
  });

  it('only fills fields that are REQUIRED for this offer type', () => {
    // A stray default must not inject content into an ad that never asked for it.
    const rule = parseOemRule(
      'Subaru',
      JSON.stringify({ lease: ['disclaimer'] }),
      JSON.stringify({ lease: { securityDeposit: 'No security deposit required' } }),
    );
    const { data, applied } = applyOemDefaults({ offerType: 'lease', disclaimer: 'x' }, rule);
    expect(data.securityDeposit).toBeUndefined();
    expect(applied).toEqual([]);
  });

  it('scopes defaults to their offer type', () => {
    const { data } = applyOemDefaults({ offerType: 'apr', disclaimer: 'x' }, subaru);
    expect(data.securityDeposit).toBeUndefined();
  });

  it('ignores blank defaults rather than satisfying a requirement with nothing', () => {
    const rule = parseOemRule(
      'Subaru',
      JSON.stringify({ lease: ['securityDeposit'] }),
      JSON.stringify({ lease: { securityDeposit: '   ' } }),
    );
    expect(rule?.defaultValues).toBeUndefined();
    expect(missingRequired({ offerType: 'lease' }, rule).map((m) => m.key)).toContain('securityDeposit');
  });

  it('survives malformed JSON', () => {
    const rule = parseOemRule('Subaru', JSON.stringify({ lease: ['disclaimer'] }), '{not json');
    expect(rule).not.toBeNull();
    expect(rule?.defaultValues).toBeUndefined();
  });
});
