/**
 * Guards the chart palette's invariants.
 *
 * The hues themselves are validated out-of-band by the palette validator (see
 * chart-theme.ts's header for the exact commands). What a unit test can hold is
 * the thing a future edit is actually likely to break: someone needing a fifth
 * category and appending a fifth hex instead of folding into "Other". The
 * all-pairs check says four is the ceiling, so the count is load-bearing.
 */
import { describe, it, expect } from 'vitest';
import {
  SERIES_COLORS,
  OTHER_COLOR,
  MAX_SERIES,
  foldToPalette,
  baseChartOptions,
} from './chart-theme';

describe('SERIES_COLORS', () => {
  it('is exactly four hues — every fifth one tested collided at all-pairs', () => {
    expect(SERIES_COLORS).toHaveLength(4);
    expect(MAX_SERIES).toBe(4);
  });

  it('holds the validated hues in their validated order', () => {
    // Order matters: emerald and amber are the weakest pair under protanopia,
    // so indigo sits between them.
    expect([...SERIES_COLORS]).toEqual(['#059669', '#6366f1', '#d97706', '#ec4899']);
  });

  it('does not reuse a series hue for the "Other" bucket', () => {
    expect(SERIES_COLORS).not.toContain(OTHER_COLOR);
  });
});

describe('foldToPalette', () => {
  const item = (label: string, value: number) => ({ label, value });

  it('assigns hues by position and leaves short lists alone', () => {
    const out = foldToPalette([item('Search', 5), item('Display', 3)]);
    expect(out).toEqual([
      { label: 'Search', value: 5, color: SERIES_COLORS[0] },
      { label: 'Display', value: 3, color: SERIES_COLORS[1] },
    ]);
  });

  it('fills all four slots without folding', () => {
    const out = foldToPalette([item('a', 1), item('b', 1), item('c', 1), item('d', 1)]);
    expect(out).toHaveLength(4);
    expect(out.map((o) => o.color)).toEqual([...SERIES_COLORS]);
  });

  it('folds the tail into one gray bucket, summing its values', () => {
    const out = foldToPalette([
      item('a', 1),
      item('b', 2),
      item('c', 3),
      item('d', 4),
      item('e', 5),
      item('f', 6),
    ]);
    expect(out).toHaveLength(5);
    expect(out[4]).toEqual({ label: 'Other (2)', value: 11, color: OTHER_COLOR });
  });

  it('names a single folded item rather than calling one thing "Other (1)"', () => {
    const out = foldToPalette([
      item('a', 1),
      item('b', 1),
      item('c', 1),
      item('d', 1),
      item('Organic', 9),
    ]);
    expect(out[4]).toEqual({ label: 'Organic', value: 9, color: OTHER_COLOR });
  });

  it('preserves caller order — colour follows the entity, never its rank', () => {
    const ascending = [item('a', 1), item('b', 99)];
    expect(foldToPalette(ascending).map((o) => o.label)).toEqual(['a', 'b']);
  });

  it('handles an empty list', () => {
    expect(foldToPalette([])).toEqual([]);
  });
});

describe('baseChartOptions', () => {
  it('hides the legend for a lone series and shows it for two or more', () => {
    // Identity must never rest on colour alone, and the tightest surviving pair
    // in this palette sits in the band where that rule has teeth.
    expect(baseChartOptions({ isDark: true, seriesCount: 1 }).legend?.show).toBe(false);
    expect(baseChartOptions({ isDark: true, seriesCount: 2 }).legend?.show).toBe(true);
  });

  it('themes the tooltip to match the surface', () => {
    expect(baseChartOptions({ isDark: true }).tooltip?.theme).toBe('dark');
    expect(baseChartOptions({ isDark: false }).tooltip?.theme).toBe('light');
  });

  it('never enables data labels by default', () => {
    expect(baseChartOptions({ isDark: true }).dataLabels?.enabled).toBe(false);
  });
});
