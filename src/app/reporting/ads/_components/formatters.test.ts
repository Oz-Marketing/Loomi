/**
 * These formatters are typed `(v: number)` and that type is not enforced at
 * runtime — every report hand-writes an interface for its route's JSON and
 * passes it to SWR as a generic, so route/component drift is invisible to tsc.
 *
 * A live example: the team-lens campaign table rendered `usd(c.cpm)` while the
 * Graph query never requested `cpm`. `undefined.toLocaleString()` threw and
 * took down the whole Meta report for every agency user. These tests pin the
 * backstop so a missing metric degrades to one em-dash cell.
 */
import { describe, it, expect } from 'vitest';
import { usd, usd0, num, compact, pctText } from './shared';

// The values that actually arrive when a payload is missing a field.
const ABSENT = [undefined, null, NaN, Infinity, -Infinity] as unknown as number[];

describe.each([
  ['usd', usd],
  ['usd0', usd0],
  ['num', num],
  ['compact', compact],
  ['pctText', pctText],
])('%s', (_name, fn) => {
  it.each(ABSENT)('renders an em dash for %s instead of throwing', (v) => {
    expect(() => fn(v)).not.toThrow();
    expect(fn(v)).toBe('—');
  });

  it('still formats zero, which is a real measurement', () => {
    // The bug this guards against would be re-introduced by a truthiness
    // check: `if (!v) return '—'` would hide a genuine $0.00 spend.
    expect(fn(0)).not.toBe('—');
  });
});

describe('formatting is unchanged for real values', () => {
  it('usd / usd0', () => {
    expect(usd(1234.567)).toBe('$1,234.57');
    expect(usd0(1234.567)).toBe('$1,235');
  });

  it('num rounds and groups', () => {
    expect(num(2860354.4)).toBe('2,860,354');
  });

  it('compact keeps the millions branch', () => {
    // Regression: this used to render 2,860,354 as "2860k".
    expect(compact(2_860_354)).toBe('2.9M');
    // One decimal below 10M, none above — 12,400,000 reads "12M", not "12.4M".
    expect(compact(12_400_000)).toBe('12M');
    expect(compact(84_000)).toBe('84k');
    expect(compact(842)).toBe('842');
  });

  it('pctText', () => {
    expect(pctText(4.2615)).toBe('4.26%');
  });

  it('negatives survive (a delta can be negative)', () => {
    expect(usd(-50)).toBe('-$50.00');
    expect(compact(-2_500)).toBe('-2.5k');
  });
});
