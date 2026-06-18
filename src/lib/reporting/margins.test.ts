import { describe, it, expect } from 'vitest';
import {
  applyMargins,
  applyMetaMargins,
  applyGoogleMargins,
  applyStackAdaptMargins,
  META_MARGIN_FIELDS,
  STACKADAPT_MARGIN_FIELDS,
  GOOGLE_MARGIN_FIELDS,
} from './margins';

/**
 * Numbers below are the exact output of Oz Dealer Tools' PHP `applyMargins()`
 * for the same inputs (captured by running the original formula). These are
 * parity assertions — they must not be "recomputed" from the TS code.
 */
describe('applyMargins (Oz parity)', () => {
  it('grosses up Meta cost fields by a 23% margin and preserves actuals', () => {
    const out = applyMetaMargins(
      { spend: 100, cpc: 2.5, cpm: 12, cost_per_conversion: 40, impressions: 5000 },
      23,
    );
    expect(out.spend).toBe(129.87012987012986);
    expect(out.cpc).toBe(3.2467532467532467);
    expect(out.cpm).toBe(15.584415584415584);
    expect(out.cost_per_conversion).toBe(51.94805194805195);
    expect(out.actual_spend).toBe(100);
    expect(out.actual_cpc).toBe(2.5);
    expect(out.actual_cpm).toBe(12);
    expect(out.actual_cost_per_conversion).toBe(40);
    // Non-cost fields pass through untouched.
    expect(out.impressions).toBe(5000);
  });

  it('returns data untouched when margin <= 0 (no actual_* keys added)', () => {
    const input = { spend: 100, cpc: 2.5 };
    expect(applyMetaMargins(input, 0)).toEqual({ spend: 100, cpc: 2.5 });
    expect(applyMetaMargins(input, -5)).toEqual({ spend: 100, cpc: 2.5 });
    expect(applyMetaMargins(input, 0)).not.toHaveProperty('actual_spend');
  });

  it('returns data untouched for an out-of-range margin (>= 100), never Infinity/negative', () => {
    const input = { spend: 100, cpc: 2.5 };
    // margin == 100 would divide by zero (→ Infinity → JSON null); margin > 100
    // would flip the sign. Both are config errors → fall back to face value.
    expect(applyMetaMargins(input, 100)).toEqual({ spend: 100, cpc: 2.5 });
    expect(applyMetaMargins(input, 150)).toEqual({ spend: 100, cpc: 2.5 });
    expect(applyMetaMargins(input, 100)).not.toHaveProperty('actual_spend');
  });

  it('skips fields that are missing or not > 0', () => {
    const out = applyMetaMargins({ spend: 0, cpc: 2.5 }, 23);
    // spend == 0 is left alone (no markup, no actual_spend).
    expect(out.spend).toBe(0);
    expect(out).not.toHaveProperty('actual_spend');
    // cpc is marked up.
    expect(out.cpc).toBe(3.2467532467532467);
    expect(out.actual_cpc).toBe(2.5);
  });

  it('does not mutate the input object', () => {
    const input = { spend: 100 };
    applyMetaMargins(input, 23);
    expect(input).toEqual({ spend: 100 });
  });

  it('Google marks up cost / avg_cpc, leaving Meta-only fields alone', () => {
    const out = applyGoogleMargins(
      { cost: 100, avg_cpc: 2.5, cost_per_conversion: 40, spend: 100 },
      23,
    );
    expect(out.cost).toBe(129.87012987012986);
    expect(out.avg_cpc).toBe(3.2467532467532467);
    expect(out.cost_per_conversion).toBe(51.94805194805195);
    // `spend` is not a Google margin field — untouched.
    expect(out.spend).toBe(100);
    expect(out).not.toHaveProperty('actual_spend');
  });

  it('StackAdapt marks up the same fields as Meta', () => {
    const out = applyStackAdaptMargins(
      { spend: 100, cpc: 2.5, cpm: 12, cost_per_conversion: 40 },
      23,
    );
    expect(out.spend).toBe(129.87012987012986);
    expect(out.cpc).toBe(3.2467532467532467);
    expect(out.cpm).toBe(15.584415584415584);
    expect(out.cost_per_conversion).toBe(51.94805194805195);
    expect(out.actual_spend).toBe(100);
  });

  it('exposes the documented per-platform field sets', () => {
    expect(META_MARGIN_FIELDS).toEqual(['spend', 'cpc', 'cpm', 'cost_per_conversion']);
    expect(STACKADAPT_MARGIN_FIELDS).toEqual(['spend', 'cpc', 'cpm', 'cost_per_conversion']);
    expect(GOOGLE_MARGIN_FIELDS).toEqual(['cost', 'avg_cpc', 'cost_per_conversion']);
  });

  it('applyMargins only touches the named fields', () => {
    const out = applyMargins({ a: 10, b: 20 }, 50, ['a']);
    expect(out.a).toBe(20); // 10 / (1 - 0.5)
    expect(out.actual_a).toBe(10);
    expect(out.b).toBe(20);
    expect(out).not.toHaveProperty('actual_b');
  });
});
