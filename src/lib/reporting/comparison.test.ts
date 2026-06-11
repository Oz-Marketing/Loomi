import { describe, it, expect } from 'vitest';
import { resolveComparisonDates } from './comparison';

/**
 * Expected windows + labels are the exact output of Oz Dealer Tools' PHP
 * `resolveComparisonDates()` for the same inputs. Parity assertions.
 */
describe('resolveComparisonDates (Oz parity)', () => {
  const START = '2026-06-01';
  const END = '2026-06-04';

  it('previous_period: preceding same-length window ending the day before start', () => {
    expect(resolveComparisonDates(START, END, 'previous_period')).toEqual({
      start: '2026-05-28',
      end: '2026-05-31',
      label: 'Previous 4 Days',
    });
  });

  it('previous_month: both bounds shifted back one calendar month', () => {
    expect(resolveComparisonDates(START, END, 'previous_month')).toEqual({
      start: '2026-05-01',
      end: '2026-05-04',
      label: 'May 1 – May 4, 2026',
    });
  });

  it('previous_year: both bounds shifted back one year', () => {
    expect(resolveComparisonDates(START, END, 'previous_year')).toEqual({
      start: '2025-06-01',
      end: '2025-06-04',
      label: 'Jun 1 – Jun 4, 2025',
    });
  });

  it('reproduces PHP month-end overflow (2026-03-31 → 2026-03-03)', () => {
    // Feb has no 31st, so PHP modify('-1 month') rolls forward 3 days.
    const out = resolveComparisonDates('2026-03-31', '2026-03-31', 'previous_month');
    expect(out.start).toBe('2026-03-03');
    expect(out.end).toBe('2026-03-03');
  });

  it('custom: uses the explicit window when both dates are present', () => {
    expect(
      resolveComparisonDates(START, END, 'custom', '2026-01-10', '2026-02-15'),
    ).toEqual({
      start: '2026-01-10',
      end: '2026-02-15',
      label: 'Jan 10 – Feb 15, 2026',
    });
  });

  it('custom: no comparison when custom dates are missing', () => {
    expect(resolveComparisonDates(START, END, 'custom')).toEqual({
      start: null,
      end: null,
      label: '',
    });
  });

  it('none / unknown modes produce no comparison', () => {
    const empty = { start: null, end: null, label: '' };
    expect(resolveComparisonDates(START, END, 'none')).toEqual(empty);
    expect(resolveComparisonDates(START, END, 'whatever')).toEqual(empty);
  });
});
