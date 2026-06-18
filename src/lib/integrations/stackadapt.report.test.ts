import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getAccountMetrics,
  getCampaignPerformance,
  getDailyPerformance,
  StackAdaptError,
  type StackAdaptConfig,
} from './stackadapt';

/**
 * Exercises the GraphQL → normalizeStats pipeline against a mocked endpoint.
 * The derived metrics (ctr/cpc/cpm/cost-per-conversion, rounded to 2 dp) must
 * match Oz Dealer Tools' StackAdaptApi::normalizeStats.
 */

const CFG: StackAdaptConfig = { apiKey: 'test-key', graphqlUrl: 'https://example.test/graphql' };

/** Make global.fetch return one GraphQL { data } (or { errors }) envelope. */
function mockGraphQL(payload: object, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: status < 400, status, json: async () => payload })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('getAccountMetrics', () => {
  it('normalizes totalStats and recomputes derived metrics (rounded to 2dp)', async () => {
    mockGraphQL({
      data: {
        advertiserDelivery: {
          totalStats: {
            impressionsBigint: '10000',
            clicksBigint: '250',
            cost: '300.5',
            conversionsBigint: '20',
            uniqueImpressionsBigint: '9000',
            frequency: '1.2',
          },
        },
      },
    });

    const m = await getAccountMetrics(CFG, 'adv1', '2025-06-01', '2025-06-30');
    expect(m.impressions).toBe(10000);
    expect(m.clicks).toBe(250);
    expect(m.spend).toBe(300.5);
    expect(m.ctr).toBe(2.5); // (250/10000)*100
    expect(m.cpc).toBe(1.2); // 300.5/250 = 1.202 → 1.2
    expect(m.cpm).toBe(30.05); // (300.5/10000)*1000
    expect(m.cost_per_conversion).toBe(15.03); // 300.5/20 = 15.025 → 15.03
    expect(m.unique_impressions).toBe(9000);
    expect(m.frequency).toBe(1.2);
  });

  it('returns zeroed metrics when the advertiser has no stats', async () => {
    mockGraphQL({ data: { advertiserDelivery: {} } });
    const m = await getAccountMetrics(CFG, 'adv1', '2025-06-01', '2025-06-30');
    expect(m).toMatchObject({ impressions: 0, clicks: 0, spend: 0, ctr: 0, cpc: 0, cpm: 0 });
  });

  it('throws StackAdaptError on a GraphQL errors payload', async () => {
    mockGraphQL({ errors: [{ message: 'Advertiser not found' }] });
    await expect(getAccountMetrics(CFG, 'bad', '2025-06-01', '2025-06-30')).rejects.toMatchObject({
      name: 'StackAdaptError',
      code: 'graphql_error',
    });
    expect(() => {
      throw new StackAdaptError('x', 'graphql_error');
    }).toThrow();
  });
});

describe('getCampaignPerformance', () => {
  it('maps + sorts campaigns by spend desc', async () => {
    mockGraphQL({
      data: {
        campaignDelivery: {
          records: {
            nodes: [
              { campaign: { id: '1', name: 'Prospecting' }, metrics: { impressionsBigint: '100', clicksBigint: '2', cost: '50' } },
              { campaign: { id: '2', name: 'Retargeting' }, metrics: { impressionsBigint: '200', clicksBigint: '9', cost: '120' } },
            ],
          },
        },
      },
    });
    const rows = await getCampaignPerformance(CFG, 'adv1', '2025-06-01', '2025-06-30');
    expect(rows.map((r) => r.name)).toEqual(['Retargeting', 'Prospecting']); // 120 > 50
    expect(rows[0]).toMatchObject({ id: '2', spend: 120, impressions: 200 });
  });
});

describe('getDailyPerformance', () => {
  it('extracts the date from startTime and builds a "Mon DD" label, sorted asc', async () => {
    mockGraphQL({
      data: {
        advertiserDelivery: {
          records: {
            nodes: [
              { granularity: { startTime: '2025-06-16T00:00:00Z' }, metrics: { impressionsBigint: '50', cost: '5' } },
              { granularity: { startTime: '2025-06-15T00:00:00Z' }, metrics: { impressionsBigint: '40', cost: '4' } },
            ],
          },
        },
      },
    });
    const rows = await getDailyPerformance(CFG, 'adv1', '2025-06-01', '2025-06-30');
    expect(rows.map((r) => r.date)).toEqual(['2025-06-15', '2025-06-16']); // sorted asc
    expect(rows[0].label).toBe('Jun 15');
  });
});
