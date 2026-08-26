import type { CoopRule, CoopRulePack } from './coop-rules';
import { toCoopRule } from './coop-rule-authoring';
import type { AcceptedRule } from './coop-draft';

/**
 * Merging drafted rules into the pack a make already has.
 *
 * ── WHY MERGE AND NOT WRITE A NEW ROW ──
 *
 * `loadCoopPackForReview` selects ONE pack per make — `orderBy effectiveFrom desc,
 * updatedAt desc, take 1`. So a second row for a make it already has would carry the
 * newest `updatedAt` and SHADOW the existing pack completely. Writing drafted packs
 * as new rows would have silently switched off co-op checking for Chevrolet, Mazda
 * and Subaru — the only three brands that have it — replacing 46 human-verified
 * rules with a pack whose rules are all proposals, and proposals evaluate as
 * nothing. That is the "a wrong rule costs a brand its month" failure wearing a
 * different hat, and it is why this module exists.
 *
 * So: one pack per make per edition, and drafted rules join it as proposals.
 *
 * ── APPEND-ONLY ──
 *
 * An existing rule is never modified, reordered or removed. A human wrote or
 * accepted it, and a drafting pass has no standing to overrule that. The merge can
 * only ADD rules marked `proposed`, which evaluate as nothing until someone accepts
 * them — so applying a draft cannot change what any ad is checked against.
 *
 * Pure: no DB, no network, no clock.
 */

/** Identity of a rule for duplicate detection, independent of its id. */
function signature(rule: CoopRule): string {
  const r = rule as CoopRule & Record<string, unknown>;
  const parts = [
    rule.kind,
    String(r.field ?? ''),
    (Array.isArray(r.fields) ? (r.fields as string[]).join('+') : ''),
    String(r.phrase ?? ''),
    String(r.pattern ?? ''),
  ];
  return parts.join('|').toLowerCase().replace(/\s+/g, ' ').trim();
}

export type SkipReason =
  /** A rule with this id is already in the pack. */
  | 'duplicate_id'
  /** A different id, but the same kind and target — the same rule, re-drafted. */
  | 'duplicate_rule'
  /**
   * The rule could not be converted to a storable rule — it is missing something
   * `toCoopRule` requires, such as a citation. Screening guarantees these, so this
   * means a defect upstream; it is reported rather than thrown so one malformed
   * rule cannot abandon a batch of thirty documents part-written.
   */
  | 'malformed';

export interface MergeSkip {
  reason: SkipReason;
  ruleId: string;
  /** The id of the rule already present that this duplicates. */
  existingId: string;
  description: string;
}

export interface MergeResult {
  /** The pack to store. Identical to `existing` when nothing was added. */
  pack: CoopRulePack;
  /** Rules newly appended, all `reviewState: 'proposed'`. */
  added: CoopRule[];
  skipped: MergeSkip[];
  /** Rules already in the pack, untouched. Reported so the caller can say so. */
  keptExisting: number;
}

export interface MergeOptions {
  /** `AdGuidelineDoc` id the draft was taken from, stamped on every added rule. */
  sourceDocId?: string;
  /** Used only when `existing` is null and a pack has to be created. */
  make: string;
  version: string;
  source?: string;
}

/**
 * Append `drafted` to `existing` as proposals.
 *
 * IDEMPOTENT, by rule id AND by signature. Id alone is not enough: rule ids are
 * derived from the description, so re-drafting the same document after a prompt
 * change produces a slightly different description, a different id, and would
 * append a second copy of a rule already awaiting review. Matching on
 * kind + target + phrase catches that, which is what makes re-running a pass safe.
 */
export function mergeDraftedRules(
  existing: CoopRulePack | null,
  drafted: AcceptedRule[],
  opts: MergeOptions,
): MergeResult {
  const base: CoopRulePack = existing ?? {
    make: opts.make,
    version: opts.version,
    source: opts.source,
    verified: false,
    rules: [],
  };

  const byId = new Map(base.rules.map((r) => [r.id, r]));
  const bySignature = new Map(base.rules.map((r) => [signature(r), r]));

  const added: CoopRule[] = [];
  const skipped: MergeSkip[] = [];

  for (const item of drafted) {
    let rule: CoopRule;
    try {
      rule = toCoopRule(item.rule);
    } catch (err) {
      skipped.push({
        reason: 'malformed',
        ruleId: item.rule.id ?? '(no id)',
        existingId: '',
        description: `${item.rule.description ?? ''} — ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    const clash = byId.get(rule.id);
    if (clash) {
      skipped.push({
        reason: 'duplicate_id',
        ruleId: rule.id,
        existingId: clash.id,
        description: rule.description,
      });
      continue;
    }
    const same = bySignature.get(signature(rule));
    if (same) {
      skipped.push({
        reason: 'duplicate_rule',
        ruleId: rule.id,
        existingId: same.id,
        description: rule.description,
      });
      continue;
    }

    const stamped: CoopRule = {
      ...rule,
      origin: 'ai',
      reviewState: 'proposed',
      sourcePage: item.source.page,
      sourceQuote: item.source.quote,
      ...(opts.sourceDocId ? { sourceDocId: opts.sourceDocId } : {}),
    };
    added.push(stamped);
    byId.set(stamped.id, stamped);
    bySignature.set(signature(stamped), stamped);
  }

  return {
    // Existing rules FIRST and unchanged; proposals appended after them.
    pack: { ...base, rules: [...base.rules, ...added] },
    added,
    skipped,
    keptExisting: base.rules.length,
  };
}
