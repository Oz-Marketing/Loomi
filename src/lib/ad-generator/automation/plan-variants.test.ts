import { describe, expect, it } from 'vitest';
import type { MarketCheckIncentive } from '@/lib/integrations/marketcheck';
import type { TemplateDoc } from '../doc-types';
import {
  dualVehicleModeOf,
  isDualTemplate,
  offerGroupKey,
  offersToFanOut,
  pickSecondaryOffer,
  planVariants,
  previewSizeId,
  variantExpiry,
  type PlanTemplate,
} from './plan-variants';
import type { OfferCandidate } from './select-offer';

function inc(over: Partial<MarketCheckIncentive> = {}): MarketCheckIncentive {
  return {
    id: null,
    type: 'lease',
    amount: 0,
    rate: 0,
    term: 36,
    payment: 329,
    downPayment: 0,
    msrp: 0,
    trim: null,
    programName: null,
    description: '',
    offerDetails: '',
    startDate: null,
    endDate: '2026-09-30',
    eligibility: '',
    ...over,
  };
}

function doc(over: Partial<TemplateDoc> = {}): TemplateDoc {
  return {
    sizes: [{ id: 'sq', label: 'Square', width: 1080, height: 1080 }],
    fields: [{ key: 'offerType', label: 'Offer type', type: 'text' }],
    elements: [],
    layouts: {},
    ...over,
  } as TemplateDoc;
}

function tpl(id: string, d: TemplateDoc): PlanTemplate {
  return { id, name: `Template ${id}`, doc: d };
}

const VEHICLE = { year: 2026, make: 'Chevrolet', model: 'Traverse' };

describe('isDualTemplate', () => {
  it('is dual when the doc declares any o2_ field', () => {
    expect(isDualTemplate(doc({ fields: [{ key: 'o2_offerType', label: '2', type: 'text' }] }))).toBe(true);
  });

  it('is single otherwise', () => {
    expect(isDualTemplate(doc())).toBe(false);
  });
});

describe('dualVehicleModeOf', () => {
  it('defaults to same for a doc written before the flag existed', () => {
    expect(dualVehicleModeOf(doc())).toBe('same');
  });

  it('reads an explicit two', () => {
    expect(dualVehicleModeOf(doc({ dualVehicleMode: 'two' }))).toBe('two');
  });
});

describe('previewSizeId', () => {
  it('prefers an exact square', () => {
    const d = doc({
      sizes: [
        { id: 'lb', label: 'Leaderboard', width: 728, height: 90 },
        { id: 'sq', label: 'Square', width: 1080, height: 1080 },
      ],
    });
    expect(previewSizeId(d)).toBe('sq');
  });

  it('falls back to the closest thing to square rather than giving up', () => {
    // A template of banners only must still produce a preview — refusing to
    // generate over a missing aspect ratio would lose the ad entirely.
    const d = doc({
      sizes: [
        { id: 'sky', label: 'Skyscraper', width: 160, height: 600 },
        { id: 'rect', label: 'Rectangle', width: 300, height: 250 },
        { id: 'lb', label: 'Leaderboard', width: 728, height: 90 },
      ],
    });
    expect(previewSizeId(d)).toBe('rect');
  });

  it('treats 2:1 and 1:2 as equally far from square', () => {
    const d = doc({
      sizes: [
        { id: 'wide', label: 'Wide', width: 400, height: 200 },
        { id: 'tall', label: 'Tall', width: 200, height: 400 },
      ],
    });
    // Equidistant, so the first wins — but it must not prefer landscape by
    // accident, which a naive width/height ratio would.
    expect(previewSizeId(d)).toBe('wide');
  });

  it('is null when the doc defines no sizes at all', () => {
    expect(previewSizeId(doc({ sizes: [] }))).toBeNull();
  });
});

describe('offerGroupKey', () => {
  it('is stable for the same vehicle and offer', () => {
    const a = offerGroupKey(VEHICLE, inc());
    const b = offerGroupKey(VEHICLE, inc());
    expect(a).toBe(b);
  });

  it('separates two vehicles sharing one identical program', () => {
    const other = { year: 2026, make: 'Chevrolet', model: 'Equinox' };
    expect(offerGroupKey(VEHICLE, inc())).not.toBe(offerGroupKey(other, inc()));
  });

  it('distinguishes a dual pairing from its lead offer alone', () => {
    const apr = inc({ type: 'apr', rate: 3.9, payment: 0 });
    expect(offerGroupKey(VEHICLE, inc(), apr)).not.toBe(offerGroupKey(VEHICLE, inc()));
  });

  it('treats a reversed pairing as a different ad', () => {
    // Lease-led and APR-led plates compete for different space; they are not two
    // designs of one thing.
    const apr = inc({ type: 'apr', rate: 3.9, payment: 0 });
    expect(offerGroupKey(VEHICLE, inc(), apr)).not.toBe(offerGroupKey(VEHICLE, apr, inc()));
  });
});

describe('pickSecondaryOffer', () => {
  it('takes the best offer of a different type', () => {
    const lease = inc();
    const apr = inc({ type: 'apr', rate: 3.9, payment: 0 });
    const cash = inc({ type: 'cash', amount: 4500, payment: 0 });
    expect(pickSecondaryOffer(lease, [apr, cash])).toBe(apr);
  });

  it('refuses to pair two offers of the same type', () => {
    // Two lease payments on one plate reads as a mistake, not an offer.
    const lease = inc();
    expect(pickSecondaryOffer(lease, [inc({ payment: 299 })])).toBeNull();
  });
});

describe('variantExpiry', () => {
  it('takes the earlier of the two end dates', () => {
    // The ad dies with whichever program ends first — the plate is still showing
    // the dead one. Taking the later date is the failure the expiry sweep exists
    // to prevent.
    const early = inc({ endDate: '2026-09-08' });
    const late = inc({ type: 'apr', endDate: '2026-09-30' });
    expect(variantExpiry(late, early)?.toISOString().slice(0, 10)).toBe('2026-09-08');
  });

  it('uses the single offer when there is no second', () => {
    expect(variantExpiry(inc(), null)?.toISOString().slice(0, 10)).toBe('2026-09-30');
  });

  it('is null when neither offer carries a date', () => {
    expect(variantExpiry(inc({ endDate: null }), inc({ endDate: null }))).toBeNull();
  });

  it('ignores an unparseable date rather than returning Invalid Date', () => {
    const good = inc({ endDate: '2026-09-30' });
    const junk = inc({ endDate: 'not a date' });
    expect(variantExpiry(junk, good)?.toISOString().slice(0, 10)).toBe('2026-09-30');
  });
});

describe('planVariants', () => {
  const lease = inc();
  const apr = inc({ type: 'apr', rate: 3.9, payment: 0 });
  const single = tpl('a', doc());
  const other = tpl('b', doc());

  it('builds one variant per offer per single-offer template', () => {
    const plan = planVariants([lease, apr], [single, other], null);
    expect(plan.build).toHaveLength(4);
    expect(plan.skip).toHaveLength(0);
  });

  it('flags exactly one variant as recommended', () => {
    const plan = planVariants([lease, apr], [single, other], 'b');
    const flagged = plan.build.filter((v) => v.recommended);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].templateId).toBe('b');
    // The best offer, not just any offer on the recommended template.
    expect(flagged[0].primary).toBe(lease);
  });

  it('still builds everything when resolution recommends nothing', () => {
    // Refusing to recommend must not mean refusing to generate — that was the
    // old behavior and it lost the whole vehicle.
    const plan = planVariants([lease], [single, other], null);
    expect(plan.build).toHaveLength(2);
    expect(plan.build.every((v) => !v.recommended)).toBe(true);
  });

  it('pairs two offers into one variant for a dual template', () => {
    const dual = tpl('d', doc({ fields: [{ key: 'o2_offerType', label: '2', type: 'text' }] }));
    const plan = planVariants([lease, apr], [dual], null);
    expect(plan.build).toHaveLength(1);
    expect(plan.build[0].primary).toBe(lease);
    expect(plan.build[0].secondary).toBe(apr);
  });

  it('skips a dual template when only one offer type is live', () => {
    const dual = tpl('d', doc({ fields: [{ key: 'o2_offerType', label: '2', type: 'text' }] }));
    const plan = planVariants([lease], [dual], null);
    expect(plan.build).toHaveLength(0);
    expect(plan.skip[0].reason).toBe('dual_needs_second_offer');
  });

  it('leaves the single-offer designs alone when a dual one cannot be filled', () => {
    // The per-variant skip: one unfillable design must not take the vehicle with
    // it, which is what the old whole-vehicle skip did.
    const dual = tpl('d', doc({ fields: [{ key: 'o2_offerType', label: '2', type: 'text' }] }));
    const plan = planVariants([lease], [single, dual], null);
    expect(plan.build.map((v) => v.templateId)).toEqual(['a']);
    expect(plan.skip).toHaveLength(1);
  });

  it('refuses a two-model dual template', () => {
    const twoModel = tpl(
      'd',
      doc({ fields: [{ key: 'o2_offerType', label: '2', type: 'text' }], dualVehicleMode: 'two' }),
    );
    const plan = planVariants([lease, apr], [twoModel], null);
    expect(plan.build).toHaveLength(0);
    expect(plan.skip[0].reason).toBe('dual_two_model_unsupported');
  });

  it('plans nothing when no offer is eligible', () => {
    expect(planVariants([], [single], null).build).toHaveLength(0);
  });

  it('is deterministic — the same inputs plan the same variants', () => {
    // Load-bearing: AdCreative is keyed (account, template, fingerprint), so a
    // plan that shuffled would mint duplicates instead of updating in place.
    const a = planVariants([lease, apr], [single, other], 'a');
    const b = planVariants([lease, apr], [single, other], 'a');
    expect(a.build.map((v) => [v.templateId, v.primary.type, v.recommended])).toEqual(
      b.build.map((v) => [v.templateId, v.primary.type, v.recommended]),
    );
  });
});

describe('offersToFanOut', () => {
  function cand(i: MarketCheckIncentive, rank: number | null): OfferCandidate {
    return { incentive: i, key: '', rank, rejected: rank === null ? 'expired' : null, reason: '' };
  }

  const lease329 = inc({ payment: 329 });
  const lease399 = inc({ payment: 399, term: 24 });
  const apr = inc({ type: 'apr', rate: 3.9, payment: 0 });
  const cash = inc({ type: 'cash', amount: 4500, payment: 0 });

  it('takes the best offer of each type, not every offer', () => {
    // Several lease programs differing only in term would otherwise become
    // near-identical designs through every template.
    const out = offersToFanOut(
      [cand(lease329, 0), cand(lease399, 1), cand(apr, 2), cand(cash, 3)],
      true,
    );
    expect(out).toEqual([lease329, apr, cash]);
  });

  it('keeps rank order, so the strongest offer leads', () => {
    const out = offersToFanOut([cand(apr, 0), cand(lease329, 1)], true);
    expect(out[0]).toBe(apr);
  });

  it('returns only the best offer when expansion is off', () => {
    const out = offersToFanOut([cand(lease329, 0), cand(apr, 1)], false);
    expect(out).toEqual([lease329]);
  });

  it('ignores rejected candidates in both modes', () => {
    // Covers trim_not_stocked, which the caller relies on to keep a program for
    // a trim nobody carries out of the fan-out.
    expect(offersToFanOut([cand(lease329, null), cand(apr, 0)], true)).toEqual([apr]);
    expect(offersToFanOut([cand(lease329, null), cand(apr, 0)], false)).toEqual([apr]);
  });

  it('is empty when nothing is eligible', () => {
    expect(offersToFanOut([cand(lease329, null)], true)).toEqual([]);
  });
});
