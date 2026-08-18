import { describe, it, expect } from 'vitest';
import { daysUntil, hasUsableNumbers, selectOffer, trimAppliesToStock } from './select-offer';
import type { MarketCheckIncentive } from '@/lib/integrations/marketcheck';

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

const NOW = new Date('2026-08-01T12:00:00Z');
const lease = (id: string, payment: number, term = 36, over = {}) =>
  inc({ id, type: 'lease', payment, term, ...over });
const apr = (id: string, rate: number, term = 60, over = {}) =>
  inc({ id, type: 'apr', rate, term, ...over });
const cash = (id: string, amount: number, over = {}) => inc({ id, type: 'cash', amount, ...over });

describe('daysUntil', () => {
  it('counts whole days to the end date', () => {
    expect(daysUntil('2026-08-31T12:00:00Z', NOW)).toBe(30);
  });

  it('goes negative for a past date', () => {
    expect(daysUntil('2026-07-30T12:00:00Z', NOW)).toBe(-2);
  });

  it('is null without a parseable date', () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil('whenever', NOW)).toBeNull();
  });
});

describe('hasUsableNumbers', () => {
  it('requires a payment and term for a lease', () => {
    expect(hasUsableNumbers(lease('a', 299, 36))).toBe(true);
    expect(hasUsableNumbers(lease('a', 0, 36))).toBe(false);
    expect(hasUsableNumbers(lease('a', 299, 0))).toBe(false);
  });

  it('treats 0% APR as a real offer, needing only a term', () => {
    expect(hasUsableNumbers(apr('a', 0, 60))).toBe(true);
    expect(hasUsableNumbers(apr('a', 1.9, 0))).toBe(false);
  });

  it('requires an amount for cash', () => {
    expect(hasUsableNumbers(cash('a', 2500))).toBe(true);
    expect(hasUsableNumbers(cash('a', 0))).toBe(false);
  });

  it('never accepts an unrecognized program', () => {
    expect(hasUsableNumbers(inc({ type: 'other', description: 'Loyalty' }))).toBe(false);
  });
});

describe('selectOffer — priority', () => {
  it('prefers a lease over an APR and cash by default', () => {
    const { chosen } = selectOffer([cash('c', 3000), apr('a', 0, 60), lease('l', 349)], { now: NOW });
    expect(chosen?.key).toBe('l');
  });

  it('honours a custom priority order', () => {
    const { chosen } = selectOffer([cash('c', 3000), apr('a', 0, 60), lease('l', 349)], {
      priority: ['cash', 'apr', 'lease'],
      now: NOW,
    });
    expect(chosen?.key).toBe('c');
  });

  it('rejects types left out of the priority list', () => {
    const res = selectOffer([lease('l', 349), apr('a', 1.9)], { priority: ['apr'], now: NOW });
    expect(res.chosen?.key).toBe('a');
    const rej = res.candidates.find((c) => c.key === 'l');
    expect(rej?.rejected).toBe('type_not_eligible');
  });

  it('returns nothing when no offer is eligible', () => {
    const res = selectOffer([inc({ id: 'x', type: 'other' })], { now: NOW });
    expect(res.chosen).toBeNull();
    expect(res.candidates).toHaveLength(1);
  });

  it('handles an empty feed', () => {
    const res = selectOffer([], { now: NOW });
    expect(res.chosen).toBeNull();
    expect(res.candidates).toEqual([]);
  });
});

describe('selectOffer — best in type', () => {
  it('takes the cheapest lease payment', () => {
    const { chosen } = selectOffer([lease('hi', 399), lease('lo', 279), lease('mid', 329)], { now: NOW });
    expect(chosen?.key).toBe('lo');
  });

  it('takes the lowest APR rate', () => {
    const { chosen } = selectOffer([apr('hi', 4.9), apr('lo', 0.9)], { now: NOW });
    expect(chosen?.key).toBe('lo');
  });

  it('breaks equal rates by the longer term', () => {
    const { chosen } = selectOffer([apr('short', 1.9, 36), apr('long', 1.9, 72)], { now: NOW });
    expect(chosen?.key).toBe('long');
  });

  it('takes the largest cash amount', () => {
    const { chosen } = selectOffer([cash('sm', 1000), cash('lg', 4000)], {
      priority: ['cash'],
      now: NOW,
    });
    expect(chosen?.key).toBe('lg');
  });

  it('never lets a strong within-type score outrank offer priority', () => {
    // A $99 cash offer must not beat a $599 lease when lease is priority 1.
    const { chosen } = selectOffer([cash('c', 999_999), lease('l', 599)], { now: NOW });
    expect(chosen?.key).toBe('l');
  });
});

describe('selectOffer — expiry', () => {
  it('rejects an offer that already ended', () => {
    const res = selectOffer([lease('old', 249, 36, { endDate: '2026-07-25' }), lease('ok', 349)], {
      now: NOW,
    });
    expect(res.chosen?.key).toBe('ok');
    expect(res.candidates.find((c) => c.key === 'old')?.rejected).toBe('expired');
  });

  it('rejects an offer expiring inside the minimum window', () => {
    const res = selectOffer([lease('soon', 249, 36, { endDate: '2026-08-04' }), lease('ok', 349)], {
      minDaysRemaining: 7,
      now: NOW,
    });
    expect(res.chosen?.key).toBe('ok');
    expect(res.candidates.find((c) => c.key === 'soon')?.rejected).toBe('expiring_soon');
  });

  it('keeps an offer with no end date at all', () => {
    const res = selectOffer([lease('open', 249)], { minDaysRemaining: 7, now: NOW });
    expect(res.chosen?.key).toBe('open');
  });

  it('does not apply the window when it is disabled', () => {
    const res = selectOffer([lease('soon', 249, 36, { endDate: '2026-08-02' })], {
      minDaysRemaining: 0,
      now: NOW,
    });
    expect(res.chosen?.key).toBe('soon');
  });
});

describe('selectOffer — auditability', () => {
  it('rejects offers with no usable numbers and says so', () => {
    const res = selectOffer([lease('empty', 0, 0), lease('ok', 299)], { now: NOW });
    expect(res.chosen?.key).toBe('ok');
    const rej = res.candidates.find((c) => c.key === 'empty');
    expect(rej?.rejected).toBe('no_usable_numbers');
    expect(rej?.reason).toMatch(/no usable numbers/i);
  });

  it('explains why the winner won', () => {
    const { chosen } = selectOffer([lease('l', 299, 36)], { now: NOW });
    expect(chosen?.reason).toContain('$299/mo for 36 months');
    expect(chosen?.reason).toContain('priority 1');
  });

  it('keeps every candidate, eligible first then rejected', () => {
    const res = selectOffer([inc({ id: 'bad', type: 'other' }), lease('good', 299)], { now: NOW });
    expect(res.candidates.map((c) => c.key)).toEqual(['good', 'bad']);
  });

  it('is deterministic for the same input', () => {
    const feed = [lease('a', 299), apr('b', 1.9), cash('c', 2000)];
    const first = selectOffer(feed, { now: NOW });
    const second = selectOffer(feed, { now: NOW });
    expect(second.chosen?.key).toBe(first.chosen?.key);
    expect(second.candidates.map((c) => c.key)).toEqual(first.candidates.map((c) => c.key));
  });
});

describe('trimAppliesToStock', () => {
  it('treats an untrimmed programme as model-wide', () => {
    expect(trimAppliesToStock(null, ['LT'])).toBe(true);
    expect(trimAppliesToStock('', ['LT'])).toBe(true);
  });

  it('matches the same trim regardless of case or punctuation', () => {
    expect(trimAppliesToStock('High Country', ['HIGH COUNTRY'])).toBe(true);
    expect(trimAppliesToStock('LT w/1LT', ['LT W 1LT'])).toBe(true);
  });

  it('does NOT match a longer trim that merely starts the same', () => {
    // The bug this whole check exists to prevent: 'ltz'.includes('lt') is true,
    // so a substring test would attach an LT programme to LTZ stock.
    expect(trimAppliesToStock('LT', ['LTZ'])).toBe(false);
    expect(trimAppliesToStock('LS', ['LSX'])).toBe(false);
  });

  it('matches a package variant of the same trim', () => {
    // An LT Trail Boss is an LT with a package, so an LT programme covers it.
    expect(trimAppliesToStock('LT', ['LT Trail Boss'])).toBe(true);
  });

  it('does not widen a more specific programme to the whole trim', () => {
    // An "LT Crew Cab" programme does not cover every LT.
    expect(trimAppliesToStock('LT Crew Cab', ['LT'])).toBe(false);
  });

  it('needs only one stocked VIN to qualify', () => {
    expect(trimAppliesToStock('High Country', ['LT', 'LTZ', 'High Country'])).toBe(true);
    expect(trimAppliesToStock('High Country', ['LT', 'LTZ'])).toBe(false);
  });

  it('never rejects when the trim is unknown', () => {
    // A VIN whose trim the feed omitted cannot disprove eligibility, and
    // wrongly dropping a valid programme is worse than the old behaviour.
    expect(trimAppliesToStock('LT', [])).toBe(true);
    expect(trimAppliesToStock('LT', [null])).toBe(true);
    expect(trimAppliesToStock('LT', ['', 'LTZ'])).toBe(true);
  });
});

describe('selectOffer — trim eligibility', () => {
  const opts = { now: NOW, priority: ['lease', 'apr'] as const };

  it('passes over a programme for a trim that is not in stock', () => {
    const res = selectOffer([lease('ltz', 299, 36, { trim: 'LTZ' })], {
      ...opts,
      priority: [...opts.priority],
      stockedTrims: ['LT'],
    });
    expect(res.chosen).toBeNull();
    expect(res.candidates[0].rejected).toBe('trim_not_stocked');
  });

  it('picks the stocked trim over a cheaper one that is not stocked', () => {
    // Without the check this returns the $199 LTZ — an offer no VIN on the lot
    // qualifies for, published with a resolved disclaimer.
    const res = selectOffer(
      [lease('ltz', 199, 36, { trim: 'LTZ' }), lease('lt', 349, 36, { trim: 'LT' })],
      { ...opts, priority: [...opts.priority], stockedTrims: ['LT', 'LT'] },
    );
    expect(res.chosen?.key).toContain('lt');
    expect(res.chosen?.incentive.payment).toBe(349);
  });

  it('is skipped entirely when no stock list is supplied', () => {
    // Callers without stock in hand keep the old behaviour rather than losing
    // every trim-specific programme.
    const res = selectOffer([lease('ltz', 299, 36, { trim: 'LTZ' })], {
      ...opts,
      priority: [...opts.priority],
    });
    expect(res.chosen).not.toBeNull();
  });

  it('reports the trim rejection distinctly from an expiry', () => {
    const res = selectOffer([lease('ltz', 299, 36, { trim: 'LTZ' })], {
      ...opts,
      priority: [...opts.priority],
      stockedTrims: ['LT'],
    });
    expect(res.candidates[0].reason).toMatch(/no LTZ in stock/i);
  });
});
