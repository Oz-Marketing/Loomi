// §9 — pure alert-rule evaluation. No DB, no Meta, no React: given a parsed rule
// spec and a single metric sample, decide whether the rule fires. This is the
// one place fire/skip/not-evaluable logic lives, so it can be unit-tested
// exhaustively and reused unchanged for every channel (Meta now, Google later).
//
// The metric *value* and *volume* are computed elsewhere (the channel-specific
// metric sources in the engine) — this module never knows what the number means,
// only how to compare it. That separation is what lets one engine serve ~30
// alert types as config rows instead of code paths.

export type BaselineType =
  | 'FIXED'
  | 'ROLLING_AVG_DEVIATION'
  | 'PERIOD_OVER_PERIOD'
  | 'CONSECUTIVE_DURATION';

export type AlertTier = 'URGENT' | 'FYI';

// gt/gte/lt/lte/eq compare `value` to a single threshold; outside/inside compare
// it to a [low, high] band. `outside` is the workhorse for two-sided pacing
// bands ("outside 85–110% of expected").
export type Comparator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'outside' | 'inside';

export interface FireCondition {
  comparator: Comparator;
  value?: number; // gt | gte | lt | lte | eq
  low?: number; // outside | inside
  high?: number; // outside | inside
}

export interface RuleSpec {
  baselineType: BaselineType;
  fireCondition: FireCondition;
  /** Skip the sample when its data volume is below this — never fire on thin data. */
  minVolumeGate?: number | null;
}

export interface MetricSample {
  /** The current metric value to threshold (e.g. pace 72(%), burn 92(%)). */
  value: number;
  /** Data volume backing the sample, for the volume gate (e.g. $ target, $ budget). */
  volume?: number | null;
}

export type RuleEvaluation =
  // Condition met → fire. `direction` says which side of the threshold tripped,
  // so the engine can word "over" vs "under" without re-deriving it.
  | { status: 'fired'; value: number; direction: 'high' | 'low' | 'eq' }
  // Evaluated, condition not met.
  | { status: 'ok'; value: number }
  // Below the volume gate — intentionally not evaluated.
  | { status: 'skipped'; reason: string }
  // This baseline type can't be evaluated from a single current sample (it needs
  // a metric time-series we don't have for this channel yet), or the rule is
  // misconfigured. Never fires — surfaced so the caller can log, not silently no-op.
  | { status: 'not_evaluable'; reason: string };

const FINITE = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Evaluate a FIXED-threshold condition. Returns whether it fired and, if so,
 * which bound tripped. Malformed conditions return null (caller treats as
 * not_evaluable — a bad config must never fire a false alert).
 */
export function evaluateFixedCondition(
  value: number,
  cond: FireCondition,
): { fired: boolean; direction: 'high' | 'low' | 'eq' } | null {
  if (!FINITE(value)) return null;
  switch (cond.comparator) {
    case 'gt':
      return FINITE(cond.value) ? { fired: value > cond.value, direction: 'high' } : null;
    case 'gte':
      return FINITE(cond.value) ? { fired: value >= cond.value, direction: 'high' } : null;
    case 'lt':
      return FINITE(cond.value) ? { fired: value < cond.value, direction: 'low' } : null;
    case 'lte':
      return FINITE(cond.value) ? { fired: value <= cond.value, direction: 'low' } : null;
    case 'eq':
      return FINITE(cond.value) ? { fired: value === cond.value, direction: 'eq' } : null;
    case 'outside': {
      if (!FINITE(cond.low) || !FINITE(cond.high)) return null;
      if (value > cond.high) return { fired: true, direction: 'high' };
      if (value < cond.low) return { fired: true, direction: 'low' };
      return { fired: false, direction: 'high' };
    }
    case 'inside': {
      if (!FINITE(cond.low) || !FINITE(cond.high)) return null;
      const within = value >= cond.low && value <= cond.high;
      return { fired: within, direction: value < cond.low ? 'low' : 'high' };
    }
    default:
      return null;
  }
}

const NOT_YET: Record<Exclude<BaselineType, 'FIXED'>, string> = {
  ROLLING_AVG_DEVIATION:
    'ROLLING_AVG_DEVIATION needs a rolling metric history (e.g. 30-day average) — available once the Google Ads API supplies daily metric time-series (§8).',
  PERIOD_OVER_PERIOD:
    'PERIOD_OVER_PERIOD needs a prior-period metric to compare against — available once the Google Ads API supplies daily metric time-series (§8).',
  CONSECUTIVE_DURATION:
    'CONSECUTIVE_DURATION needs a per-day metric history to count consecutive days — available once the Google Ads API supplies daily metric time-series (§8).',
};

/**
 * The single decision point: does this rule fire for this sample?
 * Order: volume gate → baseline dispatch → fire condition. Only FIXED is
 * evaluable from a current snapshot; the other three are scaffolded and report
 * exactly why they can't run yet (so the engine logs it rather than silently
 * treating "no history" as "all clear").
 */
export function evaluateRule(spec: RuleSpec, sample: MetricSample): RuleEvaluation {
  if (!FINITE(sample.value)) {
    return { status: 'not_evaluable', reason: 'metric value is missing or non-finite' };
  }
  if (FINITE(spec.minVolumeGate) && spec.minVolumeGate! > 0) {
    const vol = FINITE(sample.volume) ? sample.volume! : 0;
    if (vol < spec.minVolumeGate!) {
      return {
        status: 'skipped',
        reason: `below volume gate (${vol} < ${spec.minVolumeGate})`,
      };
    }
  }
  if (spec.baselineType !== 'FIXED') {
    return { status: 'not_evaluable', reason: NOT_YET[spec.baselineType] };
  }
  const res = evaluateFixedCondition(sample.value, spec.fireCondition);
  if (res == null) {
    return { status: 'not_evaluable', reason: 'malformed FIXED fire condition' };
  }
  return res.fired
    ? { status: 'fired', value: sample.value, direction: res.direction }
    : { status: 'ok', value: sample.value };
}

/** Safe JSON parse for a fire condition stored as a DB string. Null on garbage. */
export function parseFireCondition(json: string | null | undefined): FireCondition | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || typeof o.comparator !== 'string') return null;
    return o as unknown as FireCondition;
  } catch {
    return null;
  }
}

/** Safe JSON parse for baselineParams (arbitrary per-baseline config). */
export function parseBaselineParams(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const o = JSON.parse(json);
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Tier → notification severity. URGENT = critical (act today); FYI = warning. */
export function tierToSeverity(tier: string): 'info' | 'warning' | 'critical' {
  return tier === 'URGENT' ? 'critical' : 'warning';
}
