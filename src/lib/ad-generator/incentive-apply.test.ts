import { describe, it, expect } from 'vitest';
import {
  costPerThousand,
  incentiveKey,
  incentiveToFieldPatch,
  offerTypeFor,
} from './incentive-apply';
import type { MarketCheckIncentive } from '@/lib/integrations/marketcheck';

/** A zeroed incentive — tests override only the fields they care about. */
function inc(over: Partial<MarketCheckIncentive> = {}): MarketCheckIncentive {
  return {
    id: null,
    type: 'other',
    amount: 0,
    rate: 0,
    term: 0,
    payment: 0,
    downPayment: 0,
    msrp: 0,
    trim: null,
    programName: null,
    description: '',
    offerDetails: '',
    startDate: null,
    endDate: null,
    eligibility: '',
    ...over,
  };
}

const CTX = { year: 2026, make: 'Subaru', model: 'Crosstrek' };

describe('offerTypeFor', () => {
  it('maps MarketCheck types onto generator offer types', () => {
    expect(offerTypeFor('lease')).toBe('lease');
    expect(offerTypeFor('apr')).toBe('apr');
    expect(offerTypeFor('cash')).toBe('discount');
    // Unrecognized programs fall back to the free-text custom offer.
    expect(offerTypeFor('other')).toBe('custom');
  });
});

describe('costPerThousand', () => {
  it('amortizes a financed rate', () => {
    expect(costPerThousand(1.9, 60)).toBe('17.48');
    expect(costPerThousand(4.9, 72)).toBe('16.06');
  });

  it('degrades 0% APR to the simple principal/term case', () => {
    expect(costPerThousand(0, 60)).toBe('16.67'); // 1000 / 60
  });

  it('returns null without a term to amortize over', () => {
    expect(costPerThousand(1.9, 0)).toBeNull();
  });
});

describe('incentiveKey', () => {
  it('prefers the feed id', () => {
    expect(incentiveKey(inc({ id: 'mc-123', type: 'lease' }))).toBe('mc-123');
  });

  it('falls back to type + offer prose when the row has no id', () => {
    expect(incentiveKey(inc({ type: 'lease', offerDetails: '$299/mo for 36 months' }))).toBe(
      'lease:$299/mo for 36 months',
    );
  });

  it('falls back again to the description', () => {
    expect(incentiveKey(inc({ type: 'apr', description: '1.9% APR' }))).toBe('apr:1.9% APR');
  });
});

describe('incentiveToFieldPatch — lease', () => {
  it('fills the structured lease fields, rounding money', () => {
    const patch = incentiveToFieldPatch(
      inc({ type: 'lease', payment: 299.4, term: 36, downPayment: 2999.6 }),
      CTX,
    );
    expect(patch.offerType).toBe('lease');
    expect(patch.monthlyPayment).toBe('299');
    expect(patch.leaseTerm).toBe('36');
    expect(patch.dueAtSigning).toBe('3000');
  });

  it('omits lease fields the feed did not provide', () => {
    const patch = incentiveToFieldPatch(inc({ type: 'lease', payment: 299 }), CTX);
    expect(patch.monthlyPayment).toBe('299');
    expect(patch).not.toHaveProperty('leaseTerm');
    expect(patch).not.toHaveProperty('dueAtSigning');
  });
});

describe('incentiveToFieldPatch — apr', () => {
  it('fills rate, term, and the amortized cost per $1,000', () => {
    const patch = incentiveToFieldPatch(inc({ type: 'apr', rate: 1.9, term: 60 }), CTX);
    expect(patch.offerType).toBe('apr');
    expect(patch.aprRate).toBe('1.9');
    expect(patch.aprTerm).toBe('60');
    expect(patch.costPerThousand).toBe('17.48');
  });

  it('still records a 0% APR rate (falsy, but meaningful)', () => {
    const patch = incentiveToFieldPatch(inc({ type: 'apr', rate: 0, term: 60 }), CTX);
    expect(patch.aprRate).toBe('0');
    expect(patch.costPerThousand).toBe('16.67');
  });

  it('skips cost per $1,000 without a term', () => {
    const patch = incentiveToFieldPatch(inc({ type: 'apr', rate: 1.9 }), CTX);
    expect(patch).not.toHaveProperty('costPerThousand');
  });
});

describe('incentiveToFieldPatch — cash / other', () => {
  it('maps cash onto a discount offer', () => {
    const patch = incentiveToFieldPatch(inc({ type: 'cash', amount: 2500 }), CTX);
    expect(patch.offerType).toBe('discount');
    expect(patch.discountAmount).toBe('2500');
  });

  it('maps unrecognized programs onto a custom offer with no numbers', () => {
    const patch = incentiveToFieldPatch(inc({ type: 'other', description: 'Loyalty bonus' }), CTX);
    expect(patch.offerType).toBe('custom');
    expect(patch).not.toHaveProperty('discountAmount');
    expect(patch).not.toHaveProperty('monthlyPayment');
  });
});

describe('incentiveToFieldPatch — shared fields', () => {
  it('carries MSRP', () => {
    const patch = incentiveToFieldPatch(inc({ type: 'lease', msrp: 34995.7 }), CTX);
    expect(patch.msrp).toBe('34996');
  });

  it('normalizes the offer end date to a plain ISO day', () => {
    const patch = incentiveToFieldPatch(inc({ type: 'lease', endDate: '2026-08-31T00:00:00Z' }), CTX);
    expect(patch.expiration).toBe('2026-08-31');
  });

  it('ignores an unparseable end date rather than emitting garbage', () => {
    const patch = incentiveToFieldPatch(inc({ type: 'lease', endDate: 'whenever' }), CTX);
    expect(patch).not.toHaveProperty('expiration');
  });

  it("carries the OEM's own fine print for verbatim use", () => {
    const patch = incentiveToFieldPatch(
      inc({ type: 'lease', id: 'mc-9', eligibility: '  Well-qualified lessees only.  ' }),
      CTX,
    );
    expect(patch._oemDisclaimerText).toBe('Well-qualified lessees only.');
    // Changes per apply so a fresh selection re-takes over the disclaimer.
    expect(patch._oemDisclaimer).toBe('mc-9');
  });

  it('emits empty fine print when the feed has none (leaves the composed one in place)', () => {
    const patch = incentiveToFieldPatch(inc({ type: 'lease', id: 'mc-9' }), CTX);
    expect(patch._oemDisclaimerText).toBe('');
  });
});

describe('incentiveToFieldPatch — vehicle', () => {
  it('composes the vehicle name and stashes the structured vehicle', () => {
    const patch = incentiveToFieldPatch(inc({ type: 'lease', trim: 'Premium' }), CTX);
    expect(patch.vehicleName).toBe('2026 Subaru Crosstrek Premium');
    expect(patch._vehYear).toBe('2026');
    expect(patch._vehMake).toBe('Subaru');
    expect(patch._vehModel).toBe('Crosstrek');
    expect(patch._vehTrim).toBe('Premium');
    expect(patch._oemApplied).toBe('1');
  });

  it('omits the trim key when the incentive has none', () => {
    const patch = incentiveToFieldPatch(inc({ type: 'lease' }), CTX);
    expect(patch.vehicleName).toBe('2026 Subaru Crosstrek');
    expect(patch).not.toHaveProperty('_vehTrim');
  });

  it('skips the vehicle for a dual offer riding the first offer’s vehicle', () => {
    const patch = incentiveToFieldPatch(inc({ type: 'apr', rate: 1.9, term: 60 }), {
      ...CTX,
      slot: 'o2_',
      skipVehicle: true,
    });
    expect(patch).not.toHaveProperty('o2_vehicleName');
    expect(patch).not.toHaveProperty('o2__vehMake');
    // ...but the offer itself still lands in slot 2.
    expect(patch.o2_offerType).toBe('apr');
  });
});

describe('incentiveToFieldPatch — offer slots', () => {
  it('prefixes per-offer keys but not genuinely shared ones', () => {
    const patch = incentiveToFieldPatch(
      inc({ type: 'lease', id: 'mc-1', payment: 299, term: 36, endDate: '2026-08-31' }),
      { ...CTX, slot: 'o2_', zip: '84003' },
    );
    // Per-offer.
    expect(patch.o2_offerType).toBe('lease');
    expect(patch.o2_monthlyPayment).toBe('299');
    expect(patch.o2_vehicleName).toBe('2026 Subaru Crosstrek');
    expect(patch.o2__oemApplied).toBe('1');
    // Shared across both offers.
    expect(patch.expiration).toBe('2026-08-31');
    expect(patch._oemDisclaimer).toBe('mc-1');
    expect(patch._oemSelectedKey).toBe('mc-1');
    expect(patch._oemZip).toBe('84003');
    // The unprefixed offer keys must NOT be written when filling slot 2.
    expect(patch).not.toHaveProperty('offerType');
    expect(patch).not.toHaveProperty('monthlyPayment');
  });
});
