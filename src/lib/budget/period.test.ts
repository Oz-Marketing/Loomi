import { describe, it, expect } from 'vitest';
import { isValidPeriod, yearOfPeriod, periodOf, resolveYear } from './period';

describe('isValidPeriod', () => {
  it('accepts a well-formed YYYY-MM', () => {
    expect(isValidPeriod('2026-01')).toBe(true);
    expect(isValidPeriod('2026-12')).toBe(true);
  });

  it('rejects out-of-range and malformed months', () => {
    // Month 00 and 13 are the two that a naive /^\d{4}-\d{2}$/ would let
    // through, and both would place a line on a month the pacer can't match.
    expect(isValidPeriod('2026-00')).toBe(false);
    expect(isValidPeriod('2026-13')).toBe(false);
    expect(isValidPeriod('2026-1')).toBe(false);
    expect(isValidPeriod('26-01')).toBe(false);
    expect(isValidPeriod('2026-01-01')).toBe(false);
    expect(isValidPeriod('')).toBe(false);
  });
});

describe('periodOf / yearOfPeriod', () => {
  it('round-trips', () => {
    expect(periodOf(2026, 7)).toBe('2026-07');
    expect(yearOfPeriod(periodOf(2026, 7))).toBe(2026);
  });

  it('zero-pads single-digit months', () => {
    expect(periodOf(2026, 1)).toBe('2026-01');
  });
});

describe('resolveYear — the BudgetLine year/period invariant', () => {
  it('derives the year from the period', () => {
    expect(resolveYear('2026-03', undefined)).toBe(2026);
  });

  it('accepts a year that agrees with the period', () => {
    expect(resolveYear('2026-03', 2026)).toBe(2026);
  });

  it('rejects a year that disagrees with the period', () => {
    // The failure this guards: a December line filed against next year's plan
    // would silently roll up under the wrong budget.
    expect(() => resolveYear('2026-12', 2027)).toThrow(/disagrees/);
  });

  it('rejects a malformed period', () => {
    expect(() => resolveYear('2026-13', undefined)).toThrow(/Invalid period/);
  });

  it('requires an explicit year for a pool line', () => {
    // A pool line has no period, so nothing else anchors it to a BudgetPlan.
    expect(() => resolveYear(null, undefined)).toThrow(/requires an explicit year/);
    expect(() => resolveYear(undefined, undefined)).toThrow(/requires an explicit year/);
  });

  it('accepts a pool line with a year', () => {
    expect(resolveYear(null, 2026)).toBe(2026);
  });

  it('rejects a non-integer year on a pool line', () => {
    expect(() => resolveYear(null, 2026.5)).toThrow(/requires an explicit year/);
  });
});
