/**
 * The field NAMES are the fragile part, not the arithmetic.
 *
 * `METRICS_FRAGMENT` is shared by all five delivery queries, so a single wrong
 * name 400s the entire StackAdapt report rather than blanking one section. The
 * names here were read off the live API by introspection; these tests exist so
 * that a later edit "from memory" fails in CI instead of in production.
 */
import { describe, it, expect } from 'vitest';
import {
  METRICS_FRAGMENT,
  normalizeStats,
  EMPTY_STACKADAPT_METRICS,
  type RawStats,
} from './stackadapt';

describe('METRICS_FRAGMENT', () => {
  // Verified against DeliveryStatsRecord on 2026-08-16 via
  // scripts/stackadapt-introspect.ts. Re-introspect before changing any of these.
  const VERIFIED = [
    'impressionsBigint',
    'clicksBigint',
    'cost',
    'conversionsBigint',
    'uniqueImpressionsBigint',
    'frequency',
    'videoStartsBigint',
    'videoQ1PlaybacksBigint',
    'videoQ2PlaybacksBigint',
    'videoQ3PlaybacksBigint',
    'videoCompletionsBigint',
    'videoCompletionRate',
  ];

  it.each(VERIFIED)('requests %s', (field) => {
    expect(METRICS_FRAGMENT).toMatch(new RegExp(`\\b${field}\\b`));
  });

  it('does not request videoQ4PlaybacksBigint, which does not exist', () => {
    // The natural guess for the 100% mark. The real field is
    // `videoCompletionsBigint`; asking for Q4 takes the whole report down.
    expect(METRICS_FRAGMENT).not.toMatch(/videoQ4/);
  });

  it('does not request `margins` — StackAdapt\'s own margin figure', () => {
    // guard.ts strips it defensively, but a client-facing route should never
    // be asking the vendor for the agency's margin in the first place.
    expect(METRICS_FRAGMENT).not.toMatch(/\bmargins\b/);
  });
});

describe('normalizeStats — video', () => {
  const VIDEO: RawStats = {
    impressionsBigint: 100_000,
    cost: 2_500,
    videoStartsBigint: 90_000,
    videoQ1PlaybacksBigint: 80_000,
    videoQ2PlaybacksBigint: 70_000,
    videoQ3PlaybacksBigint: 65_000,
    videoCompletionsBigint: 60_000,
    videoCompletionRate: 66.667,
  };

  it('maps the quartile funnel', () => {
    const m = normalizeStats(VIDEO);
    expect(m.video_starts).toBe(90_000);
    expect(m.video_q1).toBe(80_000);
    expect(m.video_q2).toBe(70_000);
    expect(m.video_q3).toBe(65_000);
    expect(m.video_completions).toBe(60_000);
  });

  it('takes the completion rate from the API rather than recomputing it', () => {
    // Recomputing 60000/90000 would give 66.67; StackAdapt says 66.667 → 66.67
    // after rounding. The point is that the source is the API, so a buyer
    // comparing against StackAdapt's own UI sees the same number.
    expect(normalizeStats(VIDEO).video_completion_rate).toBe(66.67);
  });

  it('reports zeros for a display-only buy', () => {
    // Not missing data — the campaign genuinely ran no video. The UI keys off
    // video_starts to hide the section rather than show 0%.
    const m = normalizeStats({ impressionsBigint: 5_000, cost: 100 });
    expect(m.video_starts).toBe(0);
    expect(m.video_completion_rate).toBe(0);
    expect(m.impressions).toBe(5_000);
  });

  it('EMPTY_STACKADAPT_METRICS carries every video key', () => {
    // An account with no delivery returns this object; a missing key here
    // becomes `undefined` in the UI and renders as "NaN%".
    for (const k of [
      'video_starts',
      'video_q1',
      'video_q2',
      'video_q3',
      'video_completions',
      'video_completion_rate',
    ] as const) {
      expect(EMPTY_STACKADAPT_METRICS[k]).toBe(0);
    }
  });
});
