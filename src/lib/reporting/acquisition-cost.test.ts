/**
 * These tests are mostly about what the module REFUSES to compute.
 *
 * The arithmetic is division; the value is in the guard rails. A blended cost
 * per unit that silently omits a channel's spend, or a per-channel figure
 * invented for a channel with no attribution, is a confidently wrong number
 * that someone will put in front of a dealer.
 */
import { describe, it, expect } from 'vitest';
import {
  computeAcquisitionCost,
  monthlyAcquisitionCost,
  type ChannelSpendInput,
} from './acquisition-cost';

const ch = (over: Partial<ChannelSpendInput> & { key: string }): ChannelSpendInput => ({
  label: over.key,
  spend: 0,
  ...over,
});

const OUTCOMES = { leads: 100, soldUnits: 20, revenue: 800_000 };

describe('computeAcquisitionCost', () => {
  it('blends spend across every reporting channel', () => {
    const r = computeAcquisitionCost(
      [ch({ key: 'google', spend: 6000 }), ch({ key: 'meta', spend: 4000 })],
      OUTCOMES,
    );
    expect(r.totalSpend).toBe(10_000);
    expect(r.blended.costPerLead).toBe(100);
    expect(r.blended.costPerSoldUnit).toBe(500);
    expect(r.coverage.partial).toBe(false);
  });

  it('flags partial coverage when a channel did not report', () => {
    // The dangerous case: omitting Meta's spend makes cost per unit look BETTER.
    const r = computeAcquisitionCost(
      [
        ch({ key: 'google', spend: 6000 }),
        ch({ key: 'meta', spend: null, label: 'Meta', note: 'Meta not connected' }),
      ],
      OUTCOMES,
    );
    expect(r.totalSpend).toBe(6000);
    expect(r.coverage.partial).toBe(true);
    expect(r.coverage.missing).toEqual([{ label: 'Meta', note: 'Meta not connected' }]);
    // Still computed — but the caller is told it is understated.
    expect(r.blended.costPerSoldUnit).toBe(300);
  });

  it('distinguishes a channel that reported zero from one that did not report', () => {
    const r = computeAcquisitionCost(
      [ch({ key: 'google', spend: 0, label: 'Google Ads' }), ch({ key: 'meta', spend: null, label: 'Meta' })],
      OUTCOMES,
    );
    expect(r.coverage.reporting).toEqual(['Google Ads']);
    expect(r.coverage.missing.map((m) => m.label)).toEqual(['Meta']);
  });

  it('returns null rather than Infinity when there are no outcomes', () => {
    const r = computeAcquisitionCost([ch({ key: 'google', spend: 5000 })], {
      leads: 0,
      soldUnits: 0,
      revenue: 0,
    });
    expect(r.blended.costPerLead).toBeNull();
    expect(r.blended.costPerSoldUnit).toBeNull();
    expect(r.revenuePerDollar).toBeNull();
  });

  it('returns null rather than zero when nothing was spent', () => {
    // Free leads are not a $0 cost per lead — there is simply no rate to state.
    const r = computeAcquisitionCost([ch({ key: 'google', spend: 0 })], OUTCOMES);
    expect(r.blended.costPerLead).toBeNull();
  });

  it('reports revenue per dollar without calling it ROAS', () => {
    const r = computeAcquisitionCost([ch({ key: 'google', spend: 10_000 })], OUTCOMES);
    // Transaction revenue, not gross — the ratio is real, the label matters.
    expect(r.revenuePerDollar).toBe(80);
  });
});

describe('per-channel attribution', () => {
  it('includes only channels with platform-imported offline conversions', () => {
    const r = computeAcquisitionCost(
      [
        ch({ key: 'google', label: 'Google Ads', spend: 6000, offlineLeads: 60, offlinePurchases: 12 }),
        // No offline import configured — must be absent, not zero.
        ch({ key: 'meta', label: 'Meta', spend: 4000 }),
      ],
      OUTCOMES,
    );
    expect(r.attributed).toHaveLength(1);
    expect(r.attributed[0]).toMatchObject({
      key: 'google',
      costPerLead: 100,
      costPerSoldUnit: 500,
    });
  });

  it('drops a channel that has the capability but matched nothing', () => {
    // Reporting "$4,000 for 0 purchases" as a channel row reads as a failure of
    // the channel when it is a failure of the matchback.
    const r = computeAcquisitionCost(
      [ch({ key: 'meta', spend: 4000, offlineLeads: 0, offlinePurchases: 0 })],
      OUTCOMES,
    );
    expect(r.attributed).toEqual([]);
  });

  it('never falls back to the blended figure for an unattributed channel', () => {
    const r = computeAcquisitionCost(
      [ch({ key: 'google', spend: 6000 }), ch({ key: 'meta', spend: 4000 })],
      OUTCOMES,
    );
    // Both channels have spend and the blend is computable, but neither has
    // attribution — so there are no per-channel rows at all.
    expect(r.blended.costPerSoldUnit).toBe(500);
    expect(r.attributed).toEqual([]);
  });

  it('handles a channel with leads attributed but no purchases', () => {
    const r = computeAcquisitionCost(
      [ch({ key: 'google', spend: 6000, offlineLeads: 60, offlinePurchases: 0 })],
      OUTCOMES,
    );
    expect(r.attributed[0].costPerLead).toBe(100);
    expect(r.attributed[0].costPerSoldUnit).toBeNull();
  });
});

describe('monthlyAcquisitionCost', () => {
  it('joins spend and outcomes by period and labels them', () => {
    const rows = monthlyAcquisitionCost(
      { '2026-06': 9000, '2026-07': 10_000 },
      { '2026-06': { leads: 90, soldUnits: 18 }, '2026-07': { leads: 100, soldUnits: 25 } },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ period: '2026-06', costPerLead: 100, costPerSoldUnit: 500 });
    expect(rows[1]).toMatchObject({ period: '2026-07', costPerLead: 100, costPerSoldUnit: 400 });
    expect(rows[0].label).toBe('Jun 26');
  });

  it('yields null, not a spike, for a month that spent but closed nothing yet', () => {
    // The in-flight month. An infinite cost per unit would dominate the chart
    // and say nothing true about it.
    const rows = monthlyAcquisitionCost(
      { '2026-08': 5000 },
      { '2026-08': { leads: 40, soldUnits: 0 } },
    );
    expect(rows[0].costPerLead).toBe(125);
    expect(rows[0].costPerSoldUnit).toBeNull();
  });

  it('includes months present in only one of the two sources', () => {
    const rows = monthlyAcquisitionCost({ '2026-05': 4000 }, { '2026-06': { leads: 10, soldUnits: 2 } });
    expect(rows.map((r) => r.period)).toEqual(['2026-05', '2026-06']);
    expect(rows[0].soldUnits).toBe(0);
    expect(rows[1].spend).toBe(0);
  });

  it('sorts chronologically regardless of input order', () => {
    const rows = monthlyAcquisitionCost(
      { '2026-12': 1, '2026-02': 1, '2026-07': 1 },
      {},
    );
    expect(rows.map((r) => r.period)).toEqual(['2026-02', '2026-07', '2026-12']);
  });
});
