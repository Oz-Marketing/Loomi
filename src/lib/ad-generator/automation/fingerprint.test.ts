import { describe, it, expect } from 'vitest';
import {
  creativeOfferKey,
  diffOffers,
  normalizeEndDate,
  offerFingerprint,
  offerIdentity,
  offerScopeKey,
} from './fingerprint';
import type { MarketCheckIncentive } from '@/lib/integrations/marketcheck';

function inc(over: Partial<MarketCheckIncentive> = {}): MarketCheckIncentive {
  return {
    id: null,
    type: 'lease',
    amount: 0,
    rate: 0,
    term: 36,
    payment: 299,
    downPayment: 2999,
    msrp: 34000,
    trim: null,
    programName: null,
    description: '',
    offerDetails: '',
    startDate: null,
    endDate: '2026-09-08',
    eligibility: '',
    ...over,
  };
}

describe('normalizeEndDate', () => {
  it('passes ISO dates through', () => {
    expect(normalizeEndDate('2026-09-08')).toBe('2026-09-08');
  });

  it('converts the US format the feed also emits', () => {
    // Both formats were observed in one account — they MUST collapse to the same
    // string or every poll reads as a change.
    expect(normalizeEndDate('07/31/2026')).toBe('2026-07-31');
    expect(normalizeEndDate('8/3/2026')).toBe('2026-08-03');
  });

  it('agrees across formats for the same day', () => {
    expect(normalizeEndDate('07/31/2026')).toBe(normalizeEndDate('2026-07-31'));
  });

  it('is empty for missing or unparseable input', () => {
    expect(normalizeEndDate(null)).toBe('');
    expect(normalizeEndDate('')).toBe('');
    expect(normalizeEndDate('whenever')).toBe('');
  });
});

describe('offerIdentity', () => {
  it('rounds money to whole dollars and rates to 2dp', () => {
    const id = offerIdentity(inc({ payment: 299.4, downPayment: 2999.6, rate: 1.899, msrp: 34000.2 }));
    expect(id.payment).toBe(299);
    expect(id.downPayment).toBe(3000);
    expect(id.rate).toBe(1.9);
    expect(id.msrp).toBe(34000);
  });

  it('case-folds the trim', () => {
    expect(offerIdentity(inc({ trim: '  Premium ' })).trim).toBe('premium');
    expect(offerIdentity(inc({ trim: null })).trim).toBe('');
  });
});

describe('offerFingerprint — stability', () => {
  it('is stable for identical offers', () => {
    expect(offerFingerprint(inc())).toBe(offerFingerprint(inc()));
  });

  it('ignores reworded prose', () => {
    // The whole point: the feed rewords the same programme between refreshes.
    const a = inc({ description: '$299 Lease Per MO.', offerDetails: '$299 Lease Per MO. For 36 MOS.' });
    const b = inc({ description: '$299 lease per month', offerDetails: '$299/mo for 36 months' });
    expect(offerFingerprint(a)).toBe(offerFingerprint(b));
  });

  it('ignores an unstable feed id', () => {
    expect(offerFingerprint(inc({ id: 'abc' }))).toBe(offerFingerprint(inc({ id: 'xyz' })));
  });

  it('ignores eligibility text and programme name', () => {
    const a = inc({ eligibility: 'AZ, CA, CO residents', programName: 'Featured Special Lease' });
    const b = inc({ eligibility: 'Well-qualified lessees', programName: 'Summer Event' });
    expect(offerFingerprint(a)).toBe(offerFingerprint(b));
  });

  it('ignores start date', () => {
    expect(offerFingerprint(inc({ startDate: '2026-07-01' }))).toBe(
      offerFingerprint(inc({ startDate: '2026-08-01' })),
    );
  });

  it('ignores sub-dollar jitter', () => {
    expect(offerFingerprint(inc({ payment: 299 }))).toBe(offerFingerprint(inc({ payment: 299.0001 })));
  });

  it('matches across end-date formats', () => {
    expect(offerFingerprint(inc({ endDate: '07/31/2026' }))).toBe(
      offerFingerprint(inc({ endDate: '2026-07-31' })),
    );
  });
});

describe('offerFingerprint — sensitivity', () => {
  it('changes when the payment changes', () => {
    expect(offerFingerprint(inc({ payment: 289 }))).not.toBe(offerFingerprint(inc({ payment: 299 })));
  });

  it('changes when the term changes', () => {
    expect(offerFingerprint(inc({ term: 24 }))).not.toBe(offerFingerprint(inc({ term: 36 })));
  });

  it('changes when due-at-signing changes', () => {
    // Same payment, different DAS — a materially different advertised offer.
    expect(offerFingerprint(inc({ downPayment: 3999 }))).not.toBe(
      offerFingerprint(inc({ downPayment: 4899 })),
    );
  });

  it('changes when the end date changes — a renewed programme is a new offer', () => {
    expect(offerFingerprint(inc({ endDate: '2026-07-31' }))).not.toBe(
      offerFingerprint(inc({ endDate: '2026-08-31' })),
    );
  });

  it('changes when the trim changes', () => {
    expect(offerFingerprint(inc({ trim: 'Sport' }))).not.toBe(offerFingerprint(inc({ trim: 'LX' })));
  });

  it('changes when the offer type changes', () => {
    expect(offerFingerprint(inc({ type: 'apr' }))).not.toBe(offerFingerprint(inc({ type: 'lease' })));
  });
});

describe('offerScopeKey', () => {
  it('is case- and whitespace-insensitive', () => {
    const a = offerScopeKey({ accountKey: 'youngChev', make: ' Chevrolet ', model: 'Trax', year: 2026, zip: '84401' });
    const b = offerScopeKey({ accountKey: 'youngChev', make: 'chevrolet', model: 'trax', year: 2026, zip: '84401' });
    expect(a).toBe(b);
  });

  it('separates models, years, ZIPs and sub-accounts', () => {
    const base = { accountKey: 'a', make: 'Mazda', model: 'CX-5', year: 2026, zip: '84405' };
    expect(offerScopeKey(base)).not.toBe(offerScopeKey({ ...base, model: 'CX-50' }));
    expect(offerScopeKey(base)).not.toBe(offerScopeKey({ ...base, year: 2027 }));
    expect(offerScopeKey(base)).not.toBe(offerScopeKey({ ...base, zip: '84401' }));
    expect(offerScopeKey(base)).not.toBe(offerScopeKey({ ...base, accountKey: 'b' }));
  });
});

describe('creativeOfferKey — the Silverado collision regression', () => {
  // Observed live: GM ran one identical "4.9% APR for 60 months" programme across
  // the Silverado 2500HD and 3500HD. Identical numbers ⇒ identical fingerprint,
  // and because AdCreative's unique index has no scope column the second
  // vehicle's draft silently overwrote the first's.
  const apr = inc({ type: 'apr', payment: 0, downPayment: 0, rate: 4.9, term: 60, endDate: '2026-08-03' });

  it('the bare fingerprint is identical for both vehicles — the cause', () => {
    expect(offerFingerprint(apr)).toBe(offerFingerprint(apr));
  });

  it('scoping by vehicle separates them', () => {
    const fp = offerFingerprint(apr);
    const a = creativeOfferKey({ year: 2026, make: 'Chevrolet', model: 'Silverado 2500HD' }, fp);
    const b = creativeOfferKey({ year: 2026, make: 'Chevrolet', model: 'Silverado 3500HD' }, fp);
    expect(a).not.toBe(b);
  });

  it('stays stable for the same vehicle + offer', () => {
    const fp = offerFingerprint(apr);
    const v = { year: 2026, make: 'Chevrolet', model: 'Silverado 2500HD' };
    expect(creativeOfferKey(v, fp)).toBe(creativeOfferKey(v, fp));
  });

  it('is case- and punctuation-insensitive on the vehicle', () => {
    const fp = offerFingerprint(apr);
    expect(creativeOfferKey({ year: 2026, make: 'CHEVROLET', model: 'Silverado 2500HD' }, fp)).toBe(
      creativeOfferKey({ year: 2026, make: 'chevrolet', model: 'silverado 2500hd' }, fp),
    );
  });

  it('separates model years', () => {
    const fp = offerFingerprint(apr);
    expect(creativeOfferKey({ year: 2026, make: 'Chevrolet', model: 'Trax' }, fp)).not.toBe(
      creativeOfferKey({ year: 2027, make: 'Chevrolet', model: 'Trax' }, fp),
    );
  });

  it('stays readable for debugging', () => {
    const key = creativeOfferKey({ year: 2026, make: 'Chevrolet', model: 'Silverado 2500HD' }, 'abc123');
    expect(key).toBe('2026-chevrolet-silverado-2500hd:abc123');
  });

  it('still changes when the offer changes for the same vehicle', () => {
    const v = { year: 2026, make: 'Chevrolet', model: 'Trax' };
    const a = creativeOfferKey(v, offerFingerprint(inc({ type: 'lease', payment: 299 })));
    const b = creativeOfferKey(v, offerFingerprint(inc({ type: 'lease', payment: 319 })));
    expect(a).not.toBe(b);
  });
});

describe('diffOffers', () => {
  const lease289 = inc({ payment: 289 });
  const lease319 = inc({ payment: 319 });

  it('reports everything as new on a first poll', () => {
    const d = diffOffers([lease289, lease319], []);
    expect(d.new).toHaveLength(2);
    expect(d.unchanged).toHaveLength(0);
    expect(d.ended).toHaveLength(0);
  });

  it('reports nothing new on a repeat poll', () => {
    const prev = [offerFingerprint(lease289), offerFingerprint(lease319)];
    const d = diffOffers([lease289, lease319], prev);
    expect(d.new).toHaveLength(0);
    expect(d.unchanged).toHaveLength(2);
  });

  it('detects a genuinely new programme', () => {
    const d = diffOffers([lease289, lease319], [offerFingerprint(lease289)]);
    expect(d.new.map((e) => e.fingerprint)).toEqual([offerFingerprint(lease319)]);
  });

  it('detects a withdrawn programme', () => {
    const d = diffOffers([lease289], [offerFingerprint(lease289), offerFingerprint(lease319)]);
    expect(d.ended.map((e) => e.fingerprint)).toEqual([offerFingerprint(lease319)]);
    expect(d.ended[0].incentive).toBeUndefined();
  });

  it('represents a repriced offer as one ended plus one new', () => {
    // No 'changed' kind by design — the old programme really did stop.
    const d = diffOffers([lease319], [offerFingerprint(lease289)]);
    expect(d.new).toHaveLength(1);
    expect(d.ended).toHaveLength(1);
  });

  it('collapses duplicate rows in a single pull', () => {
    // Trim variants routinely collapse to identical numbers.
    const d = diffOffers([lease289, inc({ payment: 289 })], []);
    expect(d.new).toHaveLength(1);
  });

  it('handles an empty pull against known offers', () => {
    const d = diffOffers([], [offerFingerprint(lease289)]);
    expect(d.ended).toHaveLength(1);
    expect(d.new).toHaveLength(0);
  });

  it('handles both sides empty', () => {
    const d = diffOffers([], []);
    expect(d.entries).toEqual([]);
  });
});
