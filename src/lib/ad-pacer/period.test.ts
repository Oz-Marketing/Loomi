import { describe, it, expect } from 'vitest';
import { monthRangeLabel } from './period';

// The reconciliation header names the settled months still carrying unapplied
// over/under. Listing each one ran to "Jan, Feb, Mar, Apr, May, Jun, Jul" —
// a wall of text where a range says the same thing.
describe('monthRangeLabel', () => {
  const months = (...ms: number[]) =>
    ms.map((m) => `2026-${String(m).padStart(2, '0')}`);

  it('collapses a consecutive run into one range', () => {
    expect(monthRangeLabel(months(1, 2, 3, 4, 5, 6, 7))).toBe('Jan–Jul');
  });

  it('names a single month plainly', () => {
    expect(monthRangeLabel(months(3))).toBe('Mar');
  });

  it('keeps a gap visible instead of implying an unbroken range', () => {
    expect(monthRangeLabel(months(1, 2, 3, 6))).toBe('Jan–Mar, Jun');
    expect(monthRangeLabel(months(3, 5))).toBe('Mar, May');
  });

  it('falls back to a count once the list fragments', () => {
    // Four+ disjoint groups read worse than the plain number.
    expect(monthRangeLabel(months(1, 3, 5, 7, 9))).toBe('5 months');
  });

  it('sorts and de-duplicates whatever order it is handed', () => {
    expect(monthRangeLabel(['2026-03', '2026-01', '2026-02', '2026-03'])).toBe('Jan–Mar');
  });

  it('is empty for no months, and ignores malformed periods', () => {
    expect(monthRangeLabel([])).toBe('');
    expect(monthRangeLabel(['nope', '2026-13'])).toBe('');
  });
});
