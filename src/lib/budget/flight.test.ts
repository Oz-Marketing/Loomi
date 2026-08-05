import { describe, it, expect } from 'vitest';
import { flightCrossesYears, flightDays, flightMonths, splitFlight } from './flight';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

describe('flightDays', () => {
  it('counts both ends', () => {
    // A one-day flight is one day, not zero. Off-by-one here silently shifts
    // every share in a multi-month split.
    expect(flightDays(d('2026-03-20'), d('2026-03-20'))).toBe(1);
    expect(flightDays(d('2026-03-20'), d('2026-03-21'))).toBe(2);
  });

  it('counts across a month boundary', () => {
    expect(flightDays(d('2026-03-30'), d('2026-04-02'))).toBe(4);
  });

  it('counts a leap day', () => {
    expect(flightDays(d('2028-02-01'), d('2028-02-29'))).toBe(29);
    expect(flightDays(d('2026-02-01'), d('2026-02-28'))).toBe(28);
  });
});

describe('flightMonths', () => {
  it('splits a three-month flight by real day counts', () => {
    // 20–31 Mar = 12, all of Apr = 30, 1–10 May = 10.
    expect(flightMonths(d('2026-03-20'), d('2026-05-10'))).toEqual([
      { period: '2026-03', days: 12 },
      { period: '2026-04', days: 30 },
      { period: '2026-05', days: 10 },
    ]);
  });

  it('returns a single month for a within-month flight', () => {
    expect(flightMonths(d('2026-07-05'), d('2026-07-19'))).toEqual([{ period: '2026-07', days: 15 }]);
  });

  it('keeps a one-day tail rather than dropping it', () => {
    const months = flightMonths(d('2026-06-28'), d('2026-07-01'));
    expect(months).toEqual([
      { period: '2026-06', days: 3 },
      { period: '2026-07', days: 1 },
    ]);
  });

  it('rolls over the year', () => {
    expect(flightMonths(d('2026-12-15'), d('2027-01-14'))).toEqual([
      { period: '2026-12', days: 17 },
      { period: '2027-01', days: 14 },
    ]);
  });

  it('never loses a day of the flight', () => {
    const [s, e] = [d('2026-01-17'), d('2026-11-03')];
    expect(sum(flightMonths(s, e).map((m) => m.days))).toBe(flightDays(s, e));
  });

  it('is empty when the end precedes the start', () => {
    expect(flightMonths(d('2026-05-10'), d('2026-05-01'))).toEqual([]);
  });
});

describe('splitFlight', () => {
  it('weights by days, not by month count', () => {
    // The whole point. An even three-way split would give March 33% for 12
    // days of running — double what it actually spends.
    const parts = splitFlight(d('2026-03-20'), d('2026-05-10'), 52_000);
    expect(parts.map((p) => p.period)).toEqual(['2026-03', '2026-04', '2026-05']);
    expect(parts[0].amount).toBeCloseTo(12_000, 2); // 12/52
    expect(parts[1].amount).toBeCloseTo(30_000, 2); // 30/52
    expect(parts[2].amount).toBeCloseTo(10_000, 2); // 10/52
  });

  it('sums to the total exactly, even when it does not divide', () => {
    // 1/3 of $100 three ways is the classic case where naive rounding loses a
    // cent and the insertion order stops reconciling.
    const parts = splitFlight(d('2026-04-01'), d('2026-06-30'), 100);
    expect(sum(parts.map((p) => p.amount))).toBe(100);
  });

  it('sums exactly across a long, awkward flight', () => {
    const parts = splitFlight(d('2026-01-17'), d('2026-11-03'), 87_654.31);
    expect(sum(parts.map((p) => p.amount))).toBeCloseTo(87_654.31, 10);
  });

  it('gives a single-month flight the whole amount', () => {
    const parts = splitFlight(d('2026-07-05'), d('2026-07-19'), 4_500);
    expect(parts).toHaveLength(1);
    expect(parts[0].amount).toBe(4_500);
  });

  it('is empty for a reversed range', () => {
    expect(splitFlight(d('2026-05-10'), d('2026-05-01'), 1000)).toEqual([]);
  });

  it('returns zeroed months for a zero total rather than nothing', () => {
    // A $0 flight is still a flight — a placeholder buy someone will fund
    // later. Dropping the months would make it vanish from the grid.
    const parts = splitFlight(d('2026-03-01'), d('2026-04-30'), 0);
    expect(parts).toHaveLength(2);
    expect(sum(parts.map((p) => p.amount))).toBe(0);
  });
});

describe('flightCrossesYears', () => {
  it('flags a flight that spans the new year', () => {
    expect(flightCrossesYears(d('2026-12-15'), d('2027-01-14'))).toBe(true);
    expect(flightCrossesYears(d('2026-01-01'), d('2026-12-31'))).toBe(false);
  });
});
