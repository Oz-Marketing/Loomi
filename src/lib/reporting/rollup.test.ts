import { describe, it, expect } from 'vitest';
import {
  aggregateMetric,
  aggregateAll,
  rooftopMetricValue,
  sumField,
  hasAnyActivity,
  type RollupMetric,
  type RooftopRow,
} from './rollup';

const SPEND: RollupMetric = { key: 'spend', label: 'Spend', kind: 'sum', field: 'spend', format: String };
const CLICKS: RollupMetric = { key: 'clicks', label: 'Clicks', kind: 'sum', field: 'clicks', format: String };
const IMPRESSIONS: RollupMetric = { key: 'impr', label: 'Impr', kind: 'sum', field: 'impressions', format: String };
const CTR: RollupMetric = { key: 'ctr', label: 'CTR', kind: 'rate', numerator: 'clicks', denominator: 'impressions', scale: 100, format: String };
const CPC: RollupMetric = { key: 'cpc', label: 'CPC', kind: 'rate', numerator: 'spend', denominator: 'clicks', format: String };
const CPM: RollupMetric = { key: 'cpm', label: 'CPM', kind: 'rate', numerator: 'spend', denominator: 'impressions', scale: 1000, format: String };

function row(accountKey: string, metrics: Record<string, number> | null, status: RooftopRow['status'] = 'ok'): RooftopRow {
  return { accountKey, dealer: accountKey, metrics, status };
}

describe('rollup aggregation', () => {
  it('sums additive metrics across rooftops', () => {
    const rows = [
      row('a', { spend: 100, clicks: 10, impressions: 1000 }),
      row('b', { spend: 250, clicks: 40, impressions: 4000 }),
    ];
    expect(aggregateMetric(rows, SPEND)).toBe(350);
    expect(aggregateMetric(rows, CLICKS)).toBe(50);
    expect(aggregateMetric(rows, IMPRESSIONS)).toBe(5000);
  });

  it('recomputes rates from summed numerator/denominator, NOT by averaging', () => {
    // Rooftop A: CTR 1% (10/1000). Rooftop B: CTR 1% (40/4000). Blended = 1%.
    // A naive average of per-rooftop CTRs would also give 1% here, so use a
    // case where weighting matters:
    const rows = [
      row('a', { clicks: 1, impressions: 1000 }), // 0.1% CTR, tiny volume
      row('b', { clicks: 900, impressions: 1000 }), // 90% CTR, same impressions
    ];
    // Correct blended CTR = (1 + 900) / (1000 + 1000) * 100 = 45.05%
    expect(aggregateMetric(rows, CTR)).toBeCloseTo(45.05, 2);
    // A simple average of 0.1% and 90% would be ~45.05% too here (equal denom),
    // so add an unequal-denominator case:
    const rows2 = [
      row('a', { clicks: 5, impressions: 100 }),   // 5% CTR
      row('b', { clicks: 5, impressions: 9900 }),  // ~0.05% CTR
    ];
    // Blended = 10 / 10000 * 100 = 0.1%. Naive average would be ~2.5% — wrong.
    expect(aggregateMetric(rows2, CTR)).toBeCloseTo(0.1, 4);
  });

  it('computes CPC and CPM from summed bases', () => {
    const rows = [
      row('a', { spend: 100, clicks: 50, impressions: 10000 }),
      row('b', { spend: 200, clicks: 50, impressions: 10000 }),
    ];
    // CPC = 300 / 100 = 3.0
    expect(aggregateMetric(rows, CPC)).toBeCloseTo(3.0, 6);
    // CPM = 300 / 20000 * 1000 = 15.0
    expect(aggregateMetric(rows, CPM)).toBeCloseTo(15.0, 6);
  });

  it('returns 0 for a rate when the denominator is 0 (no divide-by-zero)', () => {
    const rows = [row('a', { spend: 100, clicks: 0, impressions: 0 })];
    expect(aggregateMetric(rows, CTR)).toBe(0);
    expect(aggregateMetric(rows, CPC)).toBe(0);
  });

  it('ignores rooftops with null metrics (not-configured / errored)', () => {
    const rows = [
      row('a', { spend: 100, clicks: 10, impressions: 1000 }),
      row('b', null, 'not_configured'),
      row('c', null, 'error'),
    ];
    expect(sumField(rows, 'spend')).toBe(100);
    expect(aggregateMetric(rows, CTR)).toBeCloseTo(1.0, 6); // 10/1000*100
  });

  it('aggregateAll produces the org totals row keyed by metric key', () => {
    const rows = [
      row('a', { spend: 100, clicks: 10, impressions: 1000 }),
      row('b', { spend: 200, clicks: 30, impressions: 3000 }),
    ];
    const totals = aggregateAll(rows, [SPEND, CLICKS, CTR, CPC]);
    expect(totals.spend).toBe(300);
    expect(totals.clicks).toBe(40);
    expect(totals.ctr).toBeCloseTo(1.0, 6); // 40/4000*100
    expect(totals.cpc).toBeCloseTo(7.5, 6); // 300/40
  });

  it('rooftopMetricValue derives a single rooftop rate correctly', () => {
    expect(rooftopMetricValue({ clicks: 25, impressions: 1000 }, CTR)).toBeCloseTo(2.5, 6);
    expect(rooftopMetricValue(null, CTR)).toBe(0);
    expect(rooftopMetricValue({ clicks: 0, impressions: 0 }, CTR)).toBe(0);
  });

  it('hasAnyActivity is true only when some sum metric is non-zero', () => {
    expect(hasAnyActivity([row('a', { spend: 0, clicks: 0, impressions: 0 })], [SPEND, CLICKS])).toBe(false);
    expect(hasAnyActivity([row('a', { spend: 0, clicks: 5, impressions: 0 })], [SPEND, CLICKS])).toBe(true);
    expect(hasAnyActivity([row('a', null, 'error')], [SPEND, CLICKS])).toBe(false);
  });
});
