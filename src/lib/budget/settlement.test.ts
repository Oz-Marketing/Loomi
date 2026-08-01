import { describe, it, expect } from 'vitest';
import { attainment, splitToCents, variance } from './settlement';

const sum = (xs: { actual: number }[]) =>
  Math.round(xs.reduce((a, b) => a + b.actual, 0) * 100) / 100;

describe('splitToCents', () => {
  it('splits proportionally to spend target', () => {
    const out = splitToCents(
      [
        { id: 'a', spendTarget: 7500 },
        { id: 'b', spendTarget: 2500 },
      ],
      1000,
    );
    expect(out).toEqual([
      { id: 'a', actual: 750 },
      { id: 'b', actual: 250 },
    ]);
  });

  it('sums to the total exactly when the split does not divide evenly', () => {
    // 100 / 3 is the classic case: naive rounding leaves a cent on the floor,
    // and a settlement that doesn't reconcile to the penny is untrustworthy.
    const out = splitToCents(
      [
        { id: 'a', spendTarget: 1 },
        { id: 'b', spendTarget: 1 },
        { id: 'c', spendTarget: 1 },
      ],
      100,
    );
    expect(sum(out)).toBe(100);
    expect(out.map((o) => o.actual).sort()).toEqual([33.33, 33.33, 33.34]);
  });

  it('stays exact across many lines and an awkward total', () => {
    const lines = Array.from({ length: 7 }, (_, i) => ({
      id: String(i),
      spendTarget: 100 + i * 37,
    }));
    const out = splitToCents(lines, 9_999.99);
    expect(sum(out)).toBe(9_999.99);
  });

  it('gives the leftover cents to the largest fractions, deterministically', () => {
    const a = splitToCents(
      [
        { id: 'a', spendTarget: 1 },
        { id: 'b', spendTarget: 2 },
      ],
      1,
    );
    const b = splitToCents(
      [
        { id: 'a', spendTarget: 1 },
        { id: 'b', spendTarget: 2 },
      ],
      1,
    );
    expect(a).toEqual(b);
    expect(sum(a)).toBe(1);
  });

  it('splits evenly when no line had a target', () => {
    // Lines exist but were never funded. Proportional is undefined here, and
    // returning nothing would quietly drop real spend.
    const out = splitToCents(
      [
        { id: 'a', spendTarget: 0 },
        { id: 'b', spendTarget: 0 },
      ],
      500,
    );
    expect(out).toEqual([
      { id: 'a', actual: 250 },
      { id: 'b', actual: 250 },
    ]);
  });

  it('zeroes every line when there was no spend', () => {
    const out = splitToCents(
      [
        { id: 'a', spendTarget: 100 },
        { id: 'b', spendTarget: 200 },
      ],
      0,
    );
    expect(out).toEqual([
      { id: 'a', actual: 0 },
      { id: 'b', actual: 0 },
    ]);
  });

  it('returns nothing when there are no lines — orphan spend is the caller’s call', () => {
    expect(splitToCents([], 1000)).toEqual([]);
  });

  it('ignores negative targets rather than inverting a share', () => {
    const out = splitToCents(
      [
        { id: 'a', spendTarget: -50 },
        { id: 'b', spendTarget: 100 },
      ],
      300,
    );
    expect(out).toEqual([
      { id: 'a', actual: 0 },
      { id: 'b', actual: 300 },
    ]);
  });
});

describe('variance / attainment', () => {
  it('is positive when overspent and negative when under', () => {
    expect(variance(1200, 1000)).toBe(200);
    expect(variance(800, 1000)).toBe(-200);
  });

  it('reports attainment as a share of target', () => {
    expect(attainment(750, 1000)).toBe(0.75);
  });

  it('has no attainment without a target to hit', () => {
    expect(attainment(500, 0)).toBeNull();
  });
});
