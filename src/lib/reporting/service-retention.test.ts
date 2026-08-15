import { describe, it, expect } from 'vitest';
import {
  foldSalesCohorts,
  foldServiceCohorts,
  buildRetentionSummary,
  foldCoverage,
  type SalesCohortRow,
  type ServiceCohortRow,
} from './service-retention';

// Maturity and the blended denominators are where a retention report quietly
// lies: an unfinished cohort reads as bad retention rather than as an unfinished
// cohort. These pin that behaviour down.

/** Fixed "now" so maturity assertions don't drift with the wall clock. */
const NOW = new Date('2026-08-14T00:00:00Z');

const cohort = (o: Partial<SalesCohortRow>): SalesCohortRow => ({
  cohort_year: 2024,
  total_sold: 0,
  retained_12m: 0,
  retained_24m: 0,
  retained_ever: 0,
  ...o,
});

const svcCohort = (o: Partial<ServiceCohortRow>): ServiceCohortRow => ({
  first_visit_year: 2024,
  total_first_timers: 0,
  returned_12m: 0,
  ...o,
});

describe('foldSalesCohorts — maturity', () => {
  it('marks a cohort from two years ago mature on both windows', () => {
    const [c] = foldSalesCohorts([cohort({ cohort_year: 2024, total_sold: 100 })], NOW);
    expect(c.monthsOld).toBe(31);
    expect(c.mature12m).toBe(true);
    expect(c.mature24m).toBe(true);
  });

  it('marks last year mature at 12 months but not 24', () => {
    const [c] = foldSalesCohorts([cohort({ cohort_year: 2025, total_sold: 100 })], NOW);
    expect(c.monthsOld).toBe(19);
    expect(c.mature12m).toBe(true);
    expect(c.mature24m).toBe(false);
  });

  it('marks the current year immature on both', () => {
    const [c] = foldSalesCohorts([cohort({ cohort_year: 2026, total_sold: 100 })], NOW);
    expect(c.mature12m).toBe(false);
    expect(c.mature24m).toBe(false);
  });

  it('reports null, not a low rate, for a window that has not closed', () => {
    // The whole point: a 2026 cohort at 8% would read as terrible retention
    // rather than as a year that hasn't finished happening.
    const [c] = foldSalesCohorts(
      [cohort({ cohort_year: 2026, total_sold: 100, retained_12m: 8, retained_ever: 8 })],
      NOW,
    );
    expect(c.rate12m).toBeNull();
    expect(c.rate24m).toBeNull();
    // "Ever" has no window to close, so it is always reportable.
    expect(c.rateEver).toBe(8);
  });

  it('computes rates to one decimal for a mature cohort', () => {
    const [c] = foldSalesCohorts(
      [
        cohort({
          cohort_year: 2024,
          total_sold: 300,
          retained_12m: 141,
          retained_24m: 180,
          retained_ever: 201,
        }),
      ],
      NOW,
    );
    expect(c.rate12m).toBe(47);
    expect(c.rate24m).toBe(60);
    expect(c.rateEver).toBe(67);
  });

  it('sorts newest cohort first', () => {
    const out = foldSalesCohorts(
      [
        cohort({ cohort_year: 2022, total_sold: 1 }),
        cohort({ cohort_year: 2024, total_sold: 1 }),
        cohort({ cohort_year: 2023, total_sold: 1 }),
      ],
      NOW,
    );
    expect(out.map((c) => c.cohortYear)).toEqual([2024, 2023, 2022]);
  });

  it('returns null rather than NaN for an empty cohort', () => {
    const [c] = foldSalesCohorts([cohort({ cohort_year: 2024, total_sold: 0 })], NOW);
    expect(c.rate12m).toBeNull();
    expect(c.rateEver).toBeNull();
  });
});

describe('foldServiceCohorts', () => {
  it('derives the lost count and the return rate', () => {
    const [c] = foldServiceCohorts([
      svcCohort({ first_visit_year: 2024, total_first_timers: 400, returned_12m: 130 }),
    ]);
    expect(c.returned12m).toBe(130);
    expect(c.lost12m).toBe(270);
    expect(c.rate12m).toBe(32.5);
  });

  it('sorts newest first and survives an empty cohort', () => {
    const out = foldServiceCohorts([
      svcCohort({ first_visit_year: 2023, total_first_timers: 0 }),
      svcCohort({ first_visit_year: 2025, total_first_timers: 10, returned_12m: 5 }),
    ]);
    expect(out.map((c) => c.firstVisitYear)).toEqual([2025, 2023]);
    expect(out[1].rate12m).toBeNull();
  });
});

describe('buildRetentionSummary — separate denominators', () => {
  it('keeps a 12m-only-mature cohort out of the 24-month denominator', () => {
    // 2024 is mature on both. 2025 is mature at 12m only. If 2025's 200 buyers
    // leaked into the 24m denominator they could contribute nothing to its
    // numerator, and the 24m rate would read 60/300 = 20% instead of 60%.
    const cohorts = foldSalesCohorts(
      [
        cohort({
          cohort_year: 2024,
          total_sold: 100,
          retained_12m: 50,
          retained_24m: 60,
          retained_ever: 65,
        }),
        cohort({
          cohort_year: 2025,
          total_sold: 200,
          retained_12m: 80,
          retained_24m: 80,
          retained_ever: 90,
        }),
      ],
      NOW,
    );
    const s = buildRetentionSummary(cohorts, []);

    expect(s.salesTotal).toBe(300); // both are 12m-mature
    expect(s.salesRate12m).toBe(round(130 / 300));
    expect(s.salesTotal24m).toBe(100); // only 2024
    expect(s.salesRate24m).toBe(60);
  });

  it('excludes an immature cohort from both rate denominators but not from "ever"', () => {
    const cohorts = foldSalesCohorts(
      [
        cohort({
          cohort_year: 2024,
          total_sold: 100,
          retained_12m: 50,
          retained_24m: 60,
          retained_ever: 65,
        }),
        cohort({ cohort_year: 2026, total_sold: 50, retained_12m: 4, retained_ever: 4 }),
      ],
      NOW,
    );
    const s = buildRetentionSummary(cohorts, []);

    expect(s.salesTotal).toBe(100);
    expect(s.salesTotal24m).toBe(100);
    // "Ever" uses every cohort, mature or not — there is no window to wait on.
    expect(s.salesTotalAll).toBe(150);
    expect(s.salesRetainedEver).toBe(69);
    expect(s.salesRateEver).toBe(46);
  });

  it('blends the service-only metric across all its cohorts', () => {
    const s = buildRetentionSummary(
      [],
      foldServiceCohorts([
        svcCohort({ first_visit_year: 2024, total_first_timers: 200, returned_12m: 60 }),
        svcCohort({ first_visit_year: 2025, total_first_timers: 300, returned_12m: 120 }),
      ]),
    );
    expect(s.svcTotal).toBe(500);
    expect(s.svcRetained12m).toBe(180);
    expect(s.svcRate12m).toBe(36);
  });

  it('returns nulls rather than NaN when an account has no history', () => {
    const s = buildRetentionSummary([], []);
    expect(s.salesRate12m).toBeNull();
    expect(s.salesRate24m).toBeNull();
    expect(s.salesRateEver).toBeNull();
    expect(s.svcRate12m).toBeNull();
  });
});

describe('foldCoverage', () => {
  it('reports the linked share across both event types', () => {
    const c = foldCoverage([
      { type: 'sale', total: 100, linked: 90 },
      { type: 'service', total: 300, linked: 210 },
    ]);
    expect(c.saleEventsLinked).toBe(90);
    expect(c.serviceEventsLinked).toBe(210);
    expect(c.overall).toBe(0.75);
  });

  it('handles an account with only one event type', () => {
    const c = foldCoverage([{ type: 'service', total: 50, linked: 25 }]);
    expect(c.saleEvents).toBe(0);
    expect(c.overall).toBe(0.5);
  });

  it('reports zero coverage for an empty account without dividing by zero', () => {
    const c = foldCoverage([]);
    expect(c.overall).toBe(0);
  });
});

/** Mirror of the lib's one-decimal rounding, for expectation clarity. */
function round(fraction: number): number {
  return Math.round(fraction * 1000) / 10;
}
