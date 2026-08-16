import { describe, it, expect } from 'vitest';
import { stripInternalCost } from './guard';

/**
 * `applyMargins()` grosses each cost field up by the agency margin and keeps the
 * raw platform value as `actual_<field>`. Both that and the `margin` percent
 * were being serialised to every viewer of the ad reports — including dealers,
 * who could recover what Oz pays with `actual_spend / spend`.
 *
 * These lock the shape of the fix, since nothing on screen would change if it
 * silently stopped working.
 */
describe('stripInternalCost', () => {
  const payload = {
    accountKey: 'youngHonda',
    margin: 20,
    accountMetrics: { spend: 1250, actual_spend: 1000, cpc: 2.5, actual_cpc: 2 },
    campaigns: [
      { name: 'Spring', spend: 625, actual_spend: 500 },
      { name: 'Summer', spend: 625, actual_spend: 500 },
    ],
    compare: {
      accountMetrics: { spend: 500, actual_spend: 400 },
      daily: [{ date: '2026-08-01', spend: 100, actual_spend: 80 }],
    },
  };

  it('removes actual_* at every depth', () => {
    const out = stripInternalCost(payload);
    const json = JSON.stringify(out);
    expect(json).not.toContain('actual_');
  });

  it('removes the margin percent itself', () => {
    const out = stripInternalCost(payload) as Record<string, unknown>;
    expect(out.margin).toBeUndefined();
  });

  it('leaves the billed figures untouched', () => {
    const out = stripInternalCost(payload);
    expect(out.accountMetrics.spend).toBe(1250);
    expect(out.accountMetrics.cpc).toBe(2.5);
    expect(out.campaigns).toHaveLength(2);
    expect(out.campaigns[0].name).toBe('Spring');
    expect(out.compare.daily[0].spend).toBe(100);
  });

  it('does not mutate the input', () => {
    const before = JSON.stringify(payload);
    stripInternalCost(payload);
    expect(JSON.stringify(payload)).toBe(before);
  });

  it('handles nulls and primitives without throwing', () => {
    expect(stripInternalCost(null)).toBeNull();
    expect(stripInternalCost(3)).toBe(3);
    expect(stripInternalCost([1, 'a', null])).toEqual([1, 'a', null]);
  });
});

describe('stripInternalCost — non-plain objects', () => {
  // Regression: the recursion rebuilt every object from Object.entries, which
  // is empty for a Date, so `syncedAt` would have serialised as `{}` and the
  // client would render "Invalid Date" — but only for callers without the
  // capability, which is the hardest case to notice.
  it('leaves Date values intact', () => {
    const when = new Date('2026-08-15T12:00:00.000Z');
    const out = stripInternalCost({ syncedAt: when, spend: 10, actual_spend: 8 });
    expect(out.syncedAt).toBeInstanceOf(Date);
    expect(out.syncedAt.toISOString()).toBe('2026-08-15T12:00:00.000Z');
    expect(JSON.stringify(out)).not.toContain('actual_');
  });

  it('leaves a Date nested inside an array intact', () => {
    const out = stripInternalCost({
      daily: [{ date: new Date('2026-08-01T00:00:00.000Z'), actual_spend: 5 }],
    });
    expect(out.daily[0].date).toBeInstanceOf(Date);
    expect(out.daily[0]).not.toHaveProperty('actual_spend');
  });
});
