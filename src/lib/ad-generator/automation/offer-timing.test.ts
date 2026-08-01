import { describe, it, expect } from 'vitest';
import {
  evaluateOfferCycle,
  fitToWindow,
  monthWindow,
  nextMonthWindow,
  observedLeadDays,
  offerEndsAt,
  rollingWindow,
  shouldRepoll,
} from './offer-timing';
import { selectOffer } from './select-offer';
import type { MarketCheckIncentive } from '@/lib/integrations/marketcheck';

function inc(over: Partial<MarketCheckIncentive> = {}): MarketCheckIncentive {
  return {
    id: null,
    type: 'lease',
    amount: 0,
    rate: 0,
    term: 36,
    payment: 299,
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

/** The real measurement date that exposed the month-boundary trap. */
const JUL_28 = new Date('2026-07-28T12:00:00Z');

describe('window builders', () => {
  it('monthWindow spans the containing calendar month', () => {
    const w = monthWindow(JUL_28);
    expect(w.start.toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(w.end.toISOString().slice(0, 10)).toBe('2026-07-31');
  });

  it('nextMonthWindow spans the following month', () => {
    const w = nextMonthWindow(JUL_28);
    expect(w.start.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(w.end.toISOString().slice(0, 10)).toBe('2026-08-31');
  });

  it('nextMonthWindow rolls the year over in December', () => {
    const w = nextMonthWindow(new Date('2026-12-15T00:00:00Z'));
    expect(w.start.toISOString().slice(0, 10)).toBe('2027-01-01');
    expect(w.end.toISOString().slice(0, 10)).toBe('2027-01-31');
  });

  it('handles February in a leap year', () => {
    const w = monthWindow(new Date('2028-02-10T00:00:00Z'));
    expect(w.end.toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  it('rollingWindow runs n days from today', () => {
    const w = rollingWindow(JUL_28, 30);
    expect(w.start.toISOString().slice(0, 10)).toBe('2026-07-28');
    expect(w.end.toISOString().slice(0, 10)).toBe('2026-08-27');
  });
});

describe('offerEndsAt', () => {
  it('treats an offer as good THROUGH its end date', () => {
    const d = offerEndsAt(inc({ endDate: '2026-07-31' }))!;
    expect(d.toISOString()).toBe('2026-07-31T23:59:59.000Z');
  });

  it('accepts the US format the feed also emits', () => {
    expect(offerEndsAt(inc({ endDate: '07/31/2026' }))!.toISOString().slice(0, 10)).toBe('2026-07-31');
  });

  it('is null without an end date', () => {
    expect(offerEndsAt(inc({ endDate: null }))).toBeNull();
  });
});

describe('fitToWindow', () => {
  const august = nextMonthWindow(JUL_28); // 2026-08-01 → 2026-08-31

  it('covers when the offer outlasts the window', () => {
    expect(fitToWindow(inc({ endDate: '2026-09-08' }), august)).toBe('covers');
  });

  it('covers exactly on the last day of the window', () => {
    expect(fitToWindow(inc({ endDate: '2026-08-31' }), august)).toBe('covers');
  });

  it('is partial when it dies mid-window', () => {
    expect(fitToWindow(inc({ endDate: '2026-08-15' }), august)).toBe('partial');
  });

  it('is expired when it ends before the window opens', () => {
    // The exact Mazda case from 2026-07-28.
    expect(fitToWindow(inc({ endDate: '2026-07-31' }), august)).toBe('expired');
  });

  it('is undated with no end date', () => {
    expect(fitToWindow(inc({ endDate: null }), august)).toBe('undated');
  });
});

describe('evaluateOfferCycle', () => {
  const august = nextMonthWindow(JUL_28);

  it('reports none for an empty feed', () => {
    const r = evaluateOfferCycle([], august);
    expect(r.state).toBe('none');
    expect(r.usable).toEqual([]);
  });

  it('reports current when something covers the window', () => {
    const r = evaluateOfferCycle([inc({ endDate: '2026-09-08' }), inc({ endDate: '2026-07-31' })], august);
    expect(r.state).toBe('current');
    expect(r.counts).toMatchObject({ covers: 1, expired: 1 });
    expect(r.usable).toHaveLength(1);
  });

  it('reports partial when offers die inside the window', () => {
    const r = evaluateOfferCycle([inc({ endDate: '2026-08-15' })], august);
    expect(r.state).toBe('partial');
    expect(r.summary).toContain('expire inside it');
  });

  it('reports expiring_unrenewed for the month-boundary case', () => {
    // Mazda on 2026-07-28: everything ends 07/31, August unpublished.
    const r = evaluateOfferCycle(
      [inc({ endDate: '2026-07-31' }), inc({ endDate: '2026-07-31' })],
      august,
    );
    expect(r.state).toBe('expiring_unrenewed');
    expect(r.usable).toEqual([]);
    expect(r.summary).toContain('has not published the next cycle');
  });

  it('distinguishes expiring_unrenewed from none — the whole point', () => {
    // Both yield zero usable offers, but they mean completely different things:
    // one is "wait and re-poll", the other is "this vehicle has no programme".
    const unrenewed = evaluateOfferCycle([inc({ endDate: '2026-07-31' })], august);
    const none = evaluateOfferCycle([], august);
    expect(unrenewed.usable).toHaveLength(0);
    expect(none.usable).toHaveLength(0);
    expect(unrenewed.state).not.toBe(none.state);
    expect(shouldRepoll(unrenewed.state)).toBe(true);
    expect(shouldRepoll(none.state)).toBe(false);
  });

  it('reports undated when no offer carries an end date', () => {
    expect(evaluateOfferCycle([inc({ endDate: null })], august).state).toBe('undated');
  });

  it('tracks the latest end date across the set', () => {
    const r = evaluateOfferCycle([inc({ endDate: '2026-07-31' }), inc({ endDate: '2026-08-03' })], august);
    expect(r.latestEnd?.toISOString().slice(0, 10)).toBe('2026-08-03');
  });
});

describe('selectOffer with a run window — the regression that started this', () => {
  const august = nextMonthWindow(JUL_28);
  const mazdaJuly = [
    inc({ id: 'lease', type: 'lease', payment: 318, term: 36, endDate: '07/31/2026' }),
    inc({ id: 'apr', type: 'apr', rate: 0, term: 36, endDate: '07/31/2026' }),
  ];

  it('a fixed 7-day minimum rejects everything on 2026-07-28', () => {
    // Reproduces the measured failure: 100% rejection, zero ads.
    const res = selectOffer(mazdaJuly, { minDaysRemaining: 7, now: JUL_28 });
    expect(res.chosen).toBeNull();
    expect(res.candidates.every((c) => c.rejected === 'expiring_soon')).toBe(true);
  });

  it('the same offers still serve JULY ads', () => {
    const res = selectOffer(mazdaJuly, { runWindow: monthWindow(JUL_28), now: JUL_28 });
    expect(res.chosen?.key).toBe('lease');
  });

  it('and are correctly rejected for AUGUST ads', () => {
    const res = selectOffer(mazdaJuly, { runWindow: august, now: JUL_28 });
    expect(res.chosen).toBeNull();
    expect(res.candidates.every((c) => c.rejected === 'expired')).toBe(true);
    expect(res.candidates[0].reason).toContain('2026-08-01');
  });

  it('accepts a Honda-style offer that reaches into August', () => {
    const res = selectOffer([inc({ id: 'honda', payment: 289, endDate: '2026-09-08' })], {
      runWindow: august,
      now: JUL_28,
    });
    expect(res.chosen?.key).toBe('honda');
  });

  it('runWindow overrides minDaysRemaining', () => {
    const res = selectOffer([inc({ id: 'x', payment: 289, endDate: '2026-08-02' })], {
      runWindow: august,
      minDaysRemaining: 90,
      now: JUL_28,
    });
    expect(res.chosen?.key).toBe('x');
  });
});

describe('observedLeadDays', () => {
  it('is null with nothing to measure', () => {
    expect(observedLeadDays([])).toBeNull();
    expect(observedLeadDays([{ firstSeenAt: JUL_28, endDate: null }])).toBeNull();
  });

  it('measures lead time from first sighting to end date', () => {
    // Offers are valid THROUGH their end date, so 1 Jul → 31 Jul inclusive is
    // 31 days, and 1 Jun → 30 Jun is 30. Median of [30, 31] rounds to 31.
    const r = observedLeadDays([
      { firstSeenAt: new Date('2026-07-01T00:00:00Z'), endDate: '2026-07-31' },
      { firstSeenAt: new Date('2026-06-01T00:00:00Z'), endDate: '2026-06-30' },
    ])!;
    expect(r.n).toBe(2);
    expect(r.min).toBe(30);
    expect(r.max).toBe(31);
    expect(r.median).toBe(31);
  });

  it('separates a long-lead OEM from a short-lead one', () => {
    // Honda-like: seen ~6 weeks before expiry.
    const honda = observedLeadDays([{ firstSeenAt: new Date('2026-07-28T00:00:00Z'), endDate: '2026-09-08' }])!;
    // Mazda-like: seen only days before expiry.
    const mazda = observedLeadDays([{ firstSeenAt: new Date('2026-07-28T00:00:00Z'), endDate: '2026-07-31' }])!;
    expect(honda.median).toBeGreaterThan(mazda.median);
    expect(mazda.median).toBeLessThan(7);
  });

  it('ignores samples first seen after their own end date', () => {
    expect(observedLeadDays([{ firstSeenAt: new Date('2026-08-05T00:00:00Z'), endDate: '2026-07-31' }])).toBeNull();
  });
});
