import {
  RULE_KINDS,
  suggestRuleId,
  validateRule,
  type DraftRule,
  type RuleKind,
} from './coop-rule-authoring';
import { OFFER_KINDS } from './offer-kinds';
import { enrichOfferFields } from './offer-text';
import { representativeData } from './coop-template-check';
import {
  prepareQuoteCorpus,
  verifyQuoteIn,
  type QuoteCorpus,
  type QuoteLocation,
} from './guideline-quotes';

/**
 * Screening drafted co-op rules before a human sees them.
 *
 * The gate between a model's output and a reviewer's queue. Everything here is a
 * check a machine can make with certainty, so the reviewer's attention is spent
 * only on the judgement a machine cannot make: is this the right reading of the
 * guideline?
 *
 * Four kinds of check, and the ORDER is deliberate — each is cheaper to explain
 * than the next, and the first one is the one that matters:
 *
 *   1. THE QUOTE IS REAL. See `guideline-quotes.ts`. A proposal whose quote isn't
 *      in the document is discarded outright, never queued.
 *   2. THE RULE IS WELL-FORMED. Reuses `validateRule` — the same validator behind
 *      the hand-authoring editor, so a drafted rule must clear exactly the bar a
 *      typed one clears. Not a parallel standard that could drift from it.
 *   3. THE FIELDS EXIST. New, and the reason this module isn't just steps 1 and 2.
 *   4. THE SCOPE EXISTS — offer types must be real offer types.
 *
 * ── WHY CHECK 3 EARNS ITS KEEP ──
 *
 * `validateRule` asks whether a rule NAMES a field, not whether that field exists:
 * `AdData` is `Record<string, string>`, so a rule against `brandLogo` (there is no
 * such key; it's `logoUrl`) is structurally perfect and silently inert — or worse,
 * a `required_element` rule that fails every template because the key is never
 * populated. That exact class of mistake has shipped here once already, in a
 * hand-written pack, where a missed `brand` binding would have failed every
 * brandmark rule on a good template. A drafter typing keys from prose will make it
 * more often, and it is invisible on inspection.
 *
 * ── WHY THE KEY LIST IS DERIVED, NEVER TYPED ──
 *
 * A hand-maintained allowlist would become the very bug it exists to catch: it
 * would fall behind the schema, and start rejecting valid rules for fields that do
 * exist. So {@link knownAdDataKeys} is assembled from the three places ad data
 * actually comes from — the offer kinds' own field schemas, the branding values a
 * design check supplies, and the synthetic `_offer*` values the offer engine
 * computes. Verified against all three hand-transcribed packs (Chevrolet, Mazda,
 * Subaru): every field they reference is known, and nothing is flagged.
 *
 * Pure: no DB, no network, no clock.
 */

/** What a drafter returns for one candidate rule. */
export interface RuleProposal {
  /** 1-based page the drafter says states this requirement. */
  page: number;
  /** Verbatim span from the document that states it. */
  quote: string;
  /**
   * For a SHORT quote — one entry from a prohibited-terms or required-items list —
   * the full-length sentence establishing what the list is. Both must verify on the
   * same page. See `guideline-quotes.ts` MIN_LIST_ITEM_CHARS.
   */
  context?: string;
  /** Section label as the document prints it, e.g. `5e`, `Category 7`. */
  section?: string;
  /** The rule, in authoring shape. `citation` is synthesized, not trusted. */
  rule: Partial<DraftRule>;
  /** Why the drafter read the quote this way. For the reviewer; never evaluated. */
  rationale?: string;
}

/**
 * A requirement the document states that the rule engine cannot express.
 *
 * A first-class output, not a failure. The hand-written packs already record these
 * as source comments — Mazda §7b (price height vs. vehicle height, needs
 * cross-element comparison), §1a–1h (MAAP, needs a Dealer Invoice we don't hold).
 * Collected here they become a ranked list of what engine work would actually buy
 * coverage, instead of knowledge buried in a seed script.
 */
/** A raw "a person must fill this in" proposal, straight from the model. */
export interface RequiredFieldProposal {
  page: number;
  quote: string;
  context?: string;
  section?: string;
  field: string;
  offerTypes?: string[];
  reason: string;
}

export interface AcceptedRequiredField {
  field: string;
  /** Resolved: what the model gave, or empty meaning every offer type. */
  offerTypes: string[];
  reason: string;
  source: QuoteLocation & { quote: string; section?: string };
}

export interface UnexpressibleProposal {
  page: number;
  quote: string;
  section?: string;
  /** What the document requires, in plain language. */
  requirement: string;
  /** Why no rule kind can carry it. */
  why: string;
}

export type DropReason =
  | 'quote_too_short'
  | 'quote_not_found'
  | 'quote_not_evidence'
  | 'quote_context_missing'
  | 'evidence_mismatch'
  | 'unknown_field_for_person'
  | 'duplicate_requirement'
  | 'unknown_kind'
  | 'invalid_severity'
  | 'invalid_rule'
  | 'unknown_field'
  | 'unknown_offer_type';

export interface AcceptedRule {
  /** List terms removed because they were not on the cited page. Reported, not hidden. */
  trimmedTerms?: string[];
  rule: DraftRule;
  /** Always `ai` here. Flips to `human` when a reviewer edits it. */
  origin: 'ai';
  /** Where it came from, verified — this is what the reviewer is shown. */
  source: QuoteLocation & { quote: string; section?: string };
  rationale?: string;
}

export interface DroppedRule {
  reason: DropReason;
  detail: string;
  proposal: RuleProposal;
}

export interface AcceptedNote extends UnexpressibleProposal {
  at: QuoteLocation;
}

export interface ScreenResult {
  /** Ready to queue for review. Nothing here evaluates until a human accepts it. */
  accepted: AcceptedRule[];
  /** Discarded, with the reason — reported so a bad drafting run is visible. */
  dropped: DroppedRule[];
  /** Fields a person must fill in, whose quotes checked out. */
  requiredFields: AcceptedRequiredField[];
  /** Required-field proposals discarded, with why. */
  droppedRequiredFields: { reason: DropReason; detail: string; proposal: RequiredFieldProposal }[];
  /** Stated-but-not-expressible requirements whose quotes checked out. */
  notes: AcceptedNote[];
  /** Notes whose quotes did not check out, discarded for the same reason rules are. */
  droppedNotes: { reason: DropReason; detail: string; proposal: UnexpressibleProposal }[];
}

let keyCache: Set<string> | null = null;

/**
 * Every `AdData` key a rule may legitimately reference.
 *
 * Derived from the schema at runtime — see the module header for why this must
 * never become a typed list.
 */
export function knownAdDataKeys(): Set<string> {
  if (keyCache) return keyCache;
  const keys = new Set<string>();
  // 1. Every offer kind's own field schema (vehicle + custom).
  for (const kind of OFFER_KINDS) for (const f of kind.fields) keys.add(f.key);
  // 2. Per-account branding and the composed disclaimer — present on a real ad but
  //    owned by the account, not by a template field.
  for (const k of Object.keys(representativeData('any'))) keys.add(k);
  // 3. The synthetic `_offer*` values the offer engine computes, for both the
  //    primary and second offer of a dual-offer template.
  for (const k of Object.keys(enrichOfferFields({ offerType: '', o2_offerType: '' }))) {
    keys.add(k);
  }
  keyCache = keys;
  return keys;
}

let offerTypeCache: Set<string> | null = null;

/** Every offer type value across every kind. */
export function knownOfferTypes(): Set<string> {
  if (offerTypeCache) return offerTypeCache;
  const out = new Set<string>();
  for (const kind of OFFER_KINDS) for (const t of kind.offerTypes) out.add(t.value);
  offerTypeCache = out;
  return out;
}

/**
 * The citation, built from the VERIFIED page rather than taken from the drafter.
 *
 * Deliberately synthesized: a citation is the one thing on a rule that has to be
 * true, and a model-supplied page number is exactly what the quote check exists to
 * distrust. Mirrors the format the hand-written packs use, so a drafted rule and a
 * typed one cite identically.
 */
export function buildCitation(source: string, section: string | undefined, page: number): string {
  const where = section?.trim() ? `§${section.trim()}, p.${page}` : `p.${page}`;
  return source.trim() ? `${source.trim()} — ${where}` : where;
}

/**
 * Keys a PERSON fills in on an ad — the offer kinds' own field schemas.
 *
 * Deliberately narrower than {@link knownAdDataKeys}: that also carries account
 * branding (a logo nobody types per ad) and the synthetic `_offer*` values the offer
 * engine computes (which cannot be filled at all). Requiring either as a per-ad field
 * would block every ad on a value no form collects.
 */
let fillableCache: Set<string> | null = null;
export function fillableFieldKeys(): Set<string> {
  if (fillableCache) return fillableCache;
  const keys = new Set<string>();
  for (const kind of OFFER_KINDS) {
    for (const f of kind.fields) if (!f.key.startsWith('_')) keys.add(f.key);
  }
  fillableCache = keys;
  return keys;
}

/** Lowercased, punctuation-stripped words. */
function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Does the quoted evidence support a rule about `phrase`?
 *
 * WORD SUBSET, not substring. A guideline lists combined entries — GM's is
 * `» "The GM store/outlet"`, one bullet covering two forbidden descriptions — and a
 * rule about "GM outlet" is properly supported by it. Substring matching said no,
 * because "gm outlet" is not a contiguous run of "the gm store outlet", and dropped
 * a correct rule. Requiring every word of the phrase to appear in the quote still
 * refuses the case this exists for: a rule about "Employee Pricing" quoting
 * "Clearance" shares no words at all.
 */
function evidenceSupportsPhrase(quote: string, phrase: string): boolean {
  const inQuote = new Set(words(quote));
  const needed = words(phrase);
  if (needed.length === 0) return true;
  return needed.every((w) => inQuote.has(w));
}

/** Field keys a rule references, across every kind that can carry one. */
function referencedFields(rule: Partial<DraftRule>): string[] {
  const out: string[] = [];
  if (rule.field) out.push(rule.field);
  for (const f of rule.fields ?? []) out.push(f);
  // A numeric limit's terms name ad-data fields too, and a typo there makes the
  // limit silently unmeasurable rather than wrong.
  for (const terms of rule.limits ?? []) {
    for (const t of terms) if (t.field) out.push(t.field);
  }
  return out;
}

const QUOTE_DROP: Record<string, DropReason> = {
  too_short: 'quote_too_short',
  not_found: 'quote_not_found',
  not_evidence: 'quote_not_evidence',
  context_not_found: 'quote_context_missing',
};

export interface ScreenOptions {
  /** Document title, for the citation. */
  source: string;
  /** Make the pack is for, used to derive readable rule ids. */
  make: string;
  /** Rule ids already in use — a drafting run must not collide with them. */
  takenIds?: string[];
}

/**
 * Screen a drafting run. Pure; safe to call on untrusted model output.
 */
export function screenRuleProposals(
  proposals: RuleProposal[],
  pages: string[],
  opts: ScreenOptions,
  unexpressible: UnexpressibleProposal[] = [],
  requiredFieldProposals: RequiredFieldProposal[] = [],
): ScreenResult {
  const corpus: QuoteCorpus = prepareQuoteCorpus(pages);
  const known = knownAdDataKeys();
  const offerTypes = knownOfferTypes();
  const taken = [...(opts.takenIds ?? [])];

  const accepted: AcceptedRule[] = [];
  const dropped: DroppedRule[] = [];

  for (const proposal of proposals) {
    const drop = (reason: DropReason, detail: string) =>
      dropped.push({ reason, detail, proposal });

    const quote = verifyQuoteIn(corpus, proposal.page, proposal.quote, {
      context: proposal.context,
    });
    if (!quote.ok) {
      drop(QUOTE_DROP[quote.reason], quote.detail);
      continue;
    }

    const raw = proposal.rule ?? {};
    if (!raw.kind || !(RULE_KINDS as readonly string[]).includes(raw.kind)) {
      // Without a known kind, `validateRule`'s switch matches nothing and would
      // pass the rule through having checked only its id and description.
      drop('unknown_kind', `"${String(raw.kind)}" is not a rule kind.`);
      continue;
    }
    if (raw.severity !== 'error' && raw.severity !== 'warning') {
      drop('invalid_severity', `Severity must be error or warning, got "${String(raw.severity)}".`);
      continue;
    }

    const unknownFields = referencedFields(raw).filter((f) => !known.has(f));
    if (unknownFields.length) {
      drop(
        'unknown_field',
        `No such ad field: ${unknownFields.join(', ')}. A rule against a field that does not exist never fires.`,
      );
      continue;
    }

    const unknownTypes = (raw.offerTypes ?? []).filter((t) => !offerTypes.has(t));
    if (unknownTypes.length) {
      drop('unknown_offer_type', `No such offer type: ${unknownTypes.join(', ')}.`);
      continue;
    }

    // ── every term of a list must be findable on the quoted page ──
    //
    // Checked against the PAGE, not against the quote. Requiring each term to appear
    // inside the quote was the first design and it cost two real lists — 36 of
    // Subaru's prohibited terms — because it pushed the model into composing a long
    // quote out of the list itself, which then failed verification as a span that
    // does not exist. The introducing sentence is the evidence that these are
    // forbidden; the terms are evidenced by being on the page.
    //
    // Absent terms are TRIMMED rather than discarding the rule. Losing a
    // twenty-nine-term list because one term was mistyped is a bad trade, and the
    // trims are reported so nobody has to guess what happened.
    const listTerms = (raw.phrases ?? []).map((x) => String(x).trim()).filter(Boolean);
    let trimmedTerms: string[] = [];
    if (listTerms.length > 0) {
      const pageText = (pages[quote.at.page - 1] ?? '').toLowerCase();
      const onPage = (term: string) => {
        const needed = words(term);
        return needed.length > 0 && needed.every((w) => pageText.includes(w));
      };
      const kept = listTerms.filter(onPage);
      trimmedTerms = listTerms.filter((x) => !kept.includes(x));
      if (kept.length === 0) {
        drop(
          'evidence_mismatch',
          `None of the ${listTerms.length} term(s) appear on page ${quote.at.page}.`,
        );
        continue;
      }
      raw.phrases = kept;
    }

    // ── the evidence must be about THIS rule ──
    //
    // Only meaningful for a list entry, and essential there. Working down a list of
    // forty prohibited terms, the hazard is a rule that bans one term while quoting
    // a different one — structurally perfect, and wrong in a way review would have
    // to catch by eye, forty times.
    if (quote.at.matchType === 'list_item' && raw.phrase?.trim()) {
      if (!evidenceSupportsPhrase(proposal.quote, raw.phrase)) {
        drop(
          'evidence_mismatch',
          `The rule is about "${raw.phrase.trim()}" but the quoted list entry is "${proposal.quote.trim()}".`,
        );
        continue;
      }
    }

    const id = raw.id?.trim() || suggestRuleId(opts.make, raw.description ?? '', taken);
    const rule: DraftRule = {
      ...raw,
      id,
      kind: raw.kind as RuleKind,
      severity: raw.severity,
      description: (raw.description ?? '').trim(),
      // Built from the verified page, not from the drafter.
      citation: buildCitation(opts.source, proposal.section, quote.at.page),
    };

    const errs = validateRule(rule);
    if (errs.length) {
      drop('invalid_rule', errs.join(' '));
      continue;
    }

    taken.push(id);
    accepted.push({
      rule,
      origin: 'ai',
      source: { ...quote.at, quote: proposal.quote, section: proposal.section },
      rationale: proposal.rationale,
      ...(trimmedTerms.length ? { trimmedTerms } : {}),
    });
  }

  const notes: AcceptedNote[] = [];
  const droppedNotes: ScreenResult['droppedNotes'] = [];
  for (const note of unexpressible) {
    const quote = verifyQuoteIn(corpus, note.page, note.quote);
    if (!quote.ok) {
      droppedNotes.push({ reason: QUOTE_DROP[quote.reason], detail: quote.detail, proposal: note });
      continue;
    }
    notes.push({ ...note, at: quote.at });
  }

  // ── fields a person must fill in ──
  //
  // Same evidence gate as a rule: the quote must be real, the field must exist, and
  // the offer types must be ones we have. The vocabulary is NARROWER than a rule's —
  // `fillableFieldKeys` excludes account branding and the synthetic offer values,
  // because requiring a logo as a per-ad field would block every ad on a value no
  // form collects.
  const fillable = fillableFieldKeys();
  const requiredFields: AcceptedRequiredField[] = [];
  const droppedRequiredFields: ScreenResult['droppedRequiredFields'] = [];
  const seenFieldScope = new Set<string>();

  for (const proposal of requiredFieldProposals) {
    const dropRf = (reason: DropReason, detail: string) =>
      droppedRequiredFields.push({ reason, detail, proposal });

    const q = verifyQuoteIn(corpus, proposal.page, proposal.quote, { context: proposal.context });
    if (!q.ok) {
      dropRf(QUOTE_DROP[q.reason], q.detail);
      continue;
    }

    const field = (proposal.field ?? '').trim();
    if (!field) {
      dropRf('unknown_field_for_person', 'No field was named.');
      continue;
    }
    if (!fillable.has(field)) {
      // "Not a field at all" and "a field nobody fills" are different mistakes. The
      // second means the model reached for the wrong mechanism, and the requirement
      // probably belongs in a required_element rule — so say so.
      dropRf(
        'unknown_field_for_person',
        known.has(field)
          ? `"${field}" is a real field but not one a person fills in — it is account branding or a value the offer engine computes. A requirement about it belongs in a required_element rule.`
          : `"${field}" is not a field on an ad.`,
      );
      continue;
    }

    const types = (proposal.offerTypes ?? []).map((x) => x.trim()).filter(Boolean);
    const badType = types.find((x) => !offerTypes.has(x));
    if (badType) {
      dropRf('unknown_offer_type', `"${badType}" is not an offer type.`);
      continue;
    }

    // ONE DECISION PER FIELD.
    //
    // Keyed on the field alone, not on field + scope. A document states the same
    // requirement in several places — the summary page and the category section — and
    // a first run produced `vin` twice and `discountAmount` twice with overlapping
    // scopes. Three entries for one requirement is three decisions about one thing,
    // and the reviewer has no way to tell they are the same.
    //
    // The FIRST entry wins, because the model is asked to list a field once with all
    // its offer types; a second is a restatement, and keeping the first keeps its
    // quote matched to its scope rather than widening a scope past its evidence.
    if (seenFieldScope.has(field)) {
      dropRf(
        'duplicate_requirement',
        `"${field}" was already proposed${types.length ? ` (this one for ${types.join(', ')})` : ''}.`,
      );
      continue;
    }
    seenFieldScope.add(field);

    requiredFields.push({
      field,
      offerTypes: types,
      reason: (proposal.reason ?? '').trim() || `${field} must be stated.`,
      source: { ...q.at, quote: proposal.quote.trim(), section: proposal.section?.trim() },
    });
  }

  return { accepted, dropped, requiredFields, droppedRequiredFields, notes, droppedNotes };
}

/** One-line-per-reason tally, for a run summary. */
export function summarizeDrops(dropped: DroppedRule[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of dropped) out[d.reason] = (out[d.reason] ?? 0) + 1;
  return out;
}
