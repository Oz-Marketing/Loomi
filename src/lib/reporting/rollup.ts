/**
 * Organization report roll-up — pure aggregation over per-rooftop report
 * metrics. Reporting routes are single-account (`?accountKey=`); an org view
 * fans out across the org's child rooftops and combines the results here.
 *
 * The golden rule: additive metrics (spend, impressions, clicks, sends, opens)
 * SUM across rooftops; rate metrics (CTR, CPC, CPM, open rate) are RECOMPUTED
 * from the summed numerator/denominator — never averaged, which would weight a
 * $5 rooftop the same as a $50,000 one.
 */

/** A metric shown in a roll-up: summed, or a rate derived from summed bases. */
export type RollupMetric =
  | {
      key: string;
      label: string;
      kind: 'sum';
      /** Base field summed from each rooftop's metrics object. */
      field: string;
      format: (v: number) => string;
      /** Lower is better (e.g. cost) — drives delta tone where used. */
      lowerIsBetter?: boolean;
    }
  | {
      key: string;
      label: string;
      kind: 'rate';
      /** Recomputed from summed numerator / denominator base fields. */
      numerator: string;
      denominator: string;
      /** Multiply the ratio (e.g. 100 for %, 1000 for CPM). Default 1. */
      scale?: number;
      format: (v: number) => string;
      lowerIsBetter?: boolean;
    };

export type RooftopStatus = 'ok' | 'not_configured' | 'error';

export interface RooftopRow {
  accountKey: string;
  dealer: string;
  /** Flat base metrics for this rooftop, or null when unavailable. */
  metrics: Record<string, number> | null;
  status: RooftopStatus;
  /** Human-readable reason when status !== 'ok'. */
  message?: string;
}

/** Sum a base field across rooftops that returned metrics. */
export function sumField(rows: RooftopRow[], field: string): number {
  return rows.reduce((acc, r) => acc + (r.metrics?.[field] ?? 0), 0);
}

/** Aggregate one metric across rooftops (sum, or rate from summed bases). */
export function aggregateMetric(rows: RooftopRow[], metric: RollupMetric): number {
  if (metric.kind === 'sum') return sumField(rows, metric.field);
  const numerator = sumField(rows, metric.numerator);
  const denominator = sumField(rows, metric.denominator);
  if (denominator === 0) return 0;
  return (numerator / denominator) * (metric.scale ?? 1);
}

/** A single rooftop's value for a metric, from its own metrics object. */
export function rooftopMetricValue(
  metrics: Record<string, number> | null,
  metric: RollupMetric,
): number {
  if (!metrics) return 0;
  if (metric.kind === 'sum') return metrics[metric.field] ?? 0;
  const numerator = metrics[metric.numerator] ?? 0;
  const denominator = metrics[metric.denominator] ?? 0;
  if (denominator === 0) return 0;
  return (numerator / denominator) * (metric.scale ?? 1);
}

/** Aggregate every metric into a `{ key: value }` map (the org totals row). */
export function aggregateAll(
  rows: RooftopRow[],
  metrics: RollupMetric[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of metrics) out[m.key] = aggregateMetric(rows, m);
  return out;
}

/** True when at least one rooftop reported non-zero activity for any sum metric. */
export function hasAnyActivity(rows: RooftopRow[], metrics: RollupMetric[]): boolean {
  const sums = metrics.filter((m): m is Extract<RollupMetric, { kind: 'sum' }> => m.kind === 'sum');
  return sums.some((m) => sumField(rows, m.field) > 0);
}
