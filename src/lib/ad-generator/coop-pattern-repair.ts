import { normalizePattern, patternProblem } from './coop-rules';

/**
 * Repairing co-op patterns already STORED with Python's inline `(?i)` flag.
 *
 * Drafting used to pass a model's `(?i)political|…` straight into a pack. JavaScript
 * can't compile it, so the rule never fired, and nothing said so. Drafting, merging,
 * accepting and evaluating now all deal with it (see `normalizePattern`); this is
 * for packs written before they did. `scripts/fix-coop-inline-flags.ts` is the DB
 * wrapper around it.
 *
 * NARROW ON PURPOSE:
 *
 *   • Plain `JSON.parse`, never `parseCoopPack`. That drops entries it can't use, and
 *     writing its result back would delete them from the pack.
 *   • Only the `pattern` key, only on a phrase rule, only where it begins `(?i)`. Every
 *     other key, every other rule and the pack's own fields go back as they were read.
 *   • A pattern still invalid once `(?i)` is gone is reported, not rewritten. It needs
 *     a person; guessing at a regex is how a wrong rule gets in.
 *   • An ENFORCED rule is held unless asked for. Accepted in review — or hand-written,
 *     which counts as accepted — its pattern has never compiled, so it has never
 *     fired. Repairing it switches enforcement ON at the severity it declares, for a
 *     regex the review queue never showed anyone (it shows the description and the
 *     quote). That is a decision, so it waits for one. A proposed or rejected rule
 *     evaluates as nothing either way, so repairing it changes no ad.
 *
 * Idempotent: a repaired pattern no longer begins `(?i)`, so a second pass finds
 * nothing. Pure: no DB.
 */

export type RepairAction =
  /** Rewritten. */
  | 'repair'
  /** Enforced, so left as it is unless `includeAccepted`. */
  | 'held'
  /** Still won't compile once `(?i)` is gone. Left for a person. */
  | 'still_invalid';

export interface PatternRepair {
  /** Position in the stored rules array. The rewrite goes by index, so a duplicated
   *  id can't send it to the wrong rule. */
  index: number;
  ruleId: string;
  kind: string;
  /** `proposed`, `accepted`, `rejected`, or `hand-written` for a rule with none. */
  reviewState: string;
  severity: string;
  from: string;
  to: string;
  action: RepairAction;
  /** Why `to` still won't compile, for `still_invalid`. */
  problem?: string;
}

export interface RepairPlan {
  /** Why the stored text can't be rewritten safely. When set, nothing else is. */
  unreadable?: string;
  repairs: PatternRepair[];
  /** The pack text to write back, or null when there is nothing to rewrite. */
  next: string | null;
}

const LEADING_INLINE_I = /^\s*\(\?i\)/;

export function planInlineFlagRepair(
  stored: string,
  opts: { includeAccepted?: boolean } = {},
): RepairPlan {
  let pack: unknown;
  try {
    pack = JSON.parse(stored);
  } catch {
    return { unreadable: 'the stored pack is not valid JSON', repairs: [], next: null };
  }
  const rules = (pack as { rules?: unknown } | null)?.rules;
  if (!pack || typeof pack !== 'object' || !Array.isArray(rules)) {
    return { unreadable: 'the stored pack has no rules array', repairs: [], next: null };
  }

  const repairs: PatternRepair[] = [];
  rules.forEach((entry: unknown, index) => {
    if (!entry || typeof entry !== 'object') return;
    const r = entry as Record<string, unknown>;
    if (r.kind !== 'required_phrase' && r.kind !== 'banned_phrase') return;
    if (typeof r.pattern !== 'string' || !LEADING_INLINE_I.test(r.pattern)) return;

    const to = normalizePattern(r.pattern);
    const problem = to ? patternProblem(to) : 'nothing is left once (?i) is removed';
    const state = typeof r.reviewState === 'string' ? r.reviewState : null;
    // As `splitByReviewState` reads it: absent counts as accepted.
    const enforced = (state ?? 'accepted') === 'accepted';
    repairs.push({
      index,
      ruleId: typeof r.id === 'string' ? r.id : '(no id)',
      kind: r.kind,
      reviewState: state ?? 'hand-written',
      severity: typeof r.severity === 'string' ? r.severity : '(none)',
      from: r.pattern,
      to,
      action: problem ? 'still_invalid' : enforced && !opts.includeAccepted ? 'held' : 'repair',
      ...(problem ? { problem } : {}),
    });
  });

  const rewrite = new Map(repairs.filter((x) => x.action === 'repair').map((x) => [x.index, x.to]));
  if (rewrite.size === 0) return { repairs, next: null };
  return {
    repairs,
    next: JSON.stringify({
      ...(pack as Record<string, unknown>),
      rules: rules.map((entry, i) =>
        rewrite.has(i) ? { ...(entry as Record<string, unknown>), pattern: rewrite.get(i) } : entry,
      ),
    }),
  };
}
