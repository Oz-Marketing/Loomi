import { describe, it, expect } from 'vitest';
import { commitmentForYear, monthsInYear, termMonths, termMonthsInYear } from './term';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('termMonths', () => {
  it('counts a calendar year as twelve', () => {
    expect(termMonths(d('2026-01-01'), d('2026-12-31'))).toBe(12);
  });

  it('counts a term that crosses the new year', () => {
    expect(termMonths(d('2026-03-01'), d('2027-02-28'))).toBe(12);
  });

  it('counts a single month, however few days of it', () => {
    expect(termMonths(d('2026-05-17'), d('2026-05-18'))).toBe(1);
  });

  it('counts a multi-year term', () => {
    expect(termMonths(d('2026-01-01'), d('2028-12-31'))).toBe(36);
  });
});

describe('monthsInYear', () => {
  it('gives a calendar-year term all twelve', () => {
    expect(monthsInYear(d('2026-01-01'), d('2026-12-31'), 2026)).toBe(12);
  });

  it('splits a crossing term across both years', () => {
    const [s, e] = [d('2026-03-01'), d('2027-02-28')];
    expect(monthsInYear(s, e, 2026)).toBe(10);
    expect(monthsInYear(s, e, 2027)).toBe(2);
    // The two shares must be the whole term, or a year of money goes missing.
    expect(monthsInYear(s, e, 2026) + monthsInYear(s, e, 2027)).toBe(termMonths(s, e));
  });

  it('returns zero for a year the term never touches', () => {
    expect(monthsInYear(d('2026-01-01'), d('2026-12-31'), 2025)).toBe(0);
    expect(monthsInYear(d('2026-01-01'), d('2026-12-31'), 2027)).toBe(0);
  });

  it('counts a partial month at either edge as a whole one', () => {
    // Budget is monthly; a term running to Feb 3rd still has a February in it.
    expect(monthsInYear(d('2026-12-28'), d('2027-02-03'), 2026)).toBe(1);
    expect(monthsInYear(d('2026-12-28'), d('2027-02-03'), 2027)).toBe(2);
  });

  it('gives a multi-year term a full twelve for the middle year', () => {
    expect(monthsInYear(d('2026-06-01'), d('2028-05-31'), 2027)).toBe(12);
  });
});

describe('commitmentForYear', () => {
  it('gives a calendar-year term its whole commitment', () => {
    expect(
      commitmentForYear({ startDate: d('2026-01-01'), endDate: d('2026-12-31'), committedAmount: 120_000 }, 2026),
    ).toBe(120_000);
  });

  it('splits a crossing term by months, and the halves add back up', () => {
    const term = { startDate: d('2026-04-01'), endDate: d('2027-03-31'), committedAmount: 120_000 };
    expect(commitmentForYear(term, 2026)).toBe(90_000); // 9/12
    expect(commitmentForYear(term, 2027)).toBe(30_000); // 3/12
    expect(commitmentForYear(term, 2026)! + commitmentForYear(term, 2027)!).toBe(120_000);
  });

  it('returns zero for a year outside the term, not the full amount', () => {
    expect(
      commitmentForYear({ startDate: d('2026-01-01'), endDate: d('2026-12-31'), committedAmount: 50_000 }, 2030),
    ).toBe(0);
  });

  it('returns null when nothing was committed', () => {
    // Distinct from 0: "we have not been told the number" is not "the number is
    // zero", and the hub shows no target rather than an instant over-budget.
    expect(
      commitmentForYear({ startDate: d('2026-01-01'), endDate: d('2026-12-31'), committedAmount: null }, 2026),
    ).toBeNull();
  });

  it('pro-rates a multi-year commitment evenly', () => {
    const term = { startDate: d('2026-01-01'), endDate: d('2028-12-31'), committedAmount: 360_000 };
    for (const y of [2026, 2027, 2028]) expect(commitmentForYear(term, y)).toBe(120_000);
  });
});

describe('termMonthsInYear', () => {
  it('lists every month of a calendar-year term', () => {
    expect(termMonthsInYear(d('2026-01-01'), d('2026-12-31'), 2026)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it('lists only the covered months of a crossing term', () => {
    expect(termMonthsInYear(d('2026-04-01'), d('2027-03-31'), 2026)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(termMonthsInYear(d('2026-04-01'), d('2027-03-31'), 2027)).toEqual([1, 2, 3]);
  });

  it('is empty for an untouched year', () => {
    expect(termMonthsInYear(d('2026-04-01'), d('2026-06-30'), 2027)).toEqual([]);
  });

  it('agrees with monthsInYear on how many months there are', () => {
    const [s, e] = [d('2026-11-15'), d('2027-08-02')];
    for (const y of [2026, 2027]) {
      expect(termMonthsInYear(s, e, y)).toHaveLength(monthsInYear(s, e, y));
    }
  });
});
