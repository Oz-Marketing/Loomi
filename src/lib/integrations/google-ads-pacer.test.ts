import { describe, it, expect, vi, beforeEach } from 'vitest';

// gaql is the only thing that touches the network; everything else in the module
// (micros conversion, the pure mappers) runs for real.
vi.mock('./google-ads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./google-ads')>();
  return { ...actual, gaql: vi.fn() };
});

import { gaql } from './google-ads';
import {
  fetchCampaignPeriodMetrics,
  impressionShareValue,
  periodWindow,
} from './google-ads-pacer';
import type { GoogleAdsConfig } from './google-ads';

const cfg = {} as GoogleAdsConfig;
const mockRows = (rows: unknown[]) =>
  vi.mocked(gaql).mockResolvedValue(rows as Awaited<ReturnType<typeof gaql>>);

beforeEach(() => vi.mocked(gaql).mockReset());

/**
 * The month window every Google spend read uses. It ends at the DATA EDGE, the
 * same instant `resolveClock` counts days to. Ending it at today instead would
 * put a partial day in the numerator of (target − spent) ÷ remaining days but
 * not the denominator, so the recommended daily would slide down through the
 * afternoon with no new information behind the move.
 */
describe('periodWindow', () => {
  it('ends at yesterday in a live month, not today', () => {
    expect(periodWindow('2026-08', '2026-08-12')).toEqual({
      since: '2026-08-01',
      until: '2026-08-11',
      empty: false,
    });
  });

  it('ends at the month end once the month has closed', () => {
    // Viewed in September, August is fully settled — the edge is the 31st, and
    // it does not creep forward with the calendar.
    expect(periodWindow('2026-08', '2026-09-04')).toEqual({
      since: '2026-08-01',
      until: '2026-08-31',
      empty: false,
    });
    // Short month, viewed on the 1st of the next one.
    expect(periodWindow('2026-02', '2026-03-01').until).toBe('2026-02-28');
  });

  it('marks the 1st as empty — nothing has finalized yet', () => {
    // Yesterday is in July, so August has no settled day. Callers must skip the
    // read rather than send Google Aug 1 → Jul 31.
    const w = periodWindow('2026-08', '2026-08-01');
    expect(w.empty).toBe(true);
    expect(w.until < w.since).toBe(true);
  });

  it('marks a month that has not started as empty', () => {
    expect(periodWindow('2026-09', '2026-08-12').empty).toBe(true);
  });

  it('has exactly one finalized day on the 2nd', () => {
    expect(periodWindow('2026-08', '2026-08-02')).toEqual({
      since: '2026-08-01',
      until: '2026-08-01',
      empty: false,
    });
  });
});

/**
 * The §4 metric read. What matters here isn't arithmetic, it's the difference
 * between "zero" and "we don't know" — an impression share that reads 0 when it
 * is actually unavailable inverts the move decision (0% budget-lost says "don't
 * feed this campaign", which is the opposite of "we have no idea").
 */
describe('impressionShareValue', () => {
  it('passes fractions through and clamps to 0–1', () => {
    expect(impressionShareValue(0.42)).toBe(0.42);
    expect(impressionShareValue('0.9')).toBe(0.9); // Google's ">90%" sentinel
    expect(impressionShareValue(0)).toBe(0);
    expect(impressionShareValue(1.2)).toBe(1);
    expect(impressionShareValue(-0.1)).toBe(0);
  });

  it('returns null — never zero — when the field is absent or unusable', () => {
    // PMAX / Demand Gen / Display omit the field entirely, as does any account
    // under Google's reporting threshold.
    expect(impressionShareValue(undefined)).toBeNull();
    expect(impressionShareValue(null)).toBeNull();
    expect(impressionShareValue('')).toBeNull();
    expect(impressionShareValue('n/a')).toBeNull();
  });
});

describe('fetchCampaignPeriodMetrics', () => {
  it('reads spend and the tile inputs off one unsegmented row per campaign', async () => {
    mockRows([
      {
        campaign: { id: '111' },
        metrics: {
          costMicros: '539040000',
          impressions: '12400',
          clicks: '860',
          conversions: 14,
          conversionsFromInteractionsRate: 0.0163,
          searchBudgetLostImpressionShare: 0.31,
          searchRankLostImpressionShare: 0.12,
        },
      },
    ]);

    const out = await fetchCampaignPeriodMetrics(cfg, '123', '2026-08-01', '2026-08-12');

    expect(out.get('111')).toEqual({
      spend: 539.04,
      impressions: 12400,
      clicks: 860,
      conversions: 14,
      convRate: 0.0163,
      searchBudgetLostIs: 0.31,
      searchRankLostIs: 0.12,
    });
  });

  it('leaves impression share null for a campaign type that has none', async () => {
    // A PMAX row: real delivery, no search IS fields at all.
    mockRows([
      {
        campaign: { id: '222' },
        metrics: { costMicros: '210500000', impressions: '9000', clicks: '300', conversions: 2 },
      },
    ]);

    const pmax = (await fetchCampaignPeriodMetrics(cfg, '123', '2026-08-01', '2026-08-12')).get(
      '222',
    );

    expect(pmax?.spend).toBe(210.5);
    expect(pmax?.searchBudgetLostIs).toBeNull();
    expect(pmax?.searchRankLostIs).toBeNull();
    expect(pmax?.convRate).toBeNull();
  });

  it('sums counters but never sums a ratio, if Google ever returns split rows', async () => {
    // Unsegmented, Google returns one row per campaign — but summing an
    // impression share would be meaningless, so the accumulator must not do it
    // even when handed two rows.
    mockRows([
      {
        campaign: { id: '333' },
        metrics: {
          costMicros: '100000000',
          impressions: '1000',
          clicks: '50',
          conversions: 1,
          searchBudgetLostImpressionShare: 0.4,
        },
      },
      {
        campaign: { id: '333' },
        metrics: {
          costMicros: '50000000',
          impressions: '500',
          clicks: '25',
          conversions: 2,
          searchBudgetLostImpressionShare: 0.5,
        },
      },
    ]);

    const merged = (await fetchCampaignPeriodMetrics(cfg, '123', '2026-08-01', '2026-08-12')).get(
      '333',
    );

    expect(merged?.spend).toBe(150);
    expect(merged?.impressions).toBe(1500);
    expect(merged?.clicks).toBe(75);
    expect(merged?.conversions).toBe(3);
    expect(merged?.searchBudgetLostIs).toBe(0.5); // a value, not 0.9
  });

  it('skips rows with no campaign id', async () => {
    mockRows([{ metrics: { costMicros: '1000000' } }, { campaign: {}, metrics: {} }]);
    expect((await fetchCampaignPeriodMetrics(cfg, '123', '2026-08-01', '2026-08-12')).size).toBe(0);
  });

  it('queries the given window unsegmented, so impression share stays range-level', async () => {
    mockRows([]);
    await fetchCampaignPeriodMetrics(cfg, '123', '2026-08-01', '2026-08-12');

    const query = vi.mocked(gaql).mock.calls[0][2];
    expect(query).toContain("segments.date BETWEEN '2026-08-01' AND '2026-08-12'");
    expect(query).toContain('metrics.search_budget_lost_impression_share');
    expect(query).toContain('metrics.search_rank_lost_impression_share');
    // Segmenting by date would make the impression-share columns per-day and
    // therefore unusable — the whole point of this read is the range roll-up.
    expect(query).not.toContain('SELECT segments.date');
    expect(query).not.toMatch(/,\s*segments\.date/);
  });
});
