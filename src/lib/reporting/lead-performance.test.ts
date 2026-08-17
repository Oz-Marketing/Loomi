import { describe, it, expect } from 'vitest';
import {
  clampDay,
  daysInMonth,
  foldBreakdown,
  foldMonths,
  normalizeLeadCategory,
  parsePeriod,
  pctChange,
  periodLabel,
  proratePartial,
  shiftPeriod,
} from './lead-performance';

// The port here is the MATH, not the data access. ODT had monthly aggregates
// and prorated; Loomi has per-lead timestamps and compares exactly. These pin
// down the difference and the edges the exact method introduces.

describe('daysInMonth', () => {
  it('knows month lengths, including February in a leap year', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29); // leap
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('clampDay', () => {
  it('clamps a day the target month does not have', () => {
    // 31 March vs February: there is no 31st to compare against, so the
    // comparison covers all of February.
    expect(clampDay(31, 2026, 2)).toBe(28);
    expect(clampDay(31, 2024, 2)).toBe(29);
    expect(clampDay(31, 2026, 4)).toBe(30);
  });

  it('leaves a day the month does have alone', () => {
    expect(clampDay(15, 2026, 2)).toBe(15);
    expect(clampDay(31, 2026, 1)).toBe(31);
  });
});

describe('period helpers', () => {
  it('parses and labels a period in UTC', () => {
    expect(parsePeriod('2026-07')).toEqual({ year: 2026, month: 7 });
    expect(periodLabel('2026-07')).toBe('Jul 2026');
    expect(periodLabel('2026-01')).toBe('Jan 2026');
  });

  it('shifts back across a year boundary', () => {
    expect(shiftPeriod('2026-07', 1)).toBe('2026-06');
    expect(shiftPeriod('2026-01', 1)).toBe('2025-12');
    expect(shiftPeriod('2026-07', 12)).toBe('2025-07');
    expect(shiftPeriod('2026-03', 14)).toBe('2025-01');
  });

  it('shifting by zero is the identity', () => {
    expect(shiftPeriod('2026-07', 0)).toBe('2026-07');
  });
});

describe('pctChange', () => {
  it('computes a signed percentage to one decimal', () => {
    expect(pctChange(120, 100)).toBe(20);
    expect(pctChange(80, 100)).toBe(-20);
    expect(pctChange(133, 100)).toBe(33);
  });

  it('returns null when there is no prior base', () => {
    // 0 → 12 is not "no growth" (0%) and not Infinity; it is undefined, and
    // the UI needs to say "no prior leads" rather than print either.
    expect(pctChange(12, 0)).toBeNull();
    expect(pctChange(0, 0)).toBeNull();
  });

  it('reports a drop to zero as -100%', () => {
    expect(pctChange(0, 40)).toBe(-100);
  });
});

describe('proratePartial — ODT’s method, kept for reconciliation', () => {
  it('scales a total linearly by the fraction of the month elapsed', () => {
    expect(proratePartial(310, 15, 31)).toBe(150);
    expect(proratePartial(280, 14, 28)).toBe(140);
  });

  it('returns the whole total at the end of the month', () => {
    expect(proratePartial(310, 31, 31)).toBe(310);
  });

  it('does not divide by zero on a nonsense month length', () => {
    expect(proratePartial(310, 15, 0)).toBe(0);
  });

  it('differs from an exact count whenever leads are not evenly spread', () => {
    // 300 leads in a 30-day month, but 200 of them landed in the first 10 days
    // (a campaign flight). ODT would estimate 100 for the first third.
    expect(proratePartial(300, 10, 30)).toBe(100);
    // Loomi counts the actual 200 — which is why the report does not prorate.
    expect(proratePartial(300, 10, 30)).not.toBe(200);
  });
});

describe('foldMonths', () => {
  it('derives a conversion rate and orders chronologically', () => {
    const out = foldMonths([
      { period: '2026-03', leads: 100, converted: 12 },
      { period: '2026-01', leads: 80, converted: 8 },
      { period: '2026-02', leads: 50, converted: 5 },
    ]);
    expect(out.map((m) => m.period)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(out.map((m) => m.conversionRate)).toEqual([10, 10, 12]);
    expect(out[0].label).toBe('Jan 2026');
  });

  it('reports a null conversion rate for a month with no leads', () => {
    // A rate over zero leads is undefined, not 0% — 0% reads as "we converted
    // none of the leads we got", which is a different (and wrong) claim.
    const [m] = foldMonths([{ period: '2026-01', leads: 0, converted: 0 }]);
    expect(m.conversionRate).toBeNull();
  });

  it('handles an empty range', () => {
    expect(foldMonths([])).toEqual([]);
  });
});

describe('foldBreakdown', () => {
  it('computes shares and sorts by volume', () => {
    const out = foldBreakdown([
      { label: 'Autotrader', leads: 25 },
      { label: 'Website', leads: 75 },
    ]);
    expect(out.map((r) => r.label)).toEqual(['Website', 'Autotrader']);
    expect(out.map((r) => r.share)).toEqual([0.75, 0.25]);
  });

  it('folds null and blank labels into one Unknown bucket rather than dropping them', () => {
    // Dropping them would make the breakdown sum to less than the headline
    // count, which is the classic "where did my leads go" bug.
    const out = foldBreakdown(
      [
        { label: null, leads: 10 },
        { label: '   ', leads: 5 },
        { label: 'Website', leads: 85 },
      ],
      'Unknown source',
    );
    // Was asserting 2 — "grouped by the DB, labelled here" — which contradicted
    // this test's own name and rendered "Unknown source" twice in the chart,
    // each with its own share. foldBreakdown merges by final label now.
    const unknown = out.filter((r) => r.label === 'Unknown source');
    expect(unknown).toHaveLength(1);
    expect(unknown[0].leads).toBe(15);
    expect(out.reduce((n, r) => n + r.leads, 0)).toBe(100);
    expect(out.reduce((n, r) => n + r.share, 0)).toBeCloseTo(1);
  });

  it('breaks ties by label so the table does not reshuffle between loads', () => {
    const out = foldBreakdown([
      { label: 'Website', leads: 10 },
      { label: 'Autotrader', leads: 10 },
    ]);
    expect(out.map((r) => r.label)).toEqual(['Autotrader', 'Website']);
  });

  it('returns zero shares rather than NaN when there are no leads', () => {
    const out = foldBreakdown([{ label: 'Website', leads: 0 }]);
    expect(out[0].share).toBe(0);
  });
});

describe('normalizeLeadCategory', () => {
  // The CRMs send two conventions, so the Lead Categories chart was splitting
  // one category across two rows: INTERNET 1,839 + Internet 1,133.
  it('merges the two CRM conventions onto one label', () => {
    expect(normalizeLeadCategory('INTERNET')).toBe(normalizeLeadCategory('Internet'));
    expect(normalizeLeadCategory('WALK_IN')).toBe(normalizeLeadCategory('Walk-in'));
    // Differs by more than case, so casing alone would not have merged it.
    expect(normalizeLeadCategory('PHONE_UP')).toBe(normalizeLeadCategory('Phone'));
  });

  it('uses the readable form', () => {
    expect(normalizeLeadCategory('WALK_IN')).toBe('Walk-in');
    expect(normalizeLeadCategory('PHONE_UP')).toBe('Phone');
    expect(normalizeLeadCategory('oem')).toBe('OEM');
  });

  it('keeps an unrecognised category rather than dropping it', () => {
    expect(normalizeLeadCategory('SOME_NEW_THING')).toBe('Some New Thing');
  });
});

describe('foldBreakdown merging', () => {
  it('combines rows that normalise onto the same label', () => {
    const out = foldBreakdown(
      [
        { label: 'Internet', leads: 30 },
        { label: 'Internet', leads: 20 },
        { label: 'AutoTrader.com', leads: 50 },
      ],
      'Unknown',
    );
    expect(out).toHaveLength(2);
    const internet = out.find((r) => r.label === 'Internet')!;
    expect(internet.leads).toBe(50);
    // Shares are computed after merging, so they still sum to 1.
    expect(out.reduce((n, r) => n + r.share, 0)).toBeCloseTo(1);
  });

  it('folds nulls and blanks into one unknown bucket', () => {
    const out = foldBreakdown(
      [
        { label: null, leads: 5 },
        { label: '   ', leads: 3 },
        { label: 'CDK', leads: 2 },
      ],
      'Unknown source',
    );
    expect(out.find((r) => r.label === 'Unknown source')!.leads).toBe(8);
    expect(out).toHaveLength(2);
  });
});
