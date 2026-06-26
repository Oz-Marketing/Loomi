import { describe, it, expect } from 'vitest';
import {
  evaluateFixedCondition,
  evaluateRule,
  parseFireCondition,
  parseBaselineParams,
  tierToSeverity,
  type RuleSpec,
} from './rules';

describe('evaluateFixedCondition', () => {
  it('gt / gte / lt / lte / eq fire on the right side', () => {
    expect(evaluateFixedCondition(91, { comparator: 'gt', value: 90 })?.fired).toBe(true);
    expect(evaluateFixedCondition(90, { comparator: 'gt', value: 90 })?.fired).toBe(false);
    expect(evaluateFixedCondition(90, { comparator: 'gte', value: 90 })?.fired).toBe(true);
    expect(evaluateFixedCondition(5, { comparator: 'lt', value: 6 })?.fired).toBe(true);
    expect(evaluateFixedCondition(6, { comparator: 'lte', value: 6 })?.fired).toBe(true);
    expect(evaluateFixedCondition(6, { comparator: 'eq', value: 6 })?.fired).toBe(true);
  });

  it('outside fires above high (direction high) and below low (direction low)', () => {
    const cond = { comparator: 'outside' as const, low: 85, high: 110 };
    expect(evaluateFixedCondition(115, cond)).toEqual({ fired: true, direction: 'high' });
    expect(evaluateFixedCondition(72, cond)).toEqual({ fired: true, direction: 'low' });
    expect(evaluateFixedCondition(100, cond)?.fired).toBe(false);
    // boundaries are inclusive of the band (not outside)
    expect(evaluateFixedCondition(85, cond)?.fired).toBe(false);
    expect(evaluateFixedCondition(110, cond)?.fired).toBe(false);
  });

  it('inside fires within the band', () => {
    const cond = { comparator: 'inside' as const, low: 0, high: 10 };
    expect(evaluateFixedCondition(5, cond)?.fired).toBe(true);
    expect(evaluateFixedCondition(11, cond)?.fired).toBe(false);
  });

  it('returns null on a malformed condition (missing threshold) — never fires', () => {
    expect(evaluateFixedCondition(50, { comparator: 'gt' })).toBeNull();
    expect(evaluateFixedCondition(50, { comparator: 'outside', low: 85 })).toBeNull();
    expect(evaluateFixedCondition(NaN, { comparator: 'gt', value: 1 })).toBeNull();
  });
});

describe('evaluateRule', () => {
  const paceRule: RuleSpec = {
    baselineType: 'FIXED',
    fireCondition: { comparator: 'outside', low: 85, high: 110 },
    minVolumeGate: 50,
  };

  it('fires when account pace is outside the band (under)', () => {
    const r = evaluateRule(paceRule, { value: 72, volume: 500 });
    expect(r).toEqual({ status: 'fired', value: 72, direction: 'low' });
  });

  it('fires over the band', () => {
    const r = evaluateRule(paceRule, { value: 130, volume: 500 });
    expect(r).toEqual({ status: 'fired', value: 130, direction: 'high' });
  });

  it('is ok within the band', () => {
    expect(evaluateRule(paceRule, { value: 100, volume: 500 }).status).toBe('ok');
  });

  it('skips below the volume gate (thin data never fires)', () => {
    const r = evaluateRule(paceRule, { value: 30, volume: 10 });
    expect(r.status).toBe('skipped');
  });

  it('treats a missing volume as 0 against a gate (skipped)', () => {
    expect(evaluateRule(paceRule, { value: 30 }).status).toBe('skipped');
  });

  it('no gate → always evaluated regardless of volume', () => {
    const noGate: RuleSpec = { ...paceRule, minVolumeGate: null };
    expect(evaluateRule(noGate, { value: 72 }).status).toBe('fired');
  });

  it('the budget-burn shape: gte 90 fires at/above 90', () => {
    const burn: RuleSpec = {
      baselineType: 'FIXED',
      fireCondition: { comparator: 'gte', value: 90 },
      minVolumeGate: null,
    };
    expect(evaluateRule(burn, { value: 92 }).status).toBe('fired');
    expect(evaluateRule(burn, { value: 88 }).status).toBe('ok');
  });

  it('non-FIXED baseline types are not evaluable yet, with a clear reason', () => {
    for (const bt of ['ROLLING_AVG_DEVIATION', 'PERIOD_OVER_PERIOD', 'CONSECUTIVE_DURATION'] as const) {
      const r = evaluateRule({ ...paceRule, baselineType: bt }, { value: 1, volume: 999 });
      expect(r.status).toBe('not_evaluable');
      if (r.status === 'not_evaluable') expect(r.reason).toMatch(/§8|history/);
    }
  });

  it('malformed FIXED condition is not evaluable (never fires)', () => {
    const bad: RuleSpec = { baselineType: 'FIXED', fireCondition: { comparator: 'gt' } };
    expect(evaluateRule(bad, { value: 100, volume: 999 }).status).toBe('not_evaluable');
  });

  it('non-finite metric value is not evaluable', () => {
    expect(evaluateRule(paceRule, { value: NaN, volume: 999 }).status).toBe('not_evaluable');
  });
});

describe('parsing helpers', () => {
  it('parseFireCondition reads valid JSON and rejects garbage', () => {
    expect(parseFireCondition('{"comparator":"gte","value":90}')).toEqual({
      comparator: 'gte',
      value: 90,
    });
    expect(parseFireCondition('not json')).toBeNull();
    expect(parseFireCondition('{"value":90}')).toBeNull(); // no comparator
    expect(parseFireCondition(null)).toBeNull();
  });

  it('parseBaselineParams returns an object or {} on garbage', () => {
    expect(parseBaselineParams('{"minDaysLeft":5}')).toEqual({ minDaysLeft: 5 });
    expect(parseBaselineParams('garbage')).toEqual({});
    expect(parseBaselineParams(undefined)).toEqual({});
  });

  it('tierToSeverity maps URGENT→critical, else warning', () => {
    expect(tierToSeverity('URGENT')).toBe('critical');
    expect(tierToSeverity('FYI')).toBe('warning');
  });
});
