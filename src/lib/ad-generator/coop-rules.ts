import type { AdData } from './types';
import type { DocElement, TemplateDoc } from './doc-types';
import { parseOfferNumber } from './numbers';

/**
 * Co-op compliance rule packs — machine-checkable per-OEM advertising rules.
 *
 * WHY THIS IS SEPARATE FROM `AdOemOfferRule`. That model answers "which FIELDS
 * must be filled" — it catches a missing VIN. It cannot catch "the disclaimer is
 * smaller than the manufacturer permits", "this brand forbids the word FREE", or
 * "the logo has to sit in the lower third". Those are the rules a human designer
 * applies from memory, and once generation runs unattended there is no human
 * applying them. Co-op reimbursement is real money and a rejected claim surfaces
 * weeks later, so these have to become assertions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  THIS FILE DELIBERATELY CONTAINS NO ACTUAL OEM RULES.
 *
 * Every rule must be transcribed from the real co-op guideline document for that
 * brand, with a `citation` pointing at the section it came from. Inventing a
 * plausible-sounding threshold ("Toyota requires 8pt") would be worse than having
 * no check at all: it manufactures false confidence in a compliance system, and
 * a wrong rule either blocks valid ads or passes invalid ones. `EXAMPLE_PACK`
 * below exists to document the SHAPE and is marked as non-authoritative.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Deterministic by construction — no model in the loop. When a rule blocks an ad
 * the dealer gets a citation they can check, not an opinion.
 *
 * Pure: no DB, no network, no clock.
 */

export type CoopSeverity = 'error' | 'warning';

/** Narrows a rule to particular offer types and/or output sizes. */
export interface CoopScope {
  /** Offer types this rule applies to. Omitted = all. */
  offerTypes?: string[];
  /** Size ids this rule applies to. Omitted = all sizes being rendered. */
  sizes?: string[];
}

interface CoopRuleBase {
  /** Stable id, unique within the pack — appears in findings and run logs. */
  id: string;
  severity: CoopSeverity;
  /** What the rule requires, in plain language, for the person who gets blocked. */
  description: string;
  /** Where this came from in the source document, e.g. "2026 Co-op §4.2 p.11".
   *  Required in practice: an uncitable rule can't be audited or defended. */
  citation?: string;
  scope?: CoopScope;

  // ── provenance, for a DRAFTED rule ───────────────────────────────────────
  //
  // Absent on every hand-transcribed rule, which is why all of these are optional
  // and why absence must read as "a human wrote this" rather than as "unreviewed".
  // Ignored by evaluation — a rule is judged on what it requires, never on where it
  // came from — but they are what make a drafted rule reviewable, and what let an
  // advisory answer deep-link a rule to the page it was taken from.

  /** Who wrote it. `human` once a reviewer edits a drafted rule. */
  origin?: 'ai' | 'human';
  /**
   * A `proposed` rule DOES NOT EVALUATE — not as an error, not as a warning — until
   * a human accepts it. Stricter than the `verified` downgrade on purpose: a drafting
   * pass can add hundreds of rules at once, and a flood of unaccepted warnings would
   * bury the co-op step until people stopped reading it. Absent = accepted, which is
   * correct for every pack transcribed by hand.
   */
  reviewState?: 'proposed' | 'accepted' | 'rejected';
  /** `AdGuidelineDoc` id the rule was taken from. */
  sourceDocId?: string;
  /** 1-based page, verified against the document's stored text. */
  sourcePage?: number;
  /** The verified span the rule rests on. Shown to a reviewer beside the rule. */
  sourceQuote?: string;
  /**
   * Who decided, and when. An accepted rule is an ASSERTION by a named person that
   * this is what the manufacturer requires — unattributed acceptance is not much
   * better than none, which is the same reasoning as `verifiedBy` on the pack row.
   */
  reviewedBy?: string;
  reviewedAt?: string;
}

/** The ad data field a text rule inspects (e.g. `disclaimer`, `tagline`). */
export interface RequiredPhraseRule extends CoopRuleBase {
  kind: 'required_phrase';
  field: string;
  /** Literal text (case-insensitive) that must appear. */
  phrase?: string;
  /** Or a regex source string, for "term OR months" style requirements. */
  pattern?: string;
}

export interface BannedPhraseRule extends CoopRuleBase {
  kind: 'banned_phrase';
  /** Fields to scan. Omitted = every string field in the ad data. */
  fields?: string[];
  phrase?: string;
  /**
   * A PROHIBITED-TERMS LIST — several forbidden terms under one rule.
   *
   * These documents ban wording in bulk: Subaru §6l and §6m list fifty-one terms
   * across one page. One rule per term made that fifty-one rules to review, fifty-one
   * rows to read, and fifty-one chances to mis-click — when the document states it
   * once, as a list. A finding names WHICH term was found, so a blocked ad is still
   * told exactly what to change.
   *
   * Matched on WORD BOUNDARIES, unlike `phrase`. That is not a detail: a fifty-term
   * list makes the substring hazard near-certain, and a banned "cost" that fires
   * inside "costume" blocks an ad for a word nobody used.
   */
  phrases?: string[];
  pattern?: string;
}

/**
 * Minimum size for the text of a bound element. Expressed EITHER as absolute px
 * at each rendered size, or as a fraction of the canvas short edge — the latter
 * being the resolution-independent form, which is what actually transfers across
 * a 1080² square and a 300×600 tower.
 */
export interface MinFontSizeRule extends CoopRuleBase {
  kind: 'min_font_size';
  /** Binding key of the element to measure, e.g. `disclaimer`. */
  field: string;
  minPx?: number;
  /** Fraction of min(width, height), e.g. 0.014 = 1.4% of the short edge. */
  minShortEdgeFraction?: number;
}

/**
 * The element's box must sit within a normalized region of the canvas. Bounds are
 * fractions (0..1) of width/height, matching how DocLayoutBox stores placement.
 */
export interface ElementZoneRule extends CoopRuleBase {
  kind: 'element_zone';
  field: string;
  zone: { x0: number; y0: number; x1: number; y1: number };
}

/** The element's box must be at least this fraction of the canvas. */
export interface MinElementSizeRule extends CoopRuleBase {
  kind: 'min_element_size';
  field: string;
  minWidthFraction?: number;
  minHeightFraction?: number;
}

/** An element bound to `field` must exist and be visible. */
export interface RequiredElementRule extends CoopRuleBase {
  kind: 'required_element';
  field: string;
}

/**
 * One term of a computed limit: a fixed amount, or another field's value,
 * optionally scaled. `factor: 0.2` on `msrp` is "20% of MSRP".
 */
export interface LimitTerm {
  /** A field on the ad data, e.g. `msrp`, `dealerInvoiceTotal`. */
  field?: string;
  /** A fixed amount. Mutually exclusive with `field`. */
  literal?: number;
  /** Multiplier applied to the term. Default 1. */
  factor?: number;
  /** How the term joins the running total. Default 'add'. */
  op?: 'add' | 'subtract';
  /** What this term is, for the observed message ("Dealer invoice"). */
  label?: string;
}

/**
 * A numeric bound on an advertised figure — the manufacturers' pricing rules.
 *
 * This is the kind that unlocks MAAP. Every other rule here matches text or
 * measures a box; none could express "the advertised price may not fall below
 * dealer invoice less the advertising allowance", which is why both transcribed
 * packs record their brand's pricing rules as NOT EXPRESSIBLE. Loomi never held
 * the invoice figure either — that arrives with the Program fields.
 *
 * `limits` holds CANDIDATE limits, each a sum of terms, because at least one
 * brand states its cap two ways at once ("15% of MSRP or $3,500"). With more
 * than one candidate, `select` says which governs — and until the Co-op team
 * confirms which reading is right for a given brand, the rule shouldn't be
 * written at all rather than guessed.
 *
 * Deliberately NOT a general expression language: sums of scaled terms cover
 * every formula we've actually been shown, and anything more would be a rule
 * nobody could read back against the guideline it came from.
 */
export interface NumericLimitRule extends CoopRuleBase {
  kind: 'numeric_limit';
  /** The advertised figure under test, e.g. `salePrice`, `customerDown`. */
  field: string;
  /** 'min' = a floor the figure may not fall below; 'max' = a ceiling. */
  bound: 'min' | 'max';
  /** Candidate limits. Each inner array is summed. */
  limits: LimitTerm[][];
  /** Which candidate governs when there is more than one. */
  select?: 'lowest' | 'highest';
  /** How to render figures in the finding. Default 'currency'. */
  unit?: 'currency' | 'number';
}

export type CoopRule =
  | RequiredPhraseRule
  | BannedPhraseRule
  | MinFontSizeRule
  | ElementZoneRule
  | MinElementSizeRule
  | RequiredElementRule
  | NumericLimitRule;

/**
 * WHEN a rule can actually be decided — the distinction that keeps this engine
 * cheap and its failures legible.
 *
 * `design`  The rule constrains the LAYOUT: is the brandmark present, is the
 *           disclaimer large enough, is the logo inside the permitted zone. The
 *           answer is a property of the template and the offer type, so it is
 *           identical for every ad built from that template. Evaluate it ONCE,
 *           when the design or the pack changes, and a violation reads as "fix
 *           this template" instead of "today's ads didn't generate".
 *
 * `content` The rule inspects TEXT that varies per ad. The disclaimer is resolved
 *           from the manufacturer's own verbatim wording per offer, so a banned
 *           phrase genuinely can appear in one ad and not the next. These have to
 *           run on every render, and they are cheap — regex over a few strings.
 *
 * A geometric rule evaluated per ad isn't merely wasteful, it's misleading: it
 * reports a design fault at the moment of generation, which is the wrong place to
 * look and the wrong person to tell.
 */
export type CoopRuleScope = 'design' | 'content';

export const RULE_SCOPE: Record<CoopRule['kind'], CoopRuleScope> = {
  required_element: 'design',
  min_font_size: 'design',
  element_zone: 'design',
  min_element_size: 'design',
  required_phrase: 'content',
  banned_phrase: 'content',
  // The figures under test are the offer's own — they change with every ad.
  numeric_limit: 'content',
};

export function ruleScope(rule: CoopRule): CoopRuleScope {
  return RULE_SCOPE[rule.kind];
}

/**
 * Split a pack into its design-time and per-ad halves, preserving make/version/
 * verified on both so either can be evaluated independently.
 *
 * Both halves are always returned, even when empty — an empty design half means
 * "nothing to check about the layout", which is a real and valid verdict, not a
 * missing one.
 */
export function splitCoopPack(pack: CoopRulePack): { design: CoopRulePack; content: CoopRulePack } {
  const shell = { make: pack.make, version: pack.version, source: pack.source, verified: pack.verified };
  return {
    design: { ...shell, rules: pack.rules.filter((r) => ruleScope(r) === 'design') },
    content: { ...shell, rules: pack.rules.filter((r) => ruleScope(r) === 'content') },
  };
}

/**
 * A field a manufacturer requires a PERSON to fill in on every ad.
 *
 * ── WHY THIS IS NOT A `required_element` RULE ──
 *
 * `required_element` is evaluated against the TEMPLATE: does the design have an
 * element bound to this field, placed in a rendered size. This is the other half —
 * does the ad's DATA carry a value. A template can have an MSRP element while a
 * given ad leaves MSRP blank, and only one of those two checks catches it.
 *
 * They also draw from different vocabularies in practice. Nobody fills in a logo per
 * ad (it comes from account branding), and nobody designs an "expiration element" —
 * so `logoUrl` belongs to the design check and `expiration` to this one, even though
 * both are things the document says the ad must carry.
 *
 * Accepted entries are written into `AdOemOfferRule.requiredFields`, which preflight,
 * generation, the dry run and template sync already read. They live here until then
 * because that model is a plain map of field-name arrays with nowhere to record a
 * quote, a page or a review state.
 */
export interface RequiredFieldEntry {
  /** FieldSpec / AdData key, e.g. `expiration`, `aprTerm`. */
  field: string;
  /** Offer types it applies to. Empty means every offer type the make advertises. */
  offerTypes: string[];
  /** What the document requires, in a sentence, for whoever is reviewing. */
  reason: string;

  origin?: 'ai' | 'human';
  reviewState?: 'proposed' | 'accepted' | 'rejected';
  sourceDocId?: string;
  sourcePage?: number;
  sourceQuote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface CoopRulePack {
  make: string;
  /** Guideline edition, e.g. "2026-Q3". Packs are versioned, never overwritten:
   *  an ad approved last quarter has to stay explicable against the rules that
   *  were in force then. */
  version: string;
  /** The document these rules were transcribed from. */
  source?: string;
  /** True only when a human has checked the pack against the source document.
   *  An unverified pack still evaluates, but findings are downgraded to warnings
   *  so a half-transcribed pack can't block a dealer's whole month. */
  verified?: boolean;
  rules: CoopRule[];
  /**
   * Fields the manufacturer requires a person to fill in, awaiting review or already
   * decided. Carried on the pack because it is the same drafting artifact, and
   * because `AdOemOfferRule` has nowhere to record a quote or a review state.
   *
   * The rule engine ignores this entirely — it is a separate array, so a proposal
   * here can never be evaluated as a rule.
   */
  requiredFields?: RequiredFieldEntry[];
}

export interface CoopFinding {
  ruleId: string;
  severity: CoopSeverity;
  /** The rule's plain-language requirement. */
  description: string;
  citation?: string;
  /** What was actually observed, so the gap is obvious without re-deriving it. */
  observed: string;
  field?: string;
  sizes?: string[];
}

// ── helpers ──────────────────────────────────────────────────────────────────

function inScope(rule: CoopRule, offerType: string, sizeId?: string): boolean {
  const s = rule.scope;
  if (!s) return true;
  if (s.offerTypes?.length && !s.offerTypes.includes(offerType)) return false;
  if (sizeId && s.sizes?.length && !s.sizes.includes(sizeId)) return false;
  return true;
}

/** Build a case-insensitive matcher from a rule's `phrase` or `pattern`. */
/** Escape a literal for use in a regex. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A word-boundary matcher for one literal term.
 *
 * `\b` is added only where the term's own edge is a word character: a term like
 * "$1,000 off" or "(dealer)" has punctuation at the edge, and `\b` there would
 * refuse to match at all. Internal whitespace is made flexible, because extracted
 * and typed text disagree about how many spaces sit between two words.
 */
function termMatcher(term: string): ((text: string) => boolean) | null {
  const trimmed = term.trim();
  if (!trimmed) return null;
  const body = escapeRe(trimmed).replace(/\\?\s+/g, '\\s+');
  const lead = /^\w/.test(trimmed) ? '\\b' : '';
  const tail = /\w$/.test(trimmed) ? '\\b' : '';
  try {
    const re = new RegExp(`${lead}${body}${tail}`, 'i');
    return (text) => re.test(text);
  } catch {
    return null;
  }
}

/** Which term of a list appears in `text`, or null. */
function firstMatchingTerm(terms: string[], text: string): string | null {
  for (const term of terms) {
    const test = termMatcher(term);
    if (test && test(text)) return term;
  }
  return null;
}

function matcher(rule: { phrase?: string; pattern?: string }): ((text: string) => boolean) | null {
  if (rule.pattern) {
    try {
      const re = new RegExp(rule.pattern, 'i');
      return (text) => re.test(text);
    } catch {
      // A malformed pattern must not silently pass everything.
      return null;
    }
  }
  if (rule.phrase) {
    const needle = rule.phrase.toLowerCase();
    return (text) => text.toLowerCase().includes(needle);
  }
  return null;
}

/**
 * Elements that display `field`, matched by binding KEY across binding kinds.
 *
 * Both `field` and `brand` bindings carry a key, and the account-derived values a
 * co-op rule cares about most — `logoUrl`, `dealerName`, `brandColor` — are
 * normally wired as `brand` bindings, not `field`. Matching only `kind: 'field'`
 * therefore reported "the template has no element bound to logoUrl" for a
 * template with a perfectly good logo element, which would have made every
 * brandmark rule fire falsely on every ad.
 */
function elementsFor(doc: TemplateDoc, field: string): DocElement[] {
  return doc.elements.filter(
    (el) =>
      (el.binding?.kind === 'field' || el.binding?.kind === 'brand') && el.binding.key === field,
  );
}

/** Half a cent — money comparisons must not trip on binary float error. */
const MONEY_EPSILON = 0.005;

function fmtLimit(n: number, unit: 'currency' | 'number' = 'currency'): string {
  const body = n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return unit === 'currency' ? `$${body}` : body;
}

/** Describe a term for the observed message, e.g. "20% of MSRP", "$3,500". */
function describeTerm(t: LimitTerm, unit: 'currency' | 'number'): string {
  const name = t.label ?? t.field ?? '';
  if (t.literal != null) return fmtLimit(t.literal, unit);
  const factor = t.factor ?? 1;
  return factor === 1 ? name : `${(factor * 100).toLocaleString('en-US', { maximumFractionDigits: 4 })}% of ${name}`;
}

interface Candidate {
  value: number;
  /** The arithmetic, so a blocked dealer can check it rather than trust it. */
  math: string;
}

/**
 * Compute one candidate limit. Returns null when ANY term is missing — a partial
 * sum is a different number, not a smaller one, and enforcing it would be worse
 * than admitting we couldn't check.
 */
function computeCandidate(terms: LimitTerm[], data: AdData, unit: 'currency' | 'number'): Candidate | null {
  let sum = 0;
  const parts: string[] = [];
  for (const t of terms) {
    const base = t.literal != null ? t.literal : t.field ? parseOfferNumber(data[t.field]) : null;
    if (base == null) return null;
    const value = base * (t.factor ?? 1);
    const subtract = t.op === 'subtract';
    sum += subtract ? -value : value;
    parts.push(`${parts.length === 0 ? '' : subtract ? '− ' : '+ '}${describeTerm(t, unit)}`);
  }
  return { value: sum, math: `${parts.join(' ')} = ${fmtLimit(sum, unit)}` };
}

/** Whether an element is visible for this data (honours `visibleWhen`). */
function elementVisible(el: DocElement, data: AdData): boolean {
  if (!el.visibleWhen) return true;
  return el.visibleWhen.in.includes(data[el.visibleWhen.field] ?? '');
}

/** Sizes where the element has a non-hidden placement. */
function placedSizes(doc: TemplateDoc, elId: string, sizeIds: string[]): string[] {
  return sizeIds.filter((sid) => {
    const box = doc.layouts?.[sid]?.[elId];
    return !!box && !box.hidden;
  });
}

export interface CoopEvalInput {
  doc: TemplateDoc;
  /** Merged render data — same input preflight uses. */
  data: AdData;
  pack: CoopRulePack;
  /** Sizes being rendered. Defaults to every size the doc defines. */
  sizeIds?: string[];
}

/**
 * Evaluate a pack against an ad. Returns one finding per violated rule (per
 * affected size where the rule is geometric).
 *
 * An UNVERIFIED pack's findings are downgraded to warnings: a pack someone is
 * still transcribing shouldn't be able to block every ad for a brand.
 */
export function evaluateCoopRules({ doc, data, pack, sizeIds }: CoopEvalInput): CoopFinding[] {
  const sizes = sizeIds?.length ? sizeIds : doc.sizes.map((s) => s.id);
  const offerType = data.offerType || 'custom';
  const findings: CoopFinding[] = [];
  const downgrade = pack.verified === false;

  const push = (f: CoopFinding) => {
    findings.push(downgrade && f.severity === 'error' ? { ...f, severity: 'warning' } : f);
  };

  for (const rule of pack.rules) {
    if (!inScope(rule, offerType)) continue;

    switch (rule.kind) {
      case 'required_phrase': {
        const test = matcher(rule);
        const value = (data[rule.field] ?? '').trim();
        if (!test) {
          push({
            ruleId: rule.id,
            severity: 'error',
            description: rule.description,
            citation: rule.citation,
            field: rule.field,
            observed: 'Rule is malformed — it defines neither a phrase nor a valid pattern.',
          });
          break;
        }
        if (!test(value)) {
          push({
            ruleId: rule.id,
            severity: rule.severity,
            description: rule.description,
            citation: rule.citation,
            field: rule.field,
            observed: value ? `"${value.slice(0, 120)}" does not contain it` : `${rule.field} is empty`,
          });
        }
        break;
      }

      case 'banned_phrase': {
        const terms = rule.phrases?.filter((x) => x.trim()) ?? [];
        const test = terms.length ? null : matcher(rule);
        if (!test && terms.length === 0) break;
        // Scan the named fields, or every string value when unscoped. Skip the
        // internal `_`-prefixed bookkeeping keys — they never reach the canvas.
        const entries = rule.fields?.length
          ? rule.fields.map((f) => [f, data[f] ?? ''] as const)
          : Object.entries(data).filter(([k]) => !k.startsWith('_'));
        for (const [key, value] of entries) {
          if (typeof value !== 'string' || !value.trim()) continue;
          // A list names the term that was found; whoever is blocked needs to know
          // which of fifty-one words to change, not that one of them is present.
          const hit = terms.length ? firstMatchingTerm(terms, value) : test?.(value) ? '' : null;
          if (hit === null) continue;
          push({
            ruleId: rule.id,
            severity: rule.severity,
            description: rule.description,
            citation: rule.citation,
            field: key,
            observed: hit
              ? `${key} contains "${hit}": "${value.slice(0, 120)}"`
              : `${key} contains it: "${value.slice(0, 120)}"`,
          });
        }
        break;
      }

      case 'numeric_limit': {
        const unit = rule.unit ?? 'currency';
        if (!rule.limits?.length) {
          push({
            ruleId: rule.id,
            severity: 'error',
            description: rule.description,
            citation: rule.citation,
            field: rule.field,
            observed: 'Rule is malformed — it defines no limit.',
          });
          break;
        }
        if (rule.limits.length > 1 && !rule.select) {
          // Several candidate limits with no rule for choosing between them is
          // ambiguous, and guessing would silently pick a threshold nobody agreed.
          push({
            ruleId: rule.id,
            severity: 'error',
            description: rule.description,
            citation: rule.citation,
            field: rule.field,
            observed: 'Rule is malformed — it gives several limits but does not say which governs.',
          });
          break;
        }

        const actual = parseOfferNumber(data[rule.field]);
        const candidates = rule.limits.map((terms) => computeCandidate(terms, data, unit));

        // "Couldn't check" must never read as "passed". It's reported at warning
        // severity whatever the rule's own severity, so a figure the dealer has
        // no way to supply can't block their whole month — while still leaving a
        // visible mark that this rule went unverified.
        if (actual == null || candidates.some((c) => c == null)) {
          const why =
            actual == null
              ? `${rule.field} is empty or not a number`
              : 'a figure the limit depends on is missing';
          push({
            ruleId: rule.id,
            severity: 'warning',
            description: rule.description,
            citation: rule.citation,
            field: rule.field,
            observed: `Not checked — ${why}.`,
          });
          break;
        }

        const found = candidates as Candidate[];
        const governing =
          found.length === 1
            ? found[0]
            : found.reduce((a, b) =>
                (rule.select === 'highest' ? b.value > a.value : b.value < a.value) ? b : a,
              );

        const violates =
          rule.bound === 'min'
            ? actual < governing.value - MONEY_EPSILON
            : actual > governing.value + MONEY_EPSILON;

        if (violates) {
          push({
            ruleId: rule.id,
            severity: rule.severity,
            description: rule.description,
            citation: rule.citation,
            field: rule.field,
            observed:
              `${rule.field} is ${fmtLimit(actual, unit)}; the ` +
              `${rule.bound === 'min' ? 'floor' : 'ceiling'} is ${fmtLimit(governing.value, unit)} ` +
              `(${governing.math})`,
          });
        }
        break;
      }

      case 'required_element': {
        const els = elementsFor(doc, rule.field).filter((el) => elementVisible(el, data));
        const visibleSomewhere = els.some((el) => placedSizes(doc, el.id, sizes).length > 0);
        if (!visibleSomewhere) {
          push({
            ruleId: rule.id,
            severity: rule.severity,
            description: rule.description,
            citation: rule.citation,
            field: rule.field,
            observed: els.length
              ? `An element for "${rule.field}" exists but is not placed in any rendered size`
              : `The template has no element bound to "${rule.field}"`,
          });
        }
        break;
      }

      case 'min_font_size': {
        const els = elementsFor(doc, rule.field).filter((el) => elementVisible(el, data));
        if (els.length === 0) break; // required_element is the rule for absence
        for (const size of doc.sizes) {
          if (!sizes.includes(size.id)) continue;
          if (!inScope(rule, offerType, size.id)) continue;
          const shortEdge = Math.min(size.width, size.height);
          const floor = Math.max(
            rule.minPx ?? 0,
            rule.minShortEdgeFraction ? rule.minShortEdgeFraction * shortEdge : 0,
          );
          if (floor <= 0) continue;
          for (const el of els) {
            const box = doc.layouts?.[size.id]?.[el.id];
            if (!box || box.hidden) continue;
            const declared = box.fontSize ?? 0;
            if (declared > 0 && declared < floor) {
              push({
                ruleId: rule.id,
                severity: rule.severity,
                description: rule.description,
                citation: rule.citation,
                field: rule.field,
                sizes: [size.id],
                observed: `${size.id}: ${Math.round(declared)}px declared, minimum ${Math.round(floor)}px`,
              });
            }
          }
        }
        break;
      }

      case 'element_zone': {
        const els = elementsFor(doc, rule.field).filter((el) => elementVisible(el, data));
        for (const el of els) {
          for (const sid of placedSizes(doc, el.id, sizes)) {
            if (!inScope(rule, offerType, sid)) continue;
            const b = doc.layouts[sid][el.id];
            const z = rule.zone;
            const inside =
              b.x >= z.x0 - 1e-6 &&
              b.y >= z.y0 - 1e-6 &&
              b.x + b.w <= z.x1 + 1e-6 &&
              b.y + b.h <= z.y1 + 1e-6;
            if (!inside) {
              const pct = (n: number) => `${Math.round(n * 100)}%`;
              push({
                ruleId: rule.id,
                severity: rule.severity,
                description: rule.description,
                citation: rule.citation,
                field: rule.field,
                sizes: [sid],
                observed: `${sid}: box spans x ${pct(b.x)}–${pct(b.x + b.w)}, y ${pct(b.y)}–${pct(
                  b.y + b.h,
                )}; required within x ${pct(z.x0)}–${pct(z.x1)}, y ${pct(z.y0)}–${pct(z.y1)}`,
              });
            }
          }
        }
        break;
      }

      case 'min_element_size': {
        const els = elementsFor(doc, rule.field).filter((el) => elementVisible(el, data));
        for (const el of els) {
          for (const sid of placedSizes(doc, el.id, sizes)) {
            if (!inScope(rule, offerType, sid)) continue;
            const b = doc.layouts[sid][el.id];
            const tooNarrow = rule.minWidthFraction != null && b.w < rule.minWidthFraction - 1e-6;
            const tooShort = rule.minHeightFraction != null && b.h < rule.minHeightFraction - 1e-6;
            if (tooNarrow || tooShort) {
              const pct = (n: number) => `${Math.round(n * 100)}%`;
              const parts: string[] = [];
              if (tooNarrow) parts.push(`width ${pct(b.w)} < ${pct(rule.minWidthFraction!)}`);
              if (tooShort) parts.push(`height ${pct(b.h)} < ${pct(rule.minHeightFraction!)}`);
              push({
                ruleId: rule.id,
                severity: rule.severity,
                description: rule.description,
                citation: rule.citation,
                field: rule.field,
                sizes: [sid],
                observed: `${sid}: ${parts.join(', ')}`,
              });
            }
          }
        }
        break;
      }
    }
  }

  return findings;
}

/** True when nothing at error severity was found — safe to render. */
export function coopPassed(findings: CoopFinding[]): boolean {
  return !findings.some((f) => f.severity === 'error');
}

/** Parse a stored pack defensively. Returns null when unusable, so a corrupt
 *  pack degrades to "no co-op checks" rather than throwing mid-run. */
export function parseCoopPack(json: string): CoopRulePack | null {
  try {
    const p = JSON.parse(json) as CoopRulePack;
    if (!p || typeof p.make !== 'string' || !Array.isArray(p.rules)) return null;
    // Drop entries missing the fields every rule needs.
    p.rules = p.rules.filter(
      (r) => r && typeof r.id === 'string' && typeof r.kind === 'string' && typeof r.description === 'string',
    );
    return p;
  } catch {
    return null;
  }
}

/**
 * A NON-AUTHORITATIVE example pack, purely to document the shape.
 *
 * The thresholds and phrases here are ILLUSTRATIVE. They are not transcribed
 * from any manufacturer's co-op guidelines and must never be treated as such —
 * note `verified: false`, which downgrades every finding to a warning so this
 * can't block anything if it is left enabled by accident.
 */
export const EXAMPLE_PACK: CoopRulePack = {
  make: '__example__',
  version: 'example',
  source: 'Not a real co-op document — shape reference only',
  verified: false,
  rules: [
    {
      id: 'example-disclaimer-present',
      kind: 'required_element',
      field: 'disclaimer',
      severity: 'error',
      description: 'The ad must display a disclaimer.',
      citation: 'EXAMPLE — replace with a real citation',
    },
    {
      id: 'example-credit-language',
      kind: 'required_phrase',
      field: 'disclaimer',
      pattern: 'approved credit|qualified buyers|well-qualified',
      severity: 'error',
      description: 'Finance and lease disclaimers must state a credit qualification.',
      citation: 'EXAMPLE — replace with a real citation',
      scope: { offerTypes: ['lease', 'apr'] },
    },
    {
      id: 'example-no-absolutes',
      kind: 'banned_phrase',
      pattern: '\\bfree\\b|\\bguaranteed\\b|lowest price',
      severity: 'error',
      description: 'Absolute or unqualified claims are not permitted.',
      citation: 'EXAMPLE — replace with a real citation',
    },
    {
      id: 'example-disclaimer-legibility',
      kind: 'min_font_size',
      field: 'disclaimer',
      minShortEdgeFraction: 0.012,
      severity: 'error',
      description: 'The disclaimer must be at least 1.2% of the canvas short edge.',
      citation: 'EXAMPLE — replace with a real citation',
    },
  ],
};
