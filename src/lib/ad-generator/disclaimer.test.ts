import { describe, it, expect } from 'vitest';
import {
  buildTokenValues,
  substituteTokens,
  composeDisclaimer,
  deriveOfferFigures,
  DEFAULT_DISCLAIMER_TEMPLATES,
} from './disclaimer';
import { ALL_OFFER_TYPE_SPECS } from './offer-text';
import type { AdData } from './types';

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

describe('copyright_year', () => {
  it('resolves to the year the disclaimer is composed', () => {
    const v = buildTokenValues({ offerType: 'lease' }, { now: new Date('2027-03-14T12:00:00Z') });
    expect(v.copyright_year).toBe('2027');
  });

  // The reason `now` is injected rather than read from a global clock: without
  // it the same offer composes different legal text either side of midnight on
  // 31 December, and no test can assert on it without freezing time process-wide.
  //
  // Constructed in LOCAL time on purpose. The year is the dealer's year, not
  // UTC's — a Utah store composing an ad at 5pm on 31 December is still in 2026,
  // and a UTC-based year would print 2027 on it.
  it('is stable for a given date and changes across the local year boundary', () => {
    const dec = buildTokenValues({ offerType: 'lease' }, { now: new Date(2026, 11, 31, 23, 59) });
    const jan = buildTokenValues({ offerType: 'lease' }, { now: new Date(2027, 0, 1, 0, 1) });
    expect(dec.copyright_year).toBe('2026');
    expect(jan.copyright_year).toBe('2027');
  });

  // An ad built in December for a January campaign has to be able to carry the
  // year it will actually run.
  it('honors an explicitly pinned year', () => {
    const v = buildTokenValues(
      { offerType: 'lease', copyrightYear: '2027' },
      { now: new Date('2026-12-15T12:00:00Z') },
    );
    expect(v.copyright_year).toBe('2027');
  });

  // It must ALWAYS resolve. A body ending "©{{copyright_year}} Audi of America"
  // printing a raw token on a legal line is the failure this guards against.
  it('always resolves, with no offer data at all', () => {
    expect(buildTokenValues({}).copyright_year).toMatch(/^\d{4}$/);
  });

  it('substitutes into a manufacturer copyright line', () => {
    const out = composeDisclaimer(
      { offerType: 'sales_price', salePrice: '39500' },
      'Purchase price {{sale_price}}. Excludes dealer fees. ©{{copyright_year}} Audi of America, Inc.',
      undefined,
      { now: new Date('2026-06-01T12:00:00Z') },
    );
    expect(out).toContain('©2026 Audi of America, Inc.');
    expect(out).not.toContain('{{copyright_year}}');
  });
});

describe('custom offers', () => {
  it('derives the savings from a flat price, and shows its arithmetic', () => {
    const figs = deriveOfferFigures({ offerType: 'flat_price', offerPrice: '99', regularPrice: '139' });
    expect(figs.savings_amount).toEqual({ label: 'You save', value: '$40', math: '$139 − $99' });
    expect(figs.savings_percent.value).toBe('29%');
  });

  it('derives the resulting price for a dollars-off offer before subtracting', () => {
    // A dollars-off offer states the DISCOUNT, so the advertised price has to be
    // derived first or the savings arithmetic has nothing to subtract from.
    const figs = deriveOfferFigures({ offerType: 'dollar_off', dollarOff: '50', regularPrice: '200' });
    expect(figs.savings_amount.value).toBe('$50');
    expect(figs.savings_amount.math).toBe('$200 − $150');
    expect(figs.savings_percent.value).toBe('25%');
  });

  it('states no saving at all rather than a zero or negative one', () => {
    // A regular price at or below the advertised one is a data-entry error.
    // "SAVE $0" on an ad is worse than no savings line.
    const cases: AdData[] = [
      { offerType: 'flat_price', offerPrice: '139', regularPrice: '139' },
      { offerType: 'flat_price', offerPrice: '149', regularPrice: '139' },
      { offerType: 'flat_price', offerPrice: '99' }, // no regular price given
      { offerType: 'flat_price', regularPrice: '139' }, // no advertised price
    ];
    for (const d of cases) {
      const figs = deriveOfferFigures(d);
      expect(figs.savings_amount, JSON.stringify(d)).toBeUndefined();
      expect(figs.savings_percent, JSON.stringify(d)).toBeUndefined();
    }
  });

  it('never lets a savings figure be typed', () => {
    // The whole point: there is no field for either, so a value in the data can
    // not override the arithmetic.
    const values = buildTokenValues({
      offerType: 'flat_price',
      offerPrice: '99',
      regularPrice: '139',
      savingsAmount: '$500',
      savings_amount: '$500',
    });
    expect(values.savings_amount).toBe('$40');
  });

  it('resolves the service slugs the fine print needs', () => {
    const values = buildTokenValues({
      offerType: 'flat_price',
      offerName: 'Synthetic Blend Oil Change',
      offerPrice: '79.95',
      regularPrice: '109',
      includedAllowance: 'Up to 5 quarts',
      appliesTo: 'Most vehicles',
      redemptionLimit: 'One per customer',
      couponCode: 'OIL2695',
      expiration: 'August 31',
    });
    expect(values.offer_name).toBe('Synthetic Blend Oil Change');
    expect(values.offer_price).toBe('$79.95'); // cents preserved — see `money`
    expect(values.regular_price).toBe('$109');
    expect(values.included_allowance).toBe('Up to 5 quarts');
    expect(values.applies_to).toBe('Most vehicles');
    expect(values.redemption_limit).toBe('One per customer');
    expect(values.coupon_code).toBe('OIL2695');
    expect(values.offer_end_date).toBe('August 31');
  });

  it('does NOT append the vehicle fee boilerplate to a service coupon', () => {
    // "Advertised price includes all dealer-imposed fees" is a claim about a
    // vehicle price. On an oil-change coupon it states something untrue.
    const out = composeDisclaimer({
      offerType: 'flat_price',
      offerName: 'Synthetic Blend Oil Change',
      offerPrice: '79.95',
    });
    expect(out).not.toMatch(/dealer-imposed fees/i);
    expect(out).not.toMatch(/title, and registration/i);
    expect(out).toBe('Synthetic Blend Oil Change for $79.95. See dealer for complete details.');
  });

  it('still appends it to a vehicle offer', () => {
    const out = composeDisclaimer({ offerType: 'sales_price', salePrice: '28995', msrp: '34000' });
    expect(out).toMatch(/dealer-imposed fees/i);
  });

  /**
   * KNOWN, PRE-EXISTING — three of the four vehicle default bodies reference a
   * field the type does not require, so an offer that omits it composes a
   * disclaimer containing LITERAL `{{token}}` markup:
   *
   *   lease        `{{due_at_signing}}` — required: monthlyPayment, leaseTerm
   *   discount     `{{msrp}}`           — required: discountAmount
   *   sales_price  `{{msrp}}`           — required: salePrice
   *
   * Found by this test while adding the service bodies; it predates offer kinds.
   * Only reachable on a DEFAULT body — a real `AdDisclaimerTemplate` row is what
   * most brands use — but the default is exactly what a dealer with no
   * brand template on file gets.
   *
   * NOT fixed here. Either fix is a user-facing change well outside this phase:
   * adding the field to `required` BLOCKS EXPORT on every existing ad that omits
   * it, and rewording the bodies is a change to legal text that belongs to
   * whoever owns it. Asserted below so the debt is recorded rather than hidden,
   * and so whoever fixes one is told to delete it from this list.
   */
  const KNOWN_RAW_TOKEN_TYPES = ['lease', 'discount', 'sales_price'];

  it('leaves no raw token in any code default body', () => {
    // `substituteTokens` leaves an unresolved token as a literal `{{token}}`, so a
    // default body may only reference fields its type requires. This is the guard
    // that a new type's default body can't print markup into a legal line.
    for (const spec of ALL_OFFER_TYPE_SPECS) {
      const body = DEFAULT_DISCLAIMER_TEMPLATES[spec.value];
      if (!body || KNOWN_RAW_TOKEN_TYPES.includes(spec.value)) continue;
      const data: AdData = { offerType: spec.value };
      // Fill exactly what the type declares as required, nothing more.
      for (const key of spec.required ?? []) data[key] = '10';
      const out = composeDisclaimer(data);
      expect(out, `${spec.value}: ${out}`).not.toMatch(/\{\{?[a-z_]+\}\}?/);
    }
  });

  it('still has exactly the known raw-token types, and no more', () => {
    for (const value of KNOWN_RAW_TOKEN_TYPES) {
      const spec = ALL_OFFER_TYPE_SPECS.find((t) => t.value === value)!;
      const data: AdData = { offerType: value };
      for (const key of spec.required ?? []) data[key] = '10';
      expect(
        composeDisclaimer(data),
        `${value} no longer leaks a raw token — remove it from KNOWN_RAW_TOKEN_TYPES`,
      ).toMatch(/\{\{?[a-z_]+\}\}?/);
    }
  });
});

describe('an offer type that has not been picked yet', () => {
  // A from-scratch ad's `data` starts EMPTY while the Offer-type select already
  // displays the template's default. That state composed vehicle legal text onto
  // a custom offer, because the fallback type is `custom` and `custom` belongs to
  // the vehicle kind.
  it('borrows nothing from the vehicle kind on a custom-kind ad', () => {
    const out = composeDisclaimer({}, undefined, undefined, { offerKind: 'custom' });
    // Neither the fee boilerplate...
    expect(out).not.toMatch(/dealer-imposed fees/i);
    expect(out).not.toMatch(/title, and registration/i);
    // ...nor the vehicle `custom` body. Nothing has been stated about this ad
    // yet, so the disclaimer states nothing.
    expect(out).toBe('');
  });

  it('still puts it on a vehicle-kind ad', () => {
    expect(composeDisclaimer({}, undefined, undefined, { offerKind: 'vehicle' })).toMatch(
      /dealer-imposed fees/i,
    );
    // ...and with no kind given at all, which is the pre-existing behaviour.
    expect(composeDisclaimer({})).toMatch(/dealer-imposed fees/i);
  });

  it('honours the real offer type over the kind hint once one is picked', () => {
    // The hint is a fallback, not an override: a vehicle offer type inside a
    // mis-tagged doc must still compose vehicle wording.
    const out = composeDisclaimer({ offerType: 'sales_price', salePrice: '28995' }, undefined, undefined, {
      offerKind: 'custom',
    });
    expect(out).toMatch(/dealer-imposed fees/i);
  });
});
