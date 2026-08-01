import type { AdData } from './types';
import type { TemplateDoc } from './doc-types';
import { SYSTEM_FIELD_DEFAULTS } from './system-fields';
import {
  evaluateCoopRules,
  splitCoopPack,
  type CoopFinding,
  type CoopRulePack,
} from './coop-rules';

/**
 * Design-time co-op checking — does this TEMPLATE satisfy a make's layout rules?
 *
 * The rules that constrain geometry (brandmark present, disclaimer no smaller
 * than X, logo inside the lower third) are properties of the design, not of any
 * particular ad. Checking them once per template beats checking them on every
 * draft for two reasons, and the second matters more than the efficiency:
 *
 *   1. The answer cannot have changed between two ads off the same template.
 *   2. A geometric violation is a DESIGN fault. Reported per ad it surfaces as
 *      "generation produced nothing this morning", which sends the wrong person
 *      to the wrong place. Reported per template it says "this template fails
 *      Chevrolet — here's the rule and the citation".
 *
 * ── WHY REPRESENTATIVE DATA, AND WHY PER OFFER TYPE ──
 *
 * Element visibility is data-dependent: `visibleWhen` hides the APR badge on a
 * lease ad and the `%` sign on a discount. So "is an element bound to `logoUrl`
 * visible" has no single answer for a template — it has one per offer type. A
 * check run against a single synthetic ad would certify a template that quietly
 * fails for lease, which is exactly the class of bug that shipped once already
 * (the shared Vehicle Offer template blocked every lease ad through a field that
 * was only ever visible for APR).
 *
 * So the check runs once per offer type the template can render, and each finding
 * is tagged with the offer type that produced it. A template can then be "fine for
 * APR, fails for lease", which is the truth.
 *
 * Placeholder values are deliberately fine here: geometry doesn't care whether the
 * payment reads "$399" or "$XXX". Content rules are NOT evaluated in this module —
 * they need the real per-ad text. `splitCoopPack` enforces that boundary.
 *
 * Pure: no DB, no network, no clock.
 */

/** Offer types automation can produce. Kept explicit so a new one is a deliberate
 *  edit here rather than silently unchecked. */
export const CHECKED_OFFER_TYPES = ['lease', 'apr', 'discount', 'sales_price'] as const;
export type CheckedOfferType = (typeof CHECKED_OFFER_TYPES)[number];

/** A design finding, plus the offer type it was observed under. */
export interface TemplateCoopFinding extends CoopFinding {
  offerType: string;
}

export interface TemplateCoopVerdict {
  make: string;
  packVersion: string;
  ok: boolean;
  errorCount: number;
  warningCount: number;
  findings: TemplateCoopFinding[];
  /** Offer types actually evaluated — those the template has some way to render. */
  offerTypes: string[];
  /** How many design rules were in force. Zero is a legitimate clean verdict. */
  ruleCount: number;
}

/**
 * Offer types this template can plausibly render.
 *
 * A template that gates elements on `offerType` declares its supported set through
 * those conditions. One that gates on nothing is offer-type agnostic, so a single
 * pass suffices — running four identical passes would just quadruple the findings.
 */
export function supportedOfferTypes(doc: TemplateDoc): string[] {
  const declared = new Set<string>();
  for (const el of doc.elements) {
    if (el.visibleWhen?.field !== 'offerType') continue;
    for (const v of el.visibleWhen.in) if (v) declared.add(v);
  }
  if (declared.size === 0) return ['any'];
  // Intersect with what automation can actually produce, then keep a stable order
  // so a verdict is reproducible rather than Set-insertion dependent.
  return CHECKED_OFFER_TYPES.filter((t) => declared.has(t));
}

/**
 * Synthetic ad data for a design check: every system field at its default, plus
 * the offer type under test and non-empty brand values.
 *
 * Brand fields get real-looking values because a rule like "an element bound to
 * `logoUrl` must be visible" would otherwise fail for want of a logo — which is a
 * sub-account setup problem, not a template one, and belongs to preflight.
 */
export function representativeData(offerType: string): AdData {
  return {
    ...SYSTEM_FIELD_DEFAULTS,
    offerType: offerType === 'any' ? '' : offerType,
    // Present-and-plausible stand-ins for per-account branding.
    logoUrl: 'https://example.invalid/lockup.png',
    dealerName: 'Example Motors',
    brandColor: '#123456',
    vehicleName: 'Model Example',
    vehicleImageUrl: 'https://example.invalid/vehicle.png',
    disclaimer: 'Representative disclaimer for design checking.',
  } as AdData;
}

/**
 * Evaluate a make's DESIGN rules against a template.
 *
 * `verified: false` on the pack still downgrades errors to warnings — that happens
 * inside `evaluateCoopRules`, so an unverified pack reports without blocking here
 * exactly as it does per ad.
 */
export function checkTemplateCoop(doc: TemplateDoc, pack: CoopRulePack): TemplateCoopVerdict {
  const { design } = splitCoopPack(pack);
  const offerTypes = supportedOfferTypes(doc);
  const findings: TemplateCoopFinding[] = [];

  for (const offerType of offerTypes) {
    const data = representativeData(offerType);
    for (const f of evaluateCoopRules({ doc, data, pack: design })) {
      findings.push({ ...f, offerType });
    }
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  return {
    make: pack.make,
    packVersion: pack.version,
    ok: errorCount === 0,
    errorCount,
    warningCount: findings.length - errorCount,
    findings,
    offerTypes,
    ruleCount: design.rules.length,
  };
}

/** One line for a badge or a run log. */
export function summarizeTemplateCoop(v: TemplateCoopVerdict): string {
  if (v.ruleCount === 0) return `${v.make} ${v.packVersion}: no layout rules to check.`;
  if (v.ok && v.warningCount === 0) return `${v.make} ${v.packVersion}: passes ${v.ruleCount} layout rule(s).`;
  const parts: string[] = [];
  if (v.errorCount) parts.push(`${v.errorCount} blocking`);
  if (v.warningCount) parts.push(`${v.warningCount} warning(s)`);
  // Naming the offer types keeps a partial failure from reading as a total one.
  const failedTypes = [...new Set(v.findings.filter((f) => f.severity === 'error').map((f) => f.offerType))];
  const scope = failedTypes.length && failedTypes.length < v.offerTypes.length ? ` (only ${failedTypes.join(', ')})` : '';
  return `${v.make} ${v.packVersion}: ${parts.join(', ')}${scope}.`;
}

/**
 * The parts of a template a co-op rule can actually read, in a stable shape ready
 * to hash: element identity/binding/visibility and per-size placement. Styling no
 * rule inspects is included too — cheap, and a false "stale" costs one re-check
 * whereas a false "current" ships an unchecked design.
 *
 * Returns the canonical STRING rather than a digest so this module stays free of
 * `node:crypto`; the hashing itself lives in the server-only store.
 */
export function templateDocShape(doc: TemplateDoc): string {
  const shape = {
    sizes: doc.sizes.map((s) => [s.id, s.width, s.height]),
    elements: doc.elements
      .map((el) => ({
        id: el.id,
        type: el.type,
        binding: el.binding ?? null,
        visibleWhen: el.visibleWhen ?? null,
        color: el.color ?? null,
        fill: el.fill ?? null,
      }))
      // Element order is a z-index, but no rule reads it; sorting makes a reorder
      // not read as a change.
      .sort((a, b) => a.id.localeCompare(b.id)),
    layouts: Object.fromEntries(
      Object.entries(doc.layouts ?? {})
        .map(([sizeId, boxes]) => [
          sizeId,
          Object.fromEntries(Object.entries(boxes ?? {}).sort(([a], [b]) => a.localeCompare(b))),
        ])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ),
  };
  return JSON.stringify(shape);
}
