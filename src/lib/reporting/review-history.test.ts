import { describe, it, expect } from 'vitest';
import { foldDistribution, foldMonths, summarize } from './review-history';

describe('foldDistribution', () => {
  it('always returns five rows, 5 down to 1, zeros included', () => {
    // "No 1-star reviews" is one of the more useful things this chart shows —
    // it has to be a visible empty bar, not a missing row.
    const out = foldDistribution([
      { stars: 5, reviews: 40 },
      { stars: 4, reviews: 10 },
    ]);
    expect(out.map((d) => d.stars)).toEqual([5, 4, 3, 2, 1]);
    expect(out.find((d) => d.stars === 1)!.reviews).toBe(0);
  });

  it('computes shares over the whole distribution', () => {
    const out = foldDistribution([
      { stars: 5, reviews: 75 },
      { stars: 1, reviews: 25 },
    ]);
    expect(out.find((d) => d.stars === 5)!.share).toBe(0.75);
    expect(out.reduce((n, d) => n + d.share, 0)).toBeCloseTo(1);
  });

  it('returns zero shares rather than NaN when there are no reviews', () => {
    const out = foldDistribution([]);
    expect(out).toHaveLength(5);
    expect(out.every((d) => d.reviews === 0 && d.share === 0)).toBe(true);
  });
});

describe('foldMonths', () => {
  it('averages from summed stars, not from a mean of monthly means', () => {
    const [m] = foldMonths([{ period: '2026-03', reviews: 4, starsSum: 18, replied: 2 }]);
    expect(m.average).toBe(4.5);
    expect(m.label).toBe('Mar 2026');
  });

  it('reports a null average for a month with no reviews', () => {
    const [m] = foldMonths([{ period: '2026-03', reviews: 0, starsSum: 0, replied: 0 }]);
    expect(m.average).toBeNull();
  });

  it('orders chronologically regardless of row order', () => {
    const out = foldMonths([
      { period: '2026-05', reviews: 1, starsSum: 5, replied: 0 },
      { period: '2026-01', reviews: 1, starsSum: 4, replied: 1 },
    ]);
    expect(out.map((m) => m.period)).toEqual(['2026-01', '2026-05']);
  });
});

describe('summarize', () => {
  it('derives totals and the weighted average from the distribution', () => {
    // 10×5 + 5×4 + 5×1 = 75 stars over 20 reviews → 3.75
    const dist = foldDistribution([
      { stars: 5, reviews: 10 },
      { stars: 4, reviews: 5 },
      { stars: 1, reviews: 5 },
    ]);
    const s = summarize(dist, 12);
    expect(s.reviews).toBe(20);
    expect(s.average).toBe(3.75);
    expect(s.replyRate).toBe(60);
  });

  it('reports a null reply rate and average for an empty range', () => {
    // "We replied to none of zero reviews" is not a fact, and a 0.0 average
    // would render as the worst possible rating.
    const s = summarize(foldDistribution([]), 0);
    expect(s.reviews).toBe(0);
    expect(s.average).toBeNull();
    expect(s.replyRate).toBeNull();
  });

  it('reports a genuine zero reply rate as zero', () => {
    const s = summarize(foldDistribution([{ stars: 5, reviews: 8 }]), 0);
    expect(s.replyRate).toBe(0);
    expect(s.average).toBe(5);
  });

  it('can never disagree with the distribution it was derived from', () => {
    const dist = foldDistribution([
      { stars: 5, reviews: 3 },
      { stars: 3, reviews: 7 },
    ]);
    expect(summarize(dist, 0).reviews).toBe(dist.reduce((n, d) => n + d.reviews, 0));
  });
});
