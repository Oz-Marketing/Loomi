import type { CoopRule, CoopRulePack, CoopSeverity, LimitTerm } from './coop-rules';

/**
 * Authoring co-op rules — the schema behind the editor, and the validation that
 * has to hold whoever is writing.
 *
 * Until now a rule pack could only be created by a developer writing a seed
 * script. That put the one job the Co-op team is actually qualified for — reading
 * a manufacturer's guidelines and saying what they require — behind a deploy.
 * Three brands got packs in a year, which is the real reason 21 of 24 makes have
 * no automated checks.
 *
 * WHAT THIS DOES NOT DO. It does not read the PDF and propose rules. That was
 * considered and rejected: a wrong rule silently costs a brand a month of ads,
 * and a plausible-sounding threshold is worse than an absent one because nobody
 * goes looking for it. A person reads the document, types the rule, and cites the
 * section. The machine's job is to make that fast and to refuse anything it
 * cannot check.
 *
 * Pure: no DB, no network, no clock.
 */

export const RULE_KINDS = [
  'required_phrase',
  'banned_phrase',
  'required_element',
  'min_font_size',
  'element_zone',
  'min_element_size',
  'numeric_limit',
] as const;

export type RuleKind = (typeof RULE_KINDS)[number];

export interface RuleKindMeta {
  kind: RuleKind;
  label: string;
  /** One line, written for whoever is transcribing rather than for a developer. */
  blurb: string;
  /** design = settled by the template; content = varies per ad. */
  scope: 'design' | 'content';
}

export const RULE_KIND_META: RuleKindMeta[] = [
  {
    kind: 'required_phrase',
    label: 'Must say',
    blurb: 'A field has to contain particular wording — a credit qualification, a safety line.',
    scope: 'content',
  },
  {
    kind: 'banned_phrase',
    label: 'Must not say',
    blurb:
      'Wording the manufacturer forbids anywhere in the ad. One rule can carry a whole prohibited-terms list.',
    scope: 'content',
  },
  {
    kind: 'numeric_limit',
    label: 'Price or amount limit',
    blurb: 'A floor or ceiling on an advertised figure — a pricing floor, a down-payment cap.',
    scope: 'content',
  },
  {
    kind: 'required_element',
    label: 'Must show',
    blurb: 'Something has to appear on the ad — the brandmark, the disclaimer.',
    scope: 'design',
  },
  {
    kind: 'min_font_size',
    label: 'Minimum text size',
    blurb: 'Text that may not be smaller than a set size.',
    scope: 'design',
  },
  {
    kind: 'element_zone',
    label: 'Must sit within an area',
    blurb: 'Something has to stay inside a region of the ad — a logo in the lower third.',
    scope: 'design',
  },
  {
    kind: 'min_element_size',
    label: 'Minimum element size',
    blurb: 'Something has to occupy at least a share of the ad.',
    scope: 'design',
  },
];

/** A rule as the editor holds it — every kind's fields on one loose object. */
export interface DraftRule {
  /** A prohibited-terms list — several forbidden terms under one rule. */
  phrases?: string[];
  id: string;
  kind: RuleKind;
  severity: CoopSeverity;
  description: string;
  citation: string;
  offerTypes?: string[];
  /** required_phrase / required_element / min_* / element_zone / numeric_limit */
  field?: string;
  /** banned_phrase only — empty means "every text field". */
  fields?: string[];
  phrase?: string;
  pattern?: string;
  minPx?: number;
  minShortEdgeFraction?: number;
  zone?: { x0: number; y0: number; x1: number; y1: number };
  minWidthFraction?: number;
  minHeightFraction?: number;
  bound?: 'min' | 'max';
  limits?: LimitTerm[][];
  select?: 'lowest' | 'highest';
  unit?: 'currency' | 'number';
}

/** A stable, readable rule id from the make and description. */
export function suggestRuleId(make: string, description: string, taken: string[] = []): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
  const base = [slug(make), slug(description)].filter(Boolean).join('-') || 'rule';
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 200; n += 1) {
    const next = `${base}-${n}`;
    if (!taken.includes(next)) return next;
  }
  return `${base}-${taken.length + 1}`;
}

function isFilled(v: string | undefined | null): boolean {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * Everything wrong with one rule, in plain language.
 *
 * The bar is "could this rule be evaluated, and could a person defend it". A rule
 * that can't be evaluated silently passes every ad, which is the failure mode
 * that makes an unchecked pack more dangerous than no pack.
 */
export function validateRule(rule: DraftRule): string[] {
  const errs: string[] = [];
  if (!isFilled(rule.id)) errs.push('The rule needs an id.');
  if (!isFilled(rule.description)) errs.push('Say what the rule requires, in a sentence.');
  // A citation is not optional. An uncitable rule can't be audited, can't be
  // defended to a dealer it blocks, and can't be found again when the
  // manufacturer reissues the document.
  if (!isFilled(rule.citation)) errs.push('Cite the section it comes from — a rule nobody can look up cannot be defended.');

  switch (rule.kind) {
    case 'required_phrase':
      if (!isFilled(rule.field)) errs.push('Choose which field must contain the wording.');
      if (!isFilled(rule.phrase) && !isFilled(rule.pattern)) {
        errs.push('Give the wording it must contain.');
      }
      break;
    case 'banned_phrase': {
      const terms = (rule.phrases ?? []).filter((x) => isFilled(x));
      if (terms.length === 0 && !isFilled(rule.phrase) && !isFilled(rule.pattern)) {
        errs.push('Give the wording that is not allowed.');
      }
      break;
    }
    case 'required_element':
      if (!isFilled(rule.field)) errs.push('Choose what has to appear.');
      break;
    case 'min_font_size':
      if (!isFilled(rule.field)) errs.push('Choose which text this applies to.');
      if (!(rule.minPx && rule.minPx > 0) && !(rule.minShortEdgeFraction && rule.minShortEdgeFraction > 0)) {
        errs.push('Give a minimum size — either pixels or a share of the ad.');
      }
      break;
    case 'element_zone': {
      if (!isFilled(rule.field)) errs.push('Choose what has to stay inside the area.');
      const z = rule.zone;
      if (!z) {
        errs.push('Give the area it must sit within.');
      } else {
        const nums = [z.x0, z.y0, z.x1, z.y1];
        if (nums.some((n) => typeof n !== 'number' || Number.isNaN(n) || n < 0 || n > 1)) {
          errs.push('The area must be given as fractions of the ad, between 0 and 1.');
        } else if (z.x1 <= z.x0 || z.y1 <= z.y0) {
          // A backwards box matches nothing, so it would read as "always fails".
          errs.push('The area is inside out — the right edge must be past the left, and the bottom past the top.');
        }
      }
      break;
    }
    case 'min_element_size':
      if (!isFilled(rule.field)) errs.push('Choose what the minimum applies to.');
      if (!(rule.minWidthFraction && rule.minWidthFraction > 0) && !(rule.minHeightFraction && rule.minHeightFraction > 0)) {
        errs.push('Give a minimum width or height, as a share of the ad.');
      }
      break;
    case 'numeric_limit': {
      if (!isFilled(rule.field)) errs.push('Choose which figure is being limited.');
      if (rule.bound !== 'min' && rule.bound !== 'max') errs.push('Say whether this is a floor or a ceiling.');
      const limits = rule.limits ?? [];
      const usable = limits.filter((terms) => terms.length > 0);
      if (usable.length === 0) {
        errs.push('Give at least one limit to compare against.');
      } else {
        for (const terms of usable) {
          for (const t of terms) {
            const hasSource = isFilled(t.field) || typeof t.literal === 'number';
            if (!hasSource) errs.push('Every part of a limit needs either a field or a fixed amount.');
            if (isFilled(t.field) && typeof t.literal === 'number') {
              errs.push('A part of a limit can be a field or a fixed amount, not both.');
            }
          }
        }
        // Several candidates with no rule for choosing is ambiguous, and the
        // engine reports it as malformed rather than guessing — so catch it here.
        if (usable.length > 1 && rule.select !== 'lowest' && rule.select !== 'highest') {
          errs.push('With more than one limit, say which one governs — the lower or the higher.');
        }
      }
      break;
    }
  }
  return errs;
}

export interface DraftPack {
  make: string;
  version: string;
  source: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  rules: DraftRule[];
}

/** Everything wrong with the pack as a whole, keyed for display. */
export function validatePack(pack: DraftPack): { pack: string[]; rules: Record<string, string[]> } {
  const packErrs: string[] = [];
  if (!isFilled(pack.make)) packErrs.push('Choose the manufacturer.');
  if (!isFilled(pack.version)) packErrs.push('Give the guideline edition, e.g. "2026-Q3".');
  if (!isFilled(pack.source)) packErrs.push('Name the document these came from.');

  const seen = new Set<string>();
  for (const r of pack.rules) {
    const id = r.id.trim();
    if (id && seen.has(id)) packErrs.push(`Two rules share the id "${id}".`);
    if (id) seen.add(id);
  }

  if (pack.effectiveFrom && pack.effectiveTo && pack.effectiveTo < pack.effectiveFrom) {
    packErrs.push('The end of the effective window is before its start.');
  }

  const rules: Record<string, string[]> = {};
  for (const r of pack.rules) {
    const errs = validateRule(r);
    if (errs.length) rules[r.id || `unnamed-${pack.rules.indexOf(r)}`] = errs;
  }
  return { pack: packErrs, rules };
}

/** True when the pack is safe to store. */
export function packIsValid(v: { pack: string[]; rules: Record<string, string[]> }): boolean {
  return v.pack.length === 0 && Object.keys(v.rules).length === 0;
}

/**
 * A draft rule → the shape the engine evaluates.
 *
 * Only the keys that belong to the rule's kind are carried across. Without that,
 * a rule edited from one kind to another keeps the old kind's fields, and
 * `banned_phrase` inherits a stale `pattern` that quietly changes what it
 * matches.
 */
export function toCoopRule(d: DraftRule): CoopRule {
  const base = {
    id: d.id.trim(),
    severity: d.severity,
    description: d.description.trim(),
    citation: d.citation.trim(),
    ...(d.offerTypes?.length ? { scope: { offerTypes: d.offerTypes } } : {}),
  };
  switch (d.kind) {
    case 'required_phrase':
      return {
        ...base,
        kind: 'required_phrase',
        field: d.field!.trim(),
        ...(isFilled(d.pattern) ? { pattern: d.pattern!.trim() } : { phrase: d.phrase!.trim() }),
      };
    case 'banned_phrase': {
      const terms = (d.phrases ?? []).map((x) => x.trim()).filter(Boolean);
      return {
        ...base,
        kind: 'banned_phrase',
        ...(d.fields?.length ? { fields: d.fields } : {}),
        // A list wins where present: it is word-boundary matched, where a single
        // `phrase` is a plain substring. Falling back the other way would silently
        // widen a fifty-term list into fifty substring matches.
        ...(terms.length
          ? { phrases: terms }
          : isFilled(d.pattern)
            ? { pattern: d.pattern!.trim() }
            : { phrase: d.phrase!.trim() }),
      };
    }
    case 'required_element':
      return { ...base, kind: 'required_element', field: d.field!.trim() };
    case 'min_font_size':
      return {
        ...base,
        kind: 'min_font_size',
        field: d.field!.trim(),
        ...(d.minPx ? { minPx: d.minPx } : {}),
        ...(d.minShortEdgeFraction ? { minShortEdgeFraction: d.minShortEdgeFraction } : {}),
      };
    case 'element_zone':
      return { ...base, kind: 'element_zone', field: d.field!.trim(), zone: d.zone! };
    case 'min_element_size':
      return {
        ...base,
        kind: 'min_element_size',
        field: d.field!.trim(),
        ...(d.minWidthFraction ? { minWidthFraction: d.minWidthFraction } : {}),
        ...(d.minHeightFraction ? { minHeightFraction: d.minHeightFraction } : {}),
      };
    case 'numeric_limit': {
      const limits = (d.limits ?? []).filter((t) => t.length > 0);
      return {
        ...base,
        kind: 'numeric_limit',
        field: d.field!.trim(),
        bound: d.bound ?? 'min',
        limits,
        ...(limits.length > 1 ? { select: d.select ?? 'lowest' } : {}),
        ...(d.unit === 'number' ? { unit: 'number' as const } : {}),
      };
    }
  }
}

/** A stored pack → the editor's draft shape, so an existing pack can be edited. */
export function toDraftRule(r: CoopRule): DraftRule {
  const d: DraftRule = {
    id: r.id,
    kind: r.kind,
    severity: r.severity,
    description: r.description,
    citation: r.citation ?? '',
    offerTypes: r.scope?.offerTypes ?? [],
  };
  const any = r as unknown as Record<string, unknown>;
  for (const k of [
    'field',
    'fields',
    'phrase',
    'phrases',
    'pattern',
    'minPx',
    'minShortEdgeFraction',
    'zone',
    'minWidthFraction',
    'minHeightFraction',
    'bound',
    'limits',
    'select',
    'unit',
  ]) {
    if (any[k] !== undefined) (d as unknown as Record<string, unknown>)[k] = any[k];
  }
  return d;
}

/** Assemble the pack JSON exactly as `parseCoopPack` expects to read it back. */
export function toCoopPack(d: DraftPack): CoopRulePack {
  return {
    make: d.make.trim(),
    version: d.version.trim(),
    source: d.source.trim(),
    // Never self-certified. Verification means a human checked the transcription
    // against the document, and that is a separate, deliberate act.
    verified: false,
    rules: d.rules.map(toCoopRule),
  };
}
