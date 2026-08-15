import { describe, it, expect } from 'vitest';
import {
  classifySale,
  foldSales,
  foldService,
  type SalesGroupRow,
  type ServiceGroupRow,
} from './dealer-trends';

// The risk in these reports is not the SQL — it's reconciling two source
// shapes (automotive vs. powersports) that the Oz Reports bridge does NOT
// normalize into the same `details` keys. These cover that seam.

const sale = (o: Partial<SalesGroupRow>): SalesGroupRow => ({
  month: '2026-01-01',
  sale_type: '',
  deal_type: '',
  units: 0,
  revenue: 0,
  apr_sum: 0,
  apr_n: 0,
  ...o,
});

const service = (o: Partial<ServiceGroupRow>): ServiceGroupRow => ({
  month: '2026-01-01',
  ro_count: 0,
  total_revenue: 0,
  customer_pay: 0,
  warranty_pay: 0,
  internal_pay: 0,
  ...o,
});

describe('classifySale', () => {
  it('reads the automotive shape (NEW/USED + LEASE)', () => {
    expect(classifySale('', 'NEW')).toBe('new');
    expect(classifySale('', 'USED')).toBe('used');
    expect(classifySale('LEASE', 'NEW')).toBe('lease');
  });

  it('reads the powersports shape (N/U)', () => {
    expect(classifySale('', 'N')).toBe('new');
    expect(classifySale('', 'U')).toBe('used');
  });

  it('lets lease win over new/used, as ODT does', () => {
    // A leased new car is one unit. If it counted as both new AND lease the
    // mix would over-report against the unit total.
    expect(classifySale('LEASE', 'NEW')).toBe('lease');
    expect(classifySale('LEASE', 'USED')).toBe('lease');
  });

  it('is insensitive to case and padding from the source', () => {
    expect(classifySale(' lease ', 'new')).toBe('lease');
    expect(classifySale('', ' used ')).toBe('used');
  });

  it('buckets anything unrecognized as other rather than dropping it', () => {
    expect(classifySale('', '')).toBe('other');
    expect(classifySale('', 'WHOLESALE')).toBe('other');
  });
});

describe('foldSales', () => {
  it('splits the mix and reconciles it to the unit total', () => {
    const { months, summary } = foldSales([
      sale({ deal_type: 'NEW', units: 10, revenue: 400_000 }),
      sale({ deal_type: 'USED', units: 6, revenue: 150_000 }),
      sale({ sale_type: 'LEASE', deal_type: 'NEW', units: 4, revenue: 120_000 }),
      sale({ deal_type: 'WHOLESALE', units: 2, revenue: 30_000 }),
    ]);

    expect(months).toHaveLength(1);
    const m = months[0];
    expect([m.newUnits, m.usedUnits, m.leaseUnits, m.otherUnits]).toEqual([10, 6, 4, 2]);
    // The whole point of the `other` bucket: the mix must equal the total.
    expect(m.newUnits + m.usedUnits + m.leaseUnits + m.otherUnits).toBe(m.totalUnits);
    expect(m.totalUnits).toBe(22);
    expect(m.totalRevenue).toBe(700_000);
    expect(summary.totalUnits).toBe(22);
  });

  it('collapses several type rows into one month bucket', () => {
    const { months } = foldSales([
      sale({ month: '2026-01-01', deal_type: 'NEW', units: 3, revenue: 90_000 }),
      sale({ month: '2026-01-01', deal_type: 'USED', units: 2, revenue: 40_000 }),
      sale({ month: '2026-02-01', deal_type: 'NEW', units: 5, revenue: 150_000 }),
    ]);
    expect(months.map((m) => m.month)).toEqual(['2026-01-01', '2026-02-01']);
    expect(months[0].totalUnits).toBe(5);
    expect(months[1].totalUnits).toBe(5);
  });

  it('orders months chronologically regardless of row order', () => {
    const { months } = foldSales([
      sale({ month: '2026-03-01', deal_type: 'NEW', units: 1 }),
      sale({ month: '2026-01-01', deal_type: 'NEW', units: 1 }),
      sale({ month: '2026-02-01', deal_type: 'NEW', units: 1 }),
    ]);
    expect(months.map((m) => m.month)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  });

  it('labels months in UTC so a late-month event cannot slip a bucket', () => {
    const { months } = foldSales([sale({ month: '2026-01-01', deal_type: 'NEW', units: 1 })]);
    expect(months[0].label).toBe('Jan 2026');
  });

  it('averages APR only over deals that reported one, and says how many did', () => {
    const { summary } = foldSales([
      sale({ deal_type: 'NEW', units: 4, apr_sum: 20, apr_n: 4 }), // mean 5.0
      sale({ deal_type: 'USED', units: 6, apr_sum: 0, apr_n: 0 }), // cash deals
    ]);
    expect(summary.avgApr).toBe(5);
    // 4 of 10 units carried an APR — the UI uses this to caveat the number.
    expect(summary.aprCoverage).toBeCloseTo(0.4);
  });

  it('reports a null APR rather than 0 when nothing carried one', () => {
    // 0% APR is a real promotional rate; "no data" must not render as one.
    const { summary } = foldSales([sale({ deal_type: 'NEW', units: 5 })]);
    expect(summary.avgApr).toBeNull();
    expect(summary.aprCoverage).toBe(0);
  });

  it('returns zeroed totals for an empty range without dividing by zero', () => {
    const { months, summary } = foldSales([]);
    expect(months).toEqual([]);
    expect(summary.totalUnits).toBe(0);
    expect(summary.avgPrice).toBe(0);
    expect(summary.avgApr).toBeNull();
  });
});

describe('foldService', () => {
  it('keeps the automotive pay split and leaves no unsplit remainder', () => {
    // Automotive `amount` is the sum of the three pay types by construction.
    const { months } = foldService([
      service({
        ro_count: 100,
        total_revenue: 50_000,
        customer_pay: 30_000,
        warranty_pay: 15_000,
        internal_pay: 5_000,
      }),
    ]);
    expect(months[0].unsplitPay).toBe(0);
    expect(months[0].avgRoValue).toBe(500);
  });

  it('puts powersports revenue in the unsplit bucket instead of showing zeros', () => {
    // ps_service_data ships `totalowed` and no pay-type columns at all. Three
    // zero segments would read as "billed nothing" to a powersports dealer.
    const { months, summary } = foldService([
      service({ ro_count: 40, total_revenue: 20_000 }),
    ]);
    expect(months[0].unsplitPay).toBe(20_000);
    expect(months[0].totalRevenue).toBe(20_000);
    expect(summary.splitCoverage).toBe(0);
  });

  it('reports partial split coverage for a mixed range', () => {
    const { summary } = foldService([
      service({ month: '2026-01-01', ro_count: 10, total_revenue: 10_000, customer_pay: 10_000 }),
      service({ month: '2026-02-01', ro_count: 10, total_revenue: 10_000 }),
    ]);
    expect(summary.totalRevenue).toBe(20_000);
    expect(summary.unsplitPay).toBe(10_000);
    expect(summary.splitCoverage).toBe(0.5);
  });

  it('clamps a split that overshoots the RO total', () => {
    // A bad source row must not render as a negative stacked segment.
    const { months } = foldService([
      service({ ro_count: 1, total_revenue: 100, customer_pay: 250 }),
    ]);
    expect(months[0].unsplitPay).toBe(0);
  });

  it('handles a month with ROs but no revenue without dividing by zero', () => {
    const { months } = foldService([service({ ro_count: 5, total_revenue: 0 })]);
    expect(months[0].avgRoValue).toBe(0);
  });

  it('returns zeroed totals for an empty range', () => {
    const { months, summary } = foldService([]);
    expect(months).toEqual([]);
    expect(summary.roCount).toBe(0);
    expect(summary.splitCoverage).toBe(0);
  });
});
