import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getAccountMetrics,
  getCampaignPerformance,
  getDailyPerformance,
  getDevicePerformance,
  type MetaConfig,
} from './meta-ads';
import { applyMetaMargins } from '@/lib/reporting/margins';

/**
 * Exercises the report fetchers against a mocked Graph API, validating the
 * parse → conversion-classification → report-shape pipeline that the pure
 * margin/comparison tests don't reach. The offline-conversion handling mirrors
 * Oz Dealer Tools' FacebookAds::summarizeConversions.
 */

const CFG: MetaConfig = { token: 'test-token', appSecret: null };

/** Make global.fetch return one Insights page (no further paging). */
function mockGraph(rows: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: rows, paging: {} }),
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('getAccountMetrics', () => {
  it('parses metrics and classifies online + offline conversions', async () => {
    mockGraph([
      {
        impressions: '10000',
        clicks: '250',
        ctr: '2.5',
        cpc: '1.2',
        spend: '300.50',
        cpm: '8.0',
        actions: [
          { action_type: 'lead', value: '10' },
          { action_type: 'purchase', value: '3' },
          { action_type: 'offline_conversion.purchase', value: '2' },
          { action_type: 'offline_conversion.lead', value: '5' },
          { action_type: 'landing_page_view', value: '40' }, // ignored
        ],
        cost_per_action_type: [
          { action_type: 'lead', value: '4.25' },
          { action_type: 'purchase', value: '99.0' },
        ],
        action_values: [
          { action_type: 'offline_conversion.purchase', value: '54995.00' },
          { action_type: 'offline_conversion.lead', value: '123.00' }, // not revenue
        ],
      },
    ]);

    const m = await getAccountMetrics(CFG, 'act_1', '2026-06-01', '2026-06-30');

    expect(m.impressions).toBe(10000);
    expect(m.clicks).toBe(250);
    expect(m.ctr).toBe(2.5);
    expect(m.cpc).toBe(1.2);
    expect(m.spend).toBe(300.5);
    expect(m.cpm).toBe(8);
    // 10 + 3 + 2 (offline purchase) + 5 (offline lead) = 20
    expect(m.conversions).toBe(20);
    expect(m.offline_leads).toBe(5);
    expect(m.offline_purchases).toBe(2);
    expect(m.offline_purchase_value).toBe(54995); // lead "value" excluded
    // First primary cost_per_action_type wins (lead before purchase).
    expect(m.cost_per_conversion).toBe(4.25);
  });

  it('returns zeroed metrics when the account has no insights rows', async () => {
    mockGraph([]);
    const m = await getAccountMetrics(CFG, 'act_1', '2026-06-01', '2026-06-30');
    expect(m).toMatchObject({
      impressions: 0,
      clicks: 0,
      spend: 0,
      conversions: 0,
      offline_purchase_value: 0,
      cost_per_conversion: 0,
    });
  });

  it('margin markup composes onto the parsed metrics', async () => {
    mockGraph([{ impressions: '100', clicks: '5', spend: '100', cpc: '2.5', cpm: '12' }]);
    const raw = await getAccountMetrics(CFG, 'act_1', '2026-06-01', '2026-06-30');
    const billed = applyMetaMargins(raw, 23);
    expect(billed.spend).toBe(129.87012987012986);
    expect(billed.cpc).toBe(3.2467532467532467);
    expect(billed.actual_spend).toBe(100);
    expect(billed.impressions).toBe(100); // untouched
  });
});

describe('getCampaignPerformance', () => {
  it('maps rows with a name fallback', async () => {
    mockGraph([
      { campaign_id: '1', campaign_name: 'Summer Sale', impressions: '500', clicks: '20', ctr: '4', cpc: '1.5', spend: '30' },
      { campaign_id: '2', impressions: '0', clicks: '0' }, // missing name → "Unknown"
    ]);
    const rows = await getCampaignPerformance(CFG, 'act_1', '2026-06-01', '2026-06-30');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: '1', name: 'Summer Sale', impressions: 500, spend: 30 });
    expect(rows[1].name).toBe('Unknown');
  });
});

describe('getDailyPerformance', () => {
  it('parses daily rows and builds a "Mon DD" label from date_start', async () => {
    mockGraph([
      { date_start: '2026-06-15', impressions: '120', clicks: '6', spend: '12.34', actions: [{ action_type: 'lead', value: '2' }] },
    ]);
    const rows = await getDailyPerformance(CFG, 'act_1', '2026-06-01', '2026-06-30');
    expect(rows[0]).toMatchObject({
      date: '2026-06-15',
      label: 'Jun 15',
      impressions: 120,
      clicks: 6,
      spend: 12.34,
      conversions: 2,
    });
  });
});

describe('getDevicePerformance', () => {
  it('title-cases the device platform', async () => {
    mockGraph([
      { device_platform: 'mobile_app', impressions: '900', clicks: '40', ctr: '4.4', spend: '50' },
      { device_platform: 'desktop', impressions: '300', clicks: '10', ctr: '3.3', spend: '20' },
    ]);
    const rows = await getDevicePerformance(CFG, 'act_1', '2026-06-01', '2026-06-30');
    expect(rows.map((r) => r.device)).toEqual(['Mobile_app', 'Desktop']);
    expect(rows[0].spend).toBe(50);
  });
});
