import { assembleOffer } from '../offer-text';
import { evaluateCoopRules, splitCoopPack, type CoopRulePack } from '../coop-rules';
import { GOOGLE_LIMITS, META_LIMITS, type AdCopyVariation } from '../copy-types';
import type { TemplateDoc } from '../doc-types';
import type { AdData } from '../types';

/**
 * Ad copy for an autonomously generated ad.
 *
 * Generation renders pixels and stops, so an auto-generated ad has no words —
 * and both platforms require text (Meta: primary text + headline; Google Demand
 * Gen: 3+ headlines, 2+ descriptions). This closes that gap.
 *
 * THE POSTURE PROBLEM, AND THE ANSWER. The pipeline's rule until now was that
 * nothing running unattended uses AI: every overnight decision is made by fixed
 * rules, and AI is confined to places where a person is reading the output. Copy
 * is the first thing that genuinely wants prose, and with no per-ad approver
 * (co-op pre-approves the TEMPLATE and ads inherit it) there is no reviewer to
 * catch a hallucinated payment before it reaches Meta.
 *
 * So AI may DRAFT, and fixed rules decide whether the draft is usable:
 *
 *   1. Every number in the copy must appear in the offer data. This is the one
 *      that matters — an invented "$199/mo" is a false advertisement, and it is
 *      also exactly the mistake a language model makes most naturally.
 *   2. The make's co-op content rules run over the copy, so a banned absolute
 *      claim is caught by the same engine that governs the creative.
 *   3. Platform character limits are hard, not advisory.
 *
 * A draft that fails any of these is discarded and a DETERMINISTIC caption built
 * from the offer data is used instead. So the ad always has words, the words are
 * always defensible, and the outcome never depends on the model behaving.
 *
 * Copy is generated ONCE and frozen on the creative. Safe because an offer whose
 * numbers move gets a different fingerprint and therefore a different row (see
 * fingerprint.ts) — so a row's copy can never outlive the offer it describes.
 */

export interface CopyOutcome {
  copy: AdCopyVariation;
  /** Which path produced it — recorded so a reviewer can tell at a glance. */
  source: 'ai' | 'deterministic';
  /** Why the AI draft was rejected, when it was. Surfaced as review notes. */
  warnings: string[];
}

// ── text helpers ─────────────────────────────────────────────────────────────

/** Trim to `max` on a word boundary; never mid-word, never with an ellipsis that
 *  would itself breach the limit. */
export function fit(text: string, max: number): string {
  const s = text.trim().replace(/\s+/g, ' ');
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Every run of digits in a string, as strings ("2,999" → "2999"). */
function digitRuns(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ''));
}

// ── the deterministic caption ────────────────────────────────────────────────

/**
 * Captions assembled from the offer itself — no model involved.
 *
 * This is the floor, not a degraded mode: it says the true thing plainly, in the
 * same words `assembleOffer` already puts on the creative, so an ad that falls
 * back here is still fully launchable.
 */
export function deterministicCopy(params: {
  data: AdData;
  dealerName: string;
  vehicle: { year: number; make: string; model: string };
}): AdCopyVariation {
  const { data, dealerName, vehicle } = params;
  const offer = assembleOffer(data);
  const name = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  // The PROSE form: a caption has no label element beside the figure, so an APR
  // reads "4.9% APR" here where the creative shows "4.9%".
  const main = offer?.prose ?? '';
  const terms = offer?.terms ?? '';
  const dealer = dealerName.trim();

  const primary = [
    main ? `${name} — ${main}.` : `${name}.`,
    terms ? `${terms}.` : '',
    dealer ? `Now at ${dealer}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    // No template copy fields are written by the fallback: the creative's own
    // fields were filled deterministically from the offer at generation, and
    // overwriting them here would change the rendered image after the fact.
    fields: {},
    meta: {
      primaryText: fit(primary, META_LIMITS.primaryText),
      // The offer leads, because the number is the reason anyone stops.
      headline: fit(main ? `${main} — ${vehicle.model}` : name, META_LIMITS.headline),
      description: fit(offer?.label ?? dealer ?? '', META_LIMITS.description),
    },
    google: {
      headlines: [
        fit(main || name, GOOGLE_LIMITS.headline),
        fit(`${vehicle.year} ${vehicle.model}`, GOOGLE_LIMITS.headline),
        fit(dealer || `${vehicle.make} offers`, GOOGLE_LIMITS.headline),
      ].filter(Boolean),
      descriptions: [
        fit(terms || primary, GOOGLE_LIMITS.description),
        fit(
          dealer ? `See this offer at ${dealer}. Limited availability.` : 'Limited availability.',
          GOOGLE_LIMITS.description,
        ),
      ].filter(Boolean),
    },
  };
}

// ── validation ───────────────────────────────────────────────────────────────

export interface CopyProblem {
  /** Where the problem is, for the review note. */
  where: string;
  reason: string;
}

/** Every string a variation would publish, labelled. */
function copyStrings(v: AdCopyVariation): { where: string; text: string }[] {
  return [
    { where: 'meta.primaryText', text: v.meta.primaryText },
    { where: 'meta.headline', text: v.meta.headline },
    { where: 'meta.description', text: v.meta.description },
    ...v.google.headlines.map((h, i) => ({ where: `google.headline[${i}]`, text: h })),
    ...v.google.descriptions.map((d, i) => ({ where: `google.description[${i}]`, text: d })),
    ...Object.entries(v.fields).map(([k, text]) => ({ where: `fields.${k}`, text })),
  ].filter((s) => typeof s.text === 'string');
}

/**
 * Is this draft publishable?
 *
 * Deliberately strict about numbers and lenient about nothing else that matters.
 * A rejection costs a slightly duller caption; a false accept costs a false
 * advertisement, which for a financing offer is a regulatory problem and not
 * merely an embarrassment.
 */
export function validateCopy(params: {
  variation: AdCopyVariation;
  /** The ad's data — the ONLY legitimate source of numbers in the copy. */
  data: AdData;
  doc: TemplateDoc;
  coopPack?: CoopRulePack | null;
}): CopyProblem[] {
  const { variation, data, doc, coopPack } = params;
  const problems: CopyProblem[] = [];

  // ── 1. character limits ──
  const limited: { where: string; text: string; max: number }[] = [
    { where: 'meta.primaryText', text: variation.meta.primaryText, max: META_LIMITS.primaryText },
    { where: 'meta.headline', text: variation.meta.headline, max: META_LIMITS.headline },
    { where: 'meta.description', text: variation.meta.description, max: META_LIMITS.description },
    ...variation.google.headlines.map((h, i) => ({
      where: `google.headline[${i}]`,
      text: h,
      max: GOOGLE_LIMITS.headline,
    })),
    ...variation.google.descriptions.map((d, i) => ({
      where: `google.description[${i}]`,
      text: d,
      max: GOOGLE_LIMITS.description,
    })),
  ];
  for (const { where, text, max } of limited) {
    if ((text ?? '').length > max) {
      problems.push({ where, reason: `${text.length} characters, limit is ${max}` });
    }
  }
  // Platform minimums — Google refuses an ad group ad without enough assets.
  if (variation.google.headlines.filter(Boolean).length < GOOGLE_LIMITS.headlineCount) {
    problems.push({
      where: 'google.headlines',
      reason: `needs ${GOOGLE_LIMITS.headlineCount}, got ${variation.google.headlines.filter(Boolean).length}`,
    });
  }
  if (variation.google.descriptions.filter(Boolean).length < GOOGLE_LIMITS.descriptionCount) {
    problems.push({
      where: 'google.descriptions',
      reason: `needs ${GOOGLE_LIMITS.descriptionCount}, got ${variation.google.descriptions.filter(Boolean).length}`,
    });
  }
  if (!variation.meta.primaryText.trim() || !variation.meta.headline.trim()) {
    problems.push({ where: 'meta', reason: 'primary text and headline are both required' });
  }

  // ── 2. numeric provenance ──
  //
  // Allowed numbers are those the offer actually contains. Single digits are
  // exempt: they carry no pricing meaning on their own ("a 2-year lease" reads
  // from `leaseTerm` anyway) and treating them as claims would reject almost
  // every sentence.
  const allowed = new Set<string>();
  for (const value of Object.values(data)) {
    if (typeof value !== 'string') continue;
    for (const n of digitRuns(value)) {
      allowed.add(n);
      // A price cited without cents ("$2,999" for "2999.00") is the same claim.
      if (n.includes('.')) allowed.add(n.split('.')[0]);
    }
  }
  for (const { where, text } of copyStrings(variation)) {
    for (const n of digitRuns(text)) {
      if (n.length < 2) continue;
      if (allowed.has(n)) continue;
      problems.push({
        where,
        reason: `cites "${n}", which is not in the offer data — a number the offer doesn't contain cannot be advertised`,
      });
    }
  }

  // ── 3. the make's co-op content rules ──
  //
  // Run over a data map carrying the copy, so an unscoped `banned_phrase` rule
  // (which scans every string field) inspects the captions exactly as it inspects
  // the disclaimer. Design-scoped rules are excluded — they are about the
  // template's layout and were already evaluated against it.
  if (coopPack) {
    const { content } = splitCoopPack(coopPack);
    if (content.rules.length) {
      const copyData: AdData = { ...data };
      for (const { where, text } of copyStrings(variation)) copyData[`copy_${where}`] = text;
      const findings = evaluateCoopRules({ doc, data: copyData, pack: content });
      for (const f of findings) {
        // Only findings ON the copy — a pre-existing problem with the ad's own
        // data is preflight's business, and failing the copy for it would
        // silently disable AI copy for that whole account.
        if (!f.field?.startsWith('copy_')) continue;
        if (f.severity !== 'error') continue;
        problems.push({
          where: f.field.replace(/^copy_/, ''),
          reason: `${content.make} co-op: ${f.description}${f.citation ? ` (${f.citation})` : ''}`,
        });
      }
    }
  }

  return problems;
}

// ── the orchestrator ─────────────────────────────────────────────────────────

/**
 * Copy for one generated ad: an AI draft if one survives validation, the
 * deterministic caption otherwise.
 *
 * Never throws and never returns null. Copy is a launch prerequisite, so a
 * failure here must degrade the words, not lose the ad.
 */
export async function copyForCreative(params: {
  doc: TemplateDoc;
  data: AdData;
  dealerName: string;
  vehicle: { year: number; make: string; model: string };
  coopPack?: CoopRulePack | null;
  /** Injected so the unattended path is testable without calling a model. */
  draft?: (req: import('../copy-types').AdCopyRequest) => Promise<import('../copy-types').AdCopyResult>;
}): Promise<CopyOutcome> {
  const { doc, data, dealerName, vehicle, coopPack, draft } = params;
  const fallback = deterministicCopy({ data, dealerName, vehicle });
  const warnings: string[] = [];

  if (!draft) return { copy: fallback, source: 'deterministic', warnings };

  try {
    const result = await draft({
      templateName: doc.name,
      // The template's own copy fields are NOT requested. The creative was
      // already rendered from deterministic offer values, so rewriting them here
      // would make the stored image and the stored data disagree.
      copyFields: [],
      context: data,
      dealerName,
      count: 3,
    });

    // First draft that passes wins. Several are requested because the cheapest
    // fix for a single bad number is another attempt, not a duller caption.
    const rejected: string[] = [];
    for (const variation of result.variations) {
      const problems = validateCopy({ variation, data, doc, coopPack });
      if (problems.length === 0) {
        return { copy: { ...variation, fields: {} }, source: 'ai', warnings };
      }
      rejected.push(problems.map((p) => `${p.where}: ${p.reason}`).join('; '));
    }
    warnings.push(
      `AI copy was rejected for all ${result.variations.length} draft(s) and a plain caption built from the offer was used instead. First rejection — ${rejected[0] ?? 'unknown'}`,
    );
  } catch (err) {
    // A model outage must not stop the night's ads.
    warnings.push(
      `Copy generation failed (${err instanceof Error ? err.message : 'unknown error'}); used a plain caption built from the offer.`,
    );
  }

  return { copy: fallback, source: 'deterministic', warnings };
}
