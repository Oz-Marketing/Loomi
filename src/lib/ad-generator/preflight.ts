import type { AdData } from './types';
import { OFFER_TYPES } from './offer-text';
import { OFFER_SLOT_RE, elementBoundKeys, offerSlotBaseKey, type TemplateDoc } from './doc-types';
import { enrichOfferFields } from './offer-text';
import { missingRequired, type OemOfferRule, FIELD_LABELS } from './compliance';
import { OFFER_KINDS } from './offer-kinds';
import { evaluateCoopRules, splitCoopPack, type CoopRulePack } from './coop-rules';

/**
 * Preflight — the gate every UNATTENDED render must pass.
 *
 * In the interactive generator a human is the last line of defence: they see the
 * canvas and won't export an ad reading "$XXX/mo". Automation has no such
 * reader, so the checks that were previously eyeballs have to become assertions.
 *
 * Three classes of failure, all of which have shipped from real ad tools:
 *   1. NON-COMPLIANT  — the make's `AdOemOfferRule` requires a field nobody filled.
 *   2. PLACEHOLDER LEAK — a template default like `X,XXX` survived into the render.
 *   3. EMPTY BINDING  — an element is visible but the field behind it is blank,
 *                       so the ad renders with a hole in it.
 *
 * Pure and synchronous: no DB, no network. The caller supplies the OEM rule.
 */

export type PreflightSeverity = 'error' | 'warning';

export type PreflightCode =
  | 'missing_required'
  | 'placeholder_value'
  | 'empty_binding'
  | 'no_sizes'
  /** The design is brand-colour driven but the sub-account has no colour set. */
  | 'unset_brand_color'
  /** A manufacturer co-op advertising rule was violated. */
  | 'coop_violation'
  /** The template's design-time co-op check predates the current design or pack. */
  | 'coop_design_stale';

export interface PreflightIssue {
  code: PreflightCode;
  severity: PreflightSeverity;
  /** The `AdData` key at fault, when the issue is field-level. */
  field?: string;
  /** Human label for the field (offer compliance labels where we have them). */
  label?: string;
  /** Sizes the issue was observed in — empty for data-level issues. */
  sizes?: string[];
  message: string;
  /** co-op only: which rule fired, so a run log can be traced to a pack. */
  ruleId?: string;
  /** co-op only: the source-document reference, so a block can be audited. */
  citation?: string;
  /**
   * `design` marks an issue that belongs to the TEMPLATE rather than to this ad —
   * the replayed design-time co-op verdict. Every ad off the template reports it
   * identically, so a surface showing many ads at once (the proof sheet) can state
   * it once instead of once per ad, and point the reader at the designer rather
   * than at the data.
   */
  scope?: 'design';
}

export interface PreflightResult {
  /** True when nothing at `error` severity was found — safe to render + ship. */
  ok: boolean;
  issues: PreflightIssue[];
  /** Every `field` binding reachable in the checked sizes — for run-log context. */
  boundFields: string[];
}

/**
 * Field keys whose canonical default is an obvious PLACEHOLDER ("X,XXX", "XX.XX")
 * rather than a real value. Derived from EVERY offer kind's defaults, so adding a
 * placeholder default to any kind extends the guard on its own.
 *
 * It used to derive from `SYSTEM_FIELD_DEFAULTS` alone — the vehicle kind's — so
 * a custom offer's `offerPrice: 'XX.XX'` or `minimumSpend: 'XXX'` was outside
 * the check. That is latent rather than live today (no non-vehicle kind is
 * automatable, and preflight is the unattended gate), but the guard existing and
 * silently not covering a kind is exactly the shape of bug this file is for.
 *
 * Purely additive for the vehicle kind: the extra keys don't appear in a vehicle
 * ad's data, so nothing new can fire on one.
 *
 * Scoping the check to these keys (instead of every field) is deliberate: a value
 * like "Model X" or "Trail X" is legitimate free text, and a blanket
 * "contains X, no digits" rule would reject real vehicle names.
 */
export const PLACEHOLDER_GUARDED_KEYS: string[] = Array.from(
  new Set(
    OFFER_KINDS.flatMap((k) =>
      Object.entries(k.defaults)
        .filter(([, v]) => looksLikePlaceholder(v))
        .map(([key]) => key),
    ),
  ),
);

/**
 * A value that is placeholder scaffolding, not data: it carries at least one `X`
 * stand-in and no actual digits ("X,XXX", "XX.XX", "$X,XXX/mo"). A real offer
 * value always contains a digit.
 */
export function looksLikePlaceholder(value: string | undefined): boolean {
  const v = (value ?? '').trim();
  if (!v) return false;
  if (/\d/.test(v)) return false;
  return /x/i.test(v);
}

/** Strip an offer slot prefix so `o2_monthlyPayment` maps to its base key. */
const baseKey = offerSlotBaseKey;

/**
 * Bindings that are EMPTY BY DESIGN, and so must not trip the empty-binding check.
 *
 * `eventLogoUrl` carries the OEM's sales-event mark, which exists only inside an
 * event window. A template needs a permanent slot for it — the generate step
 * refuses to build an ad when a REQUIRED event has nowhere to render — but on any
 * ordinary week the field is legitimately blank. Without this exemption the slot
 * that makes event compliance possible would block every ad outside an event.
 *
 * Keep this list tiny and justified. Every entry weakens a check whose whole
 * purpose is catching holes in unattended output.
 */
export const OPTIONAL_BINDING_KEYS = [
  'eventLogoUrl',
  /**
   * The terms line under an offer headline ("36-month lease · $3,999 due at
   * signing"). `assembleOffer` builds it from whatever the offer supplied, so it's
   * legitimately empty for an APR programme with no stated term, or a discount with
   * no MSRP. Treating that as a hole would block ads whose headline is complete and
   * whose disclaimer carries the detail anyway.
   */
  '_offerTerms',
];

/**
 * Is this binding exempt from the empty-binding check?
 *
 * A list plus a rule, because the offer terms are exempt for EVERY offer slot and
 * the list could only ever name the ones somebody thought of. `_o2_offerTerms` was
 * listed literally, so a third offer's terms would have blocked ads that the first
 * two offers' would not.
 */
export function isOptionalBinding(key: string): boolean {
  return OPTIONAL_BINDING_KEYS.includes(key) || /^_o\d+_offerTerms$/.test(key);
}

/**
 * Bindings that are empty by design only for CERTAIN offer types.
 *
 * `costPerThousand` is the case this exists for, and it blocked every lease ad
 * built from the shared "Vehicle Offer" template. The value is DERIVED from an
 * APR rate + term (`costPerThousand()` in incentive-apply), so an APR offer
 * always has one and a lease/discount/sale never does. An element bound to it
 * with no `visibleWhen` is therefore visible on a lease with nothing to show,
 * and the empty-binding check correctly-but-uselessly failed the ad.
 *
 * Making it unconditionally optional would be the wrong fix: on an APR ad an
 * empty cost-per-$1,000 is a REAL hole and must still block. So the exemption is
 * scoped to the offer types where the field is never computed.
 *
 * Note this does not make the field un-required — when a manufacturer's rule
 * demands it (Kia APR, Mazda lease), `missingRequired` raises a blocking
 * `missing_required` regardless of what this says.
 */
const CONDITIONAL_OPTIONAL_BINDINGS: Record<string, (data: AdData) => boolean> = {
  costPerThousand: (data) => (data.offerType ?? '') !== 'apr',
  /**
   * MSRP is part of the OFFER for a discount ("$4,000 OFF MSRP") and a sale price
   * ("Sale price $31,995. MSRP $34,000") — `assembleOffer` puts it in the terms
   * line for exactly those two, and their default disclaimers interpolate it. A
   * lease or APR offer never references it, so an ungated MSRP element blocked
   * those ads over a number their copy would never have printed.
   */
  msrp: (data) => !['discount', 'sales_price'].includes(data.offerType ?? ''),
};

/** Whether an empty value for `key` is expected rather than a hole. */
function bindingMayBeEmpty(key: string, data: AdData): boolean {
  const base = baseKey(key);
  // The un-prefixed key OR the slot-prefixed one — `_o3_offerTerms` is exempt for
  // the same reason `_offerTerms` is.
  if (isOptionalBinding(base) || isOptionalBinding(key)) return true;
  // Judge a prefixed field by ITS OWN offer's type, whichever slot it belongs to.
  const slot = OFFER_SLOT_RE.exec(key)?.[0];
  const scoped = slot ? { ...data, offerType: data[`${slot}offerType`] } : data;
  return CONDITIONAL_OPTIONAL_BINDINGS[base]?.(scoped) ?? false;
}

/**
 * Element ids visible for `data` in at least one of `sizeIds`, mapped to the
 * sizes they appear in. Honours both per-size `hidden` and the element's
 * `visibleWhen` condition, so an APR-only badge isn't demanded of a lease ad.
 */
function visibleElementSizes(
  doc: TemplateDoc,
  data: AdData,
  sizeIds: string[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  // A field already declares which offer types it applies to. An element bound to
  // one INHERITS that when the designer set no condition of its own — otherwise
  // preflight demands a value the client form wouldn't even ask for. This is the
  // whole class of bug `costPerThousand` was one instance of: bind an element to
  // an offer-type-specific field, forget the Show-for, and every ad of every
  // other offer type fails on an empty binding. A slot's field specs condition on
  // that slot's own `offerType`, so each offer is judged by its own type for free.
  const fieldVisibility = new Map<string, { field: string; in: string[] }>();
  for (const f of doc.fields ?? []) {
    if (f.visibleWhen) fieldVisibility.set(f.key, f.visibleWhen);
  }
  for (const el of doc.elements) {
    const cond =
      el.visibleWhen ??
      (el.binding?.kind === 'field' ? fieldVisibility.get(el.binding.key) : undefined);
    if (cond && !cond.in.includes(data[cond.field] ?? '')) continue;
    const sizes: string[] = [];
    for (const sizeId of sizeIds) {
      const box = doc.layouts?.[sizeId]?.[el.id];
      // No placement in this size = the element simply isn't in it.
      if (!box || box.hidden) continue;
      sizes.push(sizeId);
    }
    if (sizes.length) out.set(el.id, sizes);
  }
  return out;
}

export interface PreflightInput {
  doc: TemplateDoc;
  /**
   * The ad data AS THE RENDERER WILL SEE IT — i.e. already merged over the
   * template defaults via `mergeRenderData`. Passing the raw patch instead
   * defeats the placeholder check: a field absent from the patch is not absent
   * at render time, it falls back to the default, and for the offer numbers
   * those defaults ARE the placeholders we're looking for.
   *
   * Offer enrichment (`_offerMain`, …) is applied internally, so don't pre-enrich.
   */
  data: AdData;
  /** The make's OEM rule, if any. Omit for non-automotive / unruled makes. */
  oemRule?: OemOfferRule | null;
  /**
   * The make's co-op advertising rule pack, if one has been authored. Omit and no
   * co-op checks run — which is the honest default, since a pack that hasn't been
   * transcribed from the manufacturer's document doesn't exist.
   */
  coopPack?: CoopRulePack | null;
  /**
   * The template's DESIGN-TIME co-op verdict, computed once per template × pack.
   *
   * Geometry rules ("the brandmark must be visible", "the disclaimer must be at
   * least 1.2% of the short edge") describe the layout, so their answer is
   * identical for every ad off this template and re-deriving it per ad answers a
   * settled question. Pass the cached verdict and its findings are replayed here so
   * the gate still holds — but the fault is attributed to the template, which is
   * where someone can actually fix it.
   *
   * Omit and no design checks apply. `stale` marks a verdict whose template or pack
   * has moved since it was computed; that reports as a warning rather than silently
   * trusting a verdict for a design that no longer exists.
   */
  coopDesign?: CoopDesignVerdict | null;
  /** Sizes about to be rendered. Defaults to every size the doc defines. */
  sizeIds?: string[];
}

/** The stored design-time verdict, as preflight consumes it. */
export interface CoopDesignVerdict {
  make: string;
  packVersion: string;
  findings: { ruleId: string; severity: PreflightSeverity; description: string; citation?: string; offerType?: string }[];
  /** True when the template or pack changed after this verdict was computed. */
  stale?: boolean;
}

/**
 * Run every preflight check. Errors block the render; warnings are logged so a
 * reviewer can see them without the ad being skipped.
 */
/** "an APR Financing offer", "a lease offer" — for messages people read. */
function offerTypePhrase(offerType?: string): string {
  const label = OFFER_TYPES.find((t) => t.value === offerType)?.label ?? offerType ?? 'custom';
  return `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label} offer`;
}

export function preflight({ doc, data, oemRule, coopPack, coopDesign, sizeIds }: PreflightInput): PreflightResult {
  const issues: PreflightIssue[] = [];
  const sizes = sizeIds?.length ? sizeIds : doc.sizes.map((s) => s.id);

  if (sizes.length === 0) {
    issues.push({
      code: 'no_sizes',
      severity: 'error',
      message: 'Template defines no sizes to render.',
    });
    return { ok: false, issues, boundFields: [] };
  }

  // The renderer sees enriched data (_offerMain, _offerValue, …), so preflight
  // must too — otherwise every offer-bound element reads as empty.
  const enriched = enrichOfferFields(data);

  // ── 1. OEM compliance ──
  for (const { key, label } of missingRequired(data, oemRule)) {
    issues.push({
      code: 'missing_required',
      severity: 'error',
      field: key,
      label,
      // These now read on the creative form, not just in a run log, so the offer
      // type gets its display label ("APR Financing", not "apr") and the article
      // agrees with it — "a apr offer" was fine in a log and is not on screen.
      message: `${label} is required for ${offerTypePhrase(data.offerType)}${
        oemRule?.make ? ` on ${oemRule.make}` : ''
      }.`,
    });
  }

  // ── 2. Placeholder leak ──
  // Scoped to values that can actually REACH THE CANVAS, i.e. those bound by an
  // element visible for this data.
  //
  // The blanket alternative — scanning every key in the ad data — is wrong, and
  // wrong in a way that blocks almost everything: a template whose defaults carry
  // the canonical scaffolding leaves `aprRate: "X.X"`, `salePrice: "XX,XXX"` and
  // friends sitting in the data of a LEASE ad, where nothing displays them. Those
  // are inert, and failing on them would refuse every ad from every template
  // using the standard defaults.
  const visible = visibleElementSizes(doc, enriched, sizes);
  const placeholderSeen = new Set<string>();
  for (const el of doc.elements) {
    if (!visible.has(el.id)) continue;
    // `elementBoundKeys`, not `el.binding` — an offer PLATE has no binding and was
    // therefore invisible here, so its figure could render the template
    // placeholder and pass clean.
    for (const key of elementBoundKeys(el)) {
    if (placeholderSeen.has(key)) continue;
    // Only numeric-ish fields are eligible: the guarded system fields, plus the
    // derived `_offer*` display values they feed. Free text is exempt, because
    // "Tesla Model X" contains an X and no digits yet is perfectly valid.
    const eligible = PLACEHOLDER_GUARDED_KEYS.includes(baseKey(key)) || /^_(?:o\d+_)?offer/.test(key);
    if (!eligible) continue;
    const value = enriched[key];
    if (!looksLikePlaceholder(value)) continue;
    placeholderSeen.add(key);
    const label = FIELD_LABELS[baseKey(key)] ?? key;
    issues.push({
      code: 'placeholder_value',
      severity: 'error',
      field: key,
      label,
      sizes: visible.get(el.id),
      message: `${label} would render the template placeholder "${value}".`,
    });
    }
  }

  // ── 3. Empty bindings ──
  const boundFields = new Set<string>();
  const emptyBySizes = new Map<string, Set<string>>();
  for (const el of doc.elements) {
    const elSizes = visible.get(el.id);
    if (!elSizes) continue;
    for (const key of elementBoundKeys(el)) {
      boundFields.add(key);
      if (bindingMayBeEmpty(key, enriched)) continue;
      if ((enriched[key] ?? '').trim() !== '') continue;
      const acc = emptyBySizes.get(key) ?? new Set<string>();
      elSizes.forEach((s) => acc.add(s));
      emptyBySizes.set(key, acc);
    }
  }
  for (const [key, sizeSet] of emptyBySizes) {
    // Don't double-report a field the compliance check already flagged.
    if (issues.some((i) => i.code === 'missing_required' && i.field === key)) continue;
    issues.push({
      code: 'empty_binding',
      severity: 'error',
      field: key,
      label: FIELD_LABELS[baseKey(key)] ?? key,
      sizes: [...sizeSet],
      message: `Nothing to render for "${key}" — the element is visible but the value is empty.`,
    });
  }

  // ── 3b. Unset brand colour ──
  // The renderer resolves `'brand'` from `data.brandColor` and silently falls
  // back to Loomi's own indigo when it's empty. A hand-built ad gets looked at,
  // so a designer notices; an unattended one does not, and the sub-account ships
  // a whole month of ads in the wrong colour. Warning rather than error: it must
  // be visible, but it shouldn't block an account whose branding isn't set up yet.
  const usesBrandColor = doc.elements.some(
    (el) =>
      (visible.has(el.id) || el.type === 'background') &&
      (el.color === 'brand' ||
        el.fill === 'brand' ||
        el.bg === 'brand' ||
        el.gradientFill?.stops?.some((s) => s.color === 'brand')),
  );
  if (usesBrandColor && !(enriched.brandColor ?? '').trim()) {
    issues.push({
      code: 'unset_brand_color',
      severity: 'warning',
      field: 'brandColor',
      label: 'Brand colour',
      message:
        'This design is brand-colour driven but the account has no brand colour set — it will render in Loomi’s default indigo, not the dealer’s colour.',
    });
  }

  // ── 4. Manufacturer co-op advertising rules ──
  // Deliberately last: the earlier checks are about whether the ad is COHERENT,
  // these are about whether it's PERMITTED. Seeing "the payment is a placeholder"
  // above "the disclaimer is too small" reads in the right order for a fix.
  //
  // Only CONTENT rules run here. The text they inspect genuinely varies per ad —
  // the disclaimer is resolved from the manufacturer's own verbatim wording per
  // offer, so a banned phrase really can appear in one ad and not the next. Geometry
  // rules are settled at design time and arrive via `coopDesign` below.
  if (coopPack) {
    const { content } = splitCoopPack(coopPack);
    for (const f of evaluateCoopRules({ doc, data: enriched, pack: content, sizeIds: sizes })) {
      issues.push({
        code: 'coop_violation',
        severity: f.severity,
        field: f.field,
        label: f.field ? (FIELD_LABELS[baseKey(f.field)] ?? f.field) : undefined,
        sizes: f.sizes,
        ruleId: f.ruleId,
        citation: f.citation,
        message: `${coopPack.make} co-op: ${f.description} (${f.observed})`,
      });
    }
  }

  // ── 4b. Design-time co-op verdict ──
  // Replayed, not recomputed. The message names the TEMPLATE because that's what
  // has to change — a designer fixes this once and every future ad clears.
  if (coopDesign) {
    if (coopDesign.stale) {
      issues.push({
        code: 'coop_design_stale',
        severity: 'warning',
        scope: 'design',
        message:
          `${coopDesign.make} co-op: this template's layout check is out of date ` +
          `(design or rules changed since it was last run). Re-check it from the OEM guidelines page.`,
      });
    }
    for (const f of coopDesign.findings) {
      issues.push({
        code: 'coop_violation',
        severity: f.severity,
        scope: 'design',
        ruleId: f.ruleId,
        citation: f.citation,
        message:
          `${coopDesign.make} co-op: the TEMPLATE fails "${f.description}"` +
          `${f.offerType && f.offerType !== 'any' ? ` for ${f.offerType} offers` : ''}. Fix the design, not this ad.`,
      });
    }
  }

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    boundFields: [...boundFields].sort(),
  };
}

/** One-line summary of why a creative was skipped, for run logs + notifications. */
export function summarizePreflight(result: PreflightResult): string {
  const errors = result.issues.filter((i) => i.severity === 'error');
  if (errors.length === 0) return 'passed';
  return errors.map((e) => e.message).join(' ');
}
