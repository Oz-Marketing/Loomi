import type { AdData } from './types';
import type { TemplateDoc } from './doc-types';
import { enrichOfferFields } from './offer-text';
import { missingRequired, type OemOfferRule, FIELD_LABELS } from './compliance';
import { SYSTEM_FIELD_DEFAULTS } from './system-fields';
import { evaluateCoopRules, type CoopRulePack } from './coop-rules';

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
  | 'coop_violation';

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
 * rather than a real value. Derived from `SYSTEM_FIELD_DEFAULTS` so adding a new
 * placeholder default automatically extends the guard.
 *
 * Scoping the check to these keys (instead of every field) is deliberate: a value
 * like "Model X" or "Trail X" is legitimate free text, and a blanket
 * "contains X, no digits" rule would reject real vehicle names.
 */
export const PLACEHOLDER_GUARDED_KEYS: string[] = Object.entries(SYSTEM_FIELD_DEFAULTS)
  .filter(([, v]) => looksLikePlaceholder(v))
  .map(([k]) => k);

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

/** Strip a dual-offer slot prefix so `o2_monthlyPayment` maps to its base key. */
function baseKey(key: string): string {
  return key.replace(/^o2_/, '');
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
  for (const el of doc.elements) {
    if (el.visibleWhen && !el.visibleWhen.in.includes(data[el.visibleWhen.field] ?? '')) continue;
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
  /** Sizes about to be rendered. Defaults to every size the doc defines. */
  sizeIds?: string[];
}

/**
 * Run every preflight check. Errors block the render; warnings are logged so a
 * reviewer can see them without the ad being skipped.
 */
export function preflight({ doc, data, oemRule, coopPack, sizeIds }: PreflightInput): PreflightResult {
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
      message: `${label} is required for a ${data.offerType || 'custom'} offer${
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
    if (!visible.has(el.id) || el.binding?.kind !== 'field') continue;
    const key = el.binding.key;
    if (placeholderSeen.has(key)) continue;
    // Only numeric-ish fields are eligible: the guarded system fields, plus the
    // derived `_offer*` display values they feed. Free text is exempt, because
    // "Tesla Model X" contains an X and no digits yet is perfectly valid.
    const eligible = PLACEHOLDER_GUARDED_KEYS.includes(baseKey(key)) || /^_(o2_)?offer/.test(key);
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

  // ── 3. Empty bindings ──
  const boundFields = new Set<string>();
  const emptyBySizes = new Map<string, Set<string>>();
  for (const el of doc.elements) {
    const elSizes = visible.get(el.id);
    if (!elSizes || el.binding?.kind !== 'field') continue;
    const key = el.binding.key;
    boundFields.add(key);
    if ((enriched[key] ?? '').trim() !== '') continue;
    const acc = emptyBySizes.get(key) ?? new Set<string>();
    elSizes.forEach((s) => acc.add(s));
    emptyBySizes.set(key, acc);
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
        'This design is brand-colour driven but the sub-account has no brand colour set — it will render in Loomi’s default indigo, not the dealer’s colour.',
    });
  }

  // ── 4. Manufacturer co-op advertising rules ──
  // Deliberately last: the earlier checks are about whether the ad is COHERENT,
  // these are about whether it's PERMITTED. Seeing "the payment is a placeholder"
  // above "the disclaimer is too small" reads in the right order for a fix.
  if (coopPack) {
    for (const f of evaluateCoopRules({ doc, data: enriched, pack: coopPack, sizeIds: sizes })) {
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
