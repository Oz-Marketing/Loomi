import type { CoopRule, CoopRulePack, RequiredFieldEntry } from './coop-rules';

/**
 * Deciding on drafted rules — the human gate.
 *
 * Accepting a rule is the moment it starts affecting ads, so this is the one place
 * where a drafted rule changes from inert to enforced. Three properties matter:
 *
 *   • ONLY A RULE IN REVIEW CAN BE DECIDED. A hand-written rule carries no
 *     `reviewState`, is not in the queue, and must not be reachable by a review
 *     action — otherwise a stray id in a bulk request could reject a rule a person
 *     wrote and enforce for years. Those are reported as `notInReview`, never
 *     applied.
 *   • DECISIONS ARE ATTRIBUTED. An accepted rule records who accepted it, for the
 *     same reason the pack records who verified it.
 *   • REJECTION IS NOT DELETION. A rejected rule stays in the pack, marked. It
 *     evaluates as nothing, and keeping it means a later drafting pass recognises
 *     it as already-decided instead of proposing it again every month.
 *
 * Pure: no DB, no network, no clock — `now` and `reviewer` are passed in so a test
 * can assert on them and two callers can't disagree about the time.
 */

export type ReviewDecision = 'accepted' | 'rejected';

export interface RuleReview {
  ruleId: string;
  state: ReviewDecision;
}

export interface ApplyReviewsResult {
  pack: CoopRulePack;
  /** Rules whose state actually changed. */
  applied: { ruleId: string; from: string; to: ReviewDecision }[];
  /** Ids not present in the pack at all. */
  notFound: string[];
  /** Ids that resolve to a rule which was never in review — refused. */
  notInReview: string[];
  /** Already in the requested state; a no-op rather than an error. */
  unchanged: string[];
}

/** A rule is in review if it carries an explicit reviewState. */
function reviewStateOf(rule: CoopRule): string | null {
  return rule.reviewState ?? null;
}

export function applyRuleReviews(
  pack: CoopRulePack,
  reviews: RuleReview[],
  reviewer: string,
  now: Date,
): ApplyReviewsResult {
  const wanted = new Map<string, ReviewDecision>();
  for (const r of reviews) {
    const id = r.ruleId?.trim();
    if (id) wanted.set(id, r.state);
  }

  const applied: ApplyReviewsResult['applied'] = [];
  const notInReview: string[] = [];
  const unchanged: string[] = [];
  const seen = new Set<string>();
  const stamp = now.toISOString();

  const rules = pack.rules.map((rule) => {
    const want = wanted.get(rule.id);
    if (!want) return rule;
    seen.add(rule.id);

    const state = reviewStateOf(rule);
    if (state === null) {
      // A hand-written rule. Not in the queue, so not decidable here.
      notInReview.push(rule.id);
      return rule;
    }
    if (state === want) {
      unchanged.push(rule.id);
      return rule;
    }
    applied.push({ ruleId: rule.id, from: state, to: want });
    return { ...rule, reviewState: want, reviewedBy: reviewer, reviewedAt: stamp };
  });

  const notFound = [...wanted.keys()].filter((id) => !seen.has(id));
  return { pack: { ...pack, rules }, applied, notFound, notInReview, unchanged };
}

/** The rules a reviewer still has to decide on, in the order they were drafted. */
export function pendingRules(pack: CoopRulePack): CoopRule[] {
  return pack.rules.filter((r) => r.reviewState === 'proposed');
}

/**
 * Does accepting or rejecting any of these change what is ENFORCED?
 *
 * Used to decide whether cached template verdicts must be dropped. Rejecting a
 * proposal changes nothing that was in force (a proposal enforced nothing), but
 * ACCEPTING one does, and re-opening an accepted rule back to rejected does too.
 */
export function changesEnforcement(applied: ApplyReviewsResult['applied']): boolean {
  return applied.some((a) => a.to === 'accepted' || a.from === 'accepted');
}

/**
 * Pending rules grouped for review, biggest group first.
 *
 * Grouped by KIND because that is how the source document is shaped: a
 * prohibited-terms list arrives as thirty `banned_phrase` rules together, the layout
 * requirements arrive together, and a reviewer forms one opinion per group far more
 * often than one per rule. Biggest first because the largest group is both the one
 * most likely to be decided in one action and the one that would otherwise be
 * buried under three singletons.
 *
 * Extracted from the review panel so the ordering is verifiable without a DOM.
 */
export function groupPendingByKind(rules: CoopRule[]): { kind: string; rules: CoopRule[] }[] {
  const by = new Map<string, CoopRule[]>();
  for (const r of pendingRules({ rules } as CoopRulePack)) {
    // `required_element` is reviewed in the merged "must include" list instead —
    // see mergeMustInclude. Leaving it here too would ask the same question twice.
    if (r.kind === 'required_element') continue;
    const list = by.get(r.kind) ?? [];
    list.push(r);
    by.set(r.kind, list);
  }
  return [...by.entries()]
    .map(([kind, list]) => ({ kind, rules: list }))
    // Ties broken by kind name so the order is stable across renders rather than
    // depending on which rule the drafter happened to emit first.
    .sort((a, b) => b.rules.length - a.rules.length || a.kind.localeCompare(b.kind));
}

// ── required fields ──────────────────────────────────────────────────────────

export interface ApplyFieldReviewsResult {
  pack: CoopRulePack;
  applied: { key: string; from: string; to: ReviewDecision }[];
  notFound: string[];
  unchanged: string[];
}

/** How a required-field entry is addressed in a decision: field plus its scope. */
export function requiredFieldKey(e: { field: string; offerTypes?: string[] }): string {
  return `${e.field}|${[...(e.offerTypes ?? [])].sort().join(',')}`;
}

/** Entries still awaiting a decision. */
export function pendingRequiredFields(pack: CoopRulePack): RequiredFieldEntry[] {
  return (pack.requiredFields ?? []).filter((e) => e.reviewState === 'proposed');
}

/**
 * Decide on drafted required fields.
 *
 * Mirrors {@link applyRuleReviews}, including the part that matters: an entry with no
 * `reviewState` was written by a person and is not in the queue, so a decision cannot
 * reach it. Rejection marks rather than deletes, so a later pass recognises the entry
 * as already-declined instead of proposing it again.
 */
export function applyRequiredFieldReviews(
  pack: CoopRulePack,
  keys: { key: string; state: ReviewDecision }[],
  reviewer: string,
  now: Date,
): ApplyFieldReviewsResult {
  const wanted = new Map(keys.filter((k) => k.key?.trim()).map((k) => [k.key, k.state]));
  const applied: ApplyFieldReviewsResult['applied'] = [];
  const unchanged: string[] = [];
  const seen = new Set<string>();
  const stamp = now.toISOString();

  const entries = (pack.requiredFields ?? []).map((entry) => {
    const key = requiredFieldKey(entry);
    const want = wanted.get(key);
    if (!want) return entry;
    seen.add(key);
    const state = entry.reviewState ?? null;
    if (state === null) return entry; // hand-written; not in review
    if (state === want) {
      unchanged.push(key);
      return entry;
    }
    applied.push({ key, from: state, to: want });
    return { ...entry, reviewState: want, reviewedBy: reviewer, reviewedAt: stamp };
  });

  return {
    pack: { ...pack, requiredFields: entries },
    applied,
    notFound: [...wanted.keys()].filter((k) => !seen.has(k)),
    unchanged,
  };
}

/**
 * The accepted entries folded into the `{offerType: field[]}` shape
 * `AdOemOfferRule.requiredFields` stores.
 *
 * ADDITIVE ONLY. It merges into whatever a person already put there rather than
 * replacing it: four makes have hand-maintained lists today, two of them for brands
 * with no rule pack at all, and a derived list that replaced them would delete
 * requirements nobody had recorded a source for.
 *
 * An entry with no `offerTypes` applies to every type in `allOfferTypes`.
 */
export function foldRequiredFields(
  pack: CoopRulePack,
  allOfferTypes: string[],
  current: Record<string, string[]> = {},
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(current)) out[k] = [...v];

  for (const entry of pack.requiredFields ?? []) {
    if (entry.reviewState !== 'accepted') continue;
    const types = entry.offerTypes.length ? entry.offerTypes : allOfferTypes;
    for (const type of types) {
      const list = out[type] ?? [];
      if (!list.includes(entry.field)) list.push(entry.field);
      out[type] = list;
    }
  }
  return out;
}

// ── "the ad must include X" ───────────────────────────────────────────────────

/**
 * ONE list of things the ad must include, merged from the two mechanisms that
 * enforce it.
 *
 * ── WHY THIS EXISTS ──
 *
 * There are two genuinely different checks. `required_element` asks whether the
 * TEMPLATE has a place for a field, evaluated once against the design.
 * `AdOemOfferRule.requiredFields` asks whether an AD carries a value, evaluated per
 * ad. A template can have an MSRP element while an ad leaves MSRP blank, and only
 * one of the two catches it — so both have to exist.
 *
 * What should NOT exist is a reviewer having to know that. "The ad must show the
 * MSRP" is one requirement from the document; which of our two mechanisms enforces
 * it is our business, and it is DERIVABLE: a field a person fills needs both checks,
 * a logo or a computed offer value can only be checked in the design. So the two
 * halves are merged here and the enforcement is decided by the field, not asked of
 * the person.
 *
 * `fillable` is passed in rather than imported to keep this module pure and free of
 * the offer-kind registry.
 */
export interface MustIncludeRow {
  /** Stable row identity for selection. */
  key: string;
  field: string;
  /** What the document requires, for the reviewer. */
  reason: string;
  /** Where it is checked. Derived from the field, never asked. */
  enforcement: 'design' | 'data' | 'both';
  offerTypes: string[];
  /** The underlying items this row stands for, dispatched to on accept. */
  ruleId?: string;
  fieldKey?: string;
  sourceQuote?: string;
  sourcePage?: number;
  sourceDocId?: string;
  citation?: string;
}

export function mergeMustInclude(
  rules: CoopRule[],
  requiredFields: RequiredFieldEntry[],
  fillable: Set<string>,
): MustIncludeRow[] {
  const byField = new Map<string, MustIncludeRow>();

  const designRules = rules.filter(
    (r) => r.kind === 'required_element' && r.reviewState === 'proposed',
  );
  for (const r of designRules) {
    const field = (r as { field?: string }).field ?? '';
    if (!field) continue;
    byField.set(field, {
      key: `f:${field}`,
      field,
      reason: r.description,
      // A design rule alone can only speak for the design; if a data requirement for
      // the same field turns up below, this becomes `both`.
      enforcement: 'design',
      offerTypes: r.scope?.offerTypes ?? [],
      ruleId: r.id,
      sourceQuote: r.sourceQuote,
      sourcePage: r.sourcePage,
      sourceDocId: r.sourceDocId,
      citation: r.citation,
    });
  }

  for (const e of requiredFields) {
    if (e.reviewState !== 'proposed') continue;
    const existing = byField.get(e.field);
    if (existing) {
      existing.enforcement = 'both';
      existing.fieldKey = requiredFieldKey(e);
      // Union the scopes: the design rule may be unscoped while the data
      // requirement names offer types, and the row has to cover both.
      if (existing.offerTypes.length && e.offerTypes.length) {
        existing.offerTypes = [...new Set([...existing.offerTypes, ...e.offerTypes])];
      } else {
        existing.offerTypes = [];
      }
      continue;
    }
    byField.set(e.field, {
      key: `f:${e.field}`,
      field: e.field,
      reason: e.reason,
      // A fillable field with no design rule is still worth checking in the design —
      // but we have no design evidence for it, so claim only what we can enforce.
      enforcement: fillable.has(e.field) ? 'data' : 'design',
      offerTypes: e.offerTypes,
      fieldKey: requiredFieldKey(e),
      sourceQuote: e.sourceQuote,
      sourcePage: e.sourcePage,
      sourceDocId: e.sourceDocId,
    });
  }

  return [...byField.values()].sort((a, b) => a.field.localeCompare(b.field));
}

// ── superseded per-term proposals ────────────────────────────────────────────

/** Lowercased words, for comparing a term against a list entry. */
function termWords(s: string): string {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(' ');
}

export interface SupersededRule {
  ruleId: string;
  /** The single term this rule bans. */
  phrase: string;
  /** The list rule that already covers it. */
  coveredBy: string;
  coverState: 'accepted' | 'proposed';
}

/**
 * Proposed one-term rules that a list rule already covers.
 *
 * Drafting used to emit one rule per banned word: Subaru produced fifty-one of them
 * from a single page. Those proposals are still queued, and a fresh pass adds LIST
 * rules beside them rather than replacing them — nothing can tell that one
 * twenty-eight-term rule supersedes twenty-eight single-term ones, because by id and
 * by content they are unrelated. So the queue gets worse before it gets better, and
 * the fix is to decline the singles the lists have absorbed.
 *
 * NARROW ON PURPOSE:
 *
 *   • Only `proposed` rules. A hand-written rule carries no `reviewState` and is not
 *     in the queue; an accepted one is somebody's decision. Neither is touched.
 *   • Only rules whose term a list rule actually contains. A standalone ban that
 *     appears in no list is not superseded — it is the only thing covering that
 *     term, and declining it would silently drop the requirement.
 *   • By default only ACCEPTED list rules count as cover. A proposed list could
 *     itself be declined later, which would leave the terms covered by nothing;
 *     pass `includeProposedLists` when you intend to accept the lists anyway.
 *
 * Pure.
 */
export function findSupersededPhraseRules(
  pack: CoopRulePack,
  opts: { includeProposedLists?: boolean } = {},
): SupersededRule[] {
  const covers = new Map<string, { id: string; state: 'accepted' | 'proposed' }>();
  for (const r of pack.rules) {
    if (r.kind !== 'banned_phrase') continue;
    const list = (r as { phrases?: string[] }).phrases ?? [];
    if (list.length === 0) continue;
    const state = r.reviewState;
    if (state !== 'accepted' && !(opts.includeProposedLists && state === 'proposed')) continue;
    for (const term of list) {
      const key = termWords(term);
      // First cover wins, and an accepted one always beats a proposed one, so the
      // report names the strongest cover rather than whichever came first.
      const existing = covers.get(key);
      if (!key || (existing && existing.state === 'accepted')) continue;
      covers.set(key, { id: r.id, state: state === 'accepted' ? 'accepted' : 'proposed' });
    }
  }

  const out: SupersededRule[] = [];
  for (const r of pack.rules) {
    if (r.kind !== 'banned_phrase' || r.reviewState !== 'proposed') continue;
    const single = (r as { phrase?: string }).phrase;
    const hasList = ((r as { phrases?: string[] }).phrases ?? []).length > 0;
    if (!single?.trim() || hasList) continue;
    const cover = covers.get(termWords(single));
    if (!cover || cover.id === r.id) continue;
    out.push({ ruleId: r.id, phrase: single, coveredBy: cover.id, coverState: cover.state });
  }
  return out;
}
