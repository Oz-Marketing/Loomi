import { describe, it, expect, beforeAll } from 'vitest';
import { parseMetrics, normalizeLocationId } from './gbp';
import { signState, verifyState } from './gbp-state';

// The state tests are the security-relevant ones: ODT trusted `state` verbatim,
// which let a crafted callback link bind a Google grant to any org.
beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_SECRET ??= 'test-secret-for-state-signing';
});

/** Shape Google actually returns: metrics nested under dailyMetricTimeSeries. */
const nested = (metric: string, values: [string, number][]) => ({
  dailyMetricTimeSeries: [
    {
      dailyMetric: metric,
      timeSeries: {
        datedValues: values.map(([d, v]) => {
          const [year, month, day] = d.split('-').map(Number);
          return { date: { year, month, day }, value: v };
        }),
      },
    },
  ],
});

/** The other shape: series at the top level, no wrapper. */
const flat = (metric: string, values: [string, number][]) => ({
  dailyMetric: metric,
  timeSeries: {
    datedValues: values.map(([d, v]) => {
      const [year, month, day] = d.split('-').map(Number);
      return { date: { year, month, day }, value: v };
    }),
  },
});

describe('parseMetrics', () => {
  it('totals impressions across all four surface/device combinations', () => {
    const { summary } = parseMetrics({
      multiDailyMetricTimeSeries: [
        nested('BUSINESS_IMPRESSIONS_DESKTOP_MAPS', [['2026-08-01', 10]]),
        nested('BUSINESS_IMPRESSIONS_MOBILE_MAPS', [['2026-08-01', 20]]),
        nested('BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', [['2026-08-01', 30]]),
        nested('BUSINESS_IMPRESSIONS_MOBILE_SEARCH', [['2026-08-01', 40]]),
      ],
    });
    expect(summary.totalImpressions).toBe(100);
    expect(summary.mapImpressions).toBe(30);
    expect(summary.searchImpressions).toBe(70);
    expect(summary.desktopImpressions).toBe(40);
    expect(summary.mobileImpressions).toBe(60);
    // The two splits describe the same total from different angles.
    expect(summary.mapImpressions + summary.searchImpressions).toBe(summary.totalImpressions);
    expect(summary.desktopImpressions + summary.mobileImpressions).toBe(summary.totalImpressions);
  });

  it('reads the un-wrapped response shape too', () => {
    // Both shapes appear in the wild; handling only one silently returns zeros.
    const { summary } = parseMetrics({
      multiDailyMetricTimeSeries: [flat('WEBSITE_CLICKS', [['2026-08-01', 15]])],
    });
    expect(summary.websiteClicks).toBe(15);
  });

  it('sums the actions a customer can take into one total', () => {
    const { summary } = parseMetrics({
      multiDailyMetricTimeSeries: [
        nested('WEBSITE_CLICKS', [['2026-08-01', 5]]),
        nested('CALL_CLICKS', [['2026-08-01', 3]]),
        nested('BUSINESS_DIRECTION_REQUESTS', [['2026-08-01', 7]]),
        nested('BUSINESS_BOOKINGS', [['2026-08-01', 1]]),
        nested('BUSINESS_CONVERSATIONS', [['2026-08-01', 2]]),
        nested('BUSINESS_FOOD_ORDERS', [['2026-08-01', 4]]),
      ],
    });
    expect(summary.totalActions).toBe(22);
    // Actions are not impressions and must not leak into that total.
    expect(summary.totalImpressions).toBe(0);
  });

  it('builds a chronological daily series and merges metrics per day', () => {
    const { daily } = parseMetrics({
      multiDailyMetricTimeSeries: [
        nested('BUSINESS_IMPRESSIONS_MOBILE_SEARCH', [
          ['2026-08-03', 3],
          ['2026-08-01', 1],
        ]),
        nested('CALL_CLICKS', [['2026-08-01', 9]]),
      ],
    });
    expect(daily.map((d) => d.date)).toEqual(['2026-08-01', '2026-08-03']);
    expect(daily[0].impressions).toBe(1);
    expect(daily[0].callClicks).toBe(9);
    // A day the metric didn't report is zero, not undefined — Google omits
    // empty days rather than sending them.
    expect(daily[1].callClicks).toBe(0);
  });

  it('zero-pads dates so they sort and compare as ISO strings', () => {
    const { daily } = parseMetrics({
      multiDailyMetricTimeSeries: [nested('CALL_CLICKS', [['2026-1-5', 1]])],
    });
    expect(daily[0].date).toBe('2026-01-05');
  });

  it('skips a datedValue with no usable date rather than emitting 0000-00-00', () => {
    const { daily, summary } = parseMetrics({
      multiDailyMetricTimeSeries: [
        { dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [{ value: 5 }] } },
      ],
    });
    expect(daily).toEqual([]);
    expect(summary.callClicks).toBe(0);
  });

  it('coerces the string counts Google sends for large values', () => {
    const { summary } = parseMetrics({
      multiDailyMetricTimeSeries: [
        {
          dailyMetric: 'WEBSITE_CLICKS',
          timeSeries: { datedValues: [{ date: { year: 2026, month: 8, day: 1 }, value: '4200' }] },
        },
      ],
    });
    expect(summary.websiteClicks).toBe(4200);
  });

  it('returns a zeroed report for an empty or malformed response', () => {
    for (const input of [{}, null, undefined, { multiDailyMetricTimeSeries: [] }]) {
      const { summary, daily } = parseMetrics(input);
      expect(summary.totalImpressions).toBe(0);
      expect(summary.totalActions).toBe(0);
      expect(daily).toEqual([]);
    }
  });
});

describe('normalizeLocationId', () => {
  it('accepts the three forms the APIs hand back', () => {
    expect(normalizeLocationId('locations/123')).toBe('locations/123');
    expect(normalizeLocationId('123')).toBe('locations/123');
    expect(normalizeLocationId('accounts/99/locations/123')).toBe('locations/123');
  });

  it('tolerates surrounding whitespace from a pasted id', () => {
    expect(normalizeLocationId('  locations/123  ')).toBe('locations/123');
  });
});

describe('OAuth state', () => {
  it('round-trips the account and user that started the flow', () => {
    const state = signState('youngHonda', 'user_1');
    expect(verifyState(state)).toMatchObject({ accountKey: 'youngHonda', userId: 'user_1' });
  });

  it('rejects a forged state — the CSRF ODT is open to', () => {
    // ODT would accept this: it reads `state` as the org id and writes the
    // token there. A signed state makes an unissued value unusable.
    const forged = Buffer.from(
      JSON.stringify({
        accountKey: 'victimAccount',
        userId: 'user_1',
        nonce: 'x',
        expiresAt: Date.now() + 60_000,
      }),
      'utf8',
    ).toString('base64url');
    expect(verifyState(forged)).toBeNull();
    expect(verifyState(`${forged}.not-a-real-signature`)).toBeNull();
  });

  it('rejects a state whose payload was swapped under a valid signature', () => {
    const state = signState('youngHonda', 'user_1');
    const [, signature] = state.split('.');
    const swapped = Buffer.from(
      JSON.stringify({
        accountKey: 'victimAccount',
        userId: 'user_1',
        nonce: 'x',
        expiresAt: Date.now() + 60_000,
      }),
      'utf8',
    ).toString('base64url');
    expect(verifyState(`${swapped}.${signature}`)).toBeNull();
  });

  it('expires', () => {
    const now = Date.now();
    const state = signState('youngHonda', 'user_1', now);
    expect(verifyState(state, now + 9 * 60_000)).not.toBeNull();
    expect(verifyState(state, now + 11 * 60_000)).toBeNull();
  });

  it('rejects malformed input without throwing', () => {
    for (const bad of [null, undefined, '', 'nodot', '.', 'a.b.c', 'a.']) {
      expect(verifyState(bad)).toBeNull();
    }
  });

  it('issues a distinct nonce each time so two flows never collide', () => {
    const a = verifyState(signState('youngHonda', 'user_1'))!;
    const b = verifyState(signState('youngHonda', 'user_1'))!;
    expect(a.nonce).not.toBe(b.nonce);
  });
});
