import type { MarketCheckIncentive } from '@/lib/integrations/marketcheck';
import type { TemplateDoc } from '../doc-types';
import { offerFingerprint } from './fingerprint';
import type { OfferCandidate } from './select-offer';

/**
 * Fan-out planning — which ads a vehicle's offers should produce.
 *
 * The old model narrowed twice: one offer per vehicle, then one template per
 * offer, yielding exactly one ad. Both narrowings are now RANKINGS. Every live
 * offer is built through every published template in scope, the combination the
 * old rules would have chosen is flagged `recommended`, and the dealer picks.
 *
 * Pure — no prisma, no clock, no network. Everything here is decided from the
 * offers and the template docs, so it is fully testable and so a re-run with the
 * same inputs plans exactly the same variants. That determinism is load-bearing:
 * `AdCreative` is keyed `@@unique([accountKey, templateId, offerFingerprint])`,
 * and a plan that shuffled would mint duplicates instead of updating in place.
 */

/** A template a variant can be built from. */
export interface PlanTemplate {
  id: string;
  name: string;
  doc: TemplateDoc;
}

/** One ad to build: a template plus the offer(s) it will carry. */
export interface PlannedVariant {
  templateId: string;
  templateName: string;
  doc: TemplateDoc;
  /** Slot 1. Always present. */
  primary: MarketCheckIncentive;
  /** Slot 2 (`o2_*`), for a dual template. Null for a single-offer template. */
  secondary: MarketCheckIncentive | null;
  /** True for the one variant the old resolution rules would have produced. */
  recommended: boolean;
}

/** A template that cannot be filled for this vehicle, and why. */
export interface UnplannedVariant {
  templateId: string;
  templateName: string;
  reason: 'dual_needs_second_offer' | 'dual_two_model_unsupported';
  detail: string;
  /** The offer it would have led with, when one was available. */
  offer: MarketCheckIncentive | null;
}

export interface VariantPlan {
  build: PlannedVariant[];
  skip: UnplannedVariant[];
}

/**
 * Is this a two-offer template? True when the doc declares any `o2_*` field.
 *
 * Matches how the editor decides the same question, so a template that offers
 * "Fill Offer 2" by hand is exactly the set automation treats as dual. Reading
 * the fields rather than a separate flag means no template needs re-saving.
 */
export function isDualTemplate(doc: TemplateDoc): boolean {
  return doc.fields.some((f) => f.key.startsWith('o2_'));
}

/** `same` unless the doc says otherwise — the editor's own default. */
export function dualVehicleModeOf(doc: TemplateDoc): 'same' | 'two' {
  return doc.dualVehicleMode === 'two' ? 'two' : 'same';
}

/**
 * The size to render as the review thumbnail.
 *
 * Generation renders ONE size; the rest wait until a dealer picks the design.
 * Square is the ask because it reads as an ad at thumbnail scale where a
 * 728×90 leaderboard reads as a stripe — but `TemplateDoc.sizes` is whatever the
 * designer put there, and plenty of templates define no square at all. So this
 * takes the closest thing to 1:1 rather than failing, because refusing to
 * generate over a missing aspect ratio would be an absurd reason to lose an ad.
 *
 * Null only when the doc defines no sizes, which `preflight` already rejects.
 */
export function previewSizeId(doc: TemplateDoc): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const s of doc.sizes) {
    if (!s.width || !s.height) continue;
    // Compare in log space so 2:1 and 1:2 are equally far from square.
    const distance = Math.abs(Math.log(s.width / s.height));
    if (!best || distance < best.distance) best = { id: s.id, distance };
  }
  return best?.id ?? doc.sizes[0]?.id ?? null;
}

/**
 * Identity for the set of variants a dealer chooses BETWEEN.
 *
 * Every design built from the same vehicle and the same offer shares this key,
 * which is what lets the list group them into one row and what lets picking one
 * archive its siblings. Deliberately excludes the template: the whole point is
 * to name the group a template belongs to.
 *
 * A dual variant keys on both offers in slot order, because a lease-led pairing
 * and an APR-led pairing are genuinely different ads competing for different
 * space — not two designs of one thing.
 */
export function offerGroupKey(
  vehicle: { year: number; make: string; model: string },
  primary: MarketCheckIncentive,
  secondary?: MarketCheckIncentive | null,
): string {
  const slug = `${vehicle.year}-${vehicle.make}-${vehicle.model}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const prints = [offerFingerprint(primary)];
  if (secondary) prints.push(offerFingerprint(secondary));
  return `${slug}:${prints.join('+')}`;
}

/**
 * Pick the partner offer for a dual template.
 *
 * The rule is the top two DISTINCT offer types in the account's own priority
 * order — a lease headline supported by an APR, which is how these plates are
 * actually built. Deliberately not every pairing: three live offer types make
 * six ordered pairs, and multiplying that by every dual template buries the
 * dealer in near-identical choices.
 *
 * Same-type pairing is excluded on purpose. Two lease payments on one plate
 * reads as a mistake rather than an offer, and the second slot's whole purpose
 * is to say something the first does not.
 *
 * `eligible` must already be rank-ordered (best first).
 */
export function pickSecondaryOffer(
  primary: MarketCheckIncentive,
  eligible: MarketCheckIncentive[],
): MarketCheckIncentive | null {
  return eligible.find((inc) => inc.type !== primary.type) ?? null;
}

/**
 * Plan every ad this vehicle's offers should produce.
 *
 * @param eligible     Rank-ordered eligible offers (best first) from `selectOffer`.
 * @param templates    Published templates in scope for the account.
 * @param recommendedTemplateId  What the old resolution rules chose, or null when
 *                     they refused. Only ever flags a variant; never filters one.
 */
export function planVariants(
  eligible: MarketCheckIncentive[],
  templates: PlanTemplate[],
  recommendedTemplateId: string | null,
): VariantPlan {
  const build: PlannedVariant[] = [];
  const skip: UnplannedVariant[] = [];
  if (eligible.length === 0) return { build, skip };

  for (const tpl of templates) {
    if (!isDualTemplate(tpl.doc)) {
      // One variant per live offer. The recommended flag lands on the offer the
      // ranking put first, so exactly one variant across the whole vehicle
      // carries it.
      for (const inc of eligible) {
        build.push({
          templateId: tpl.id,
          templateName: tpl.name,
          doc: tpl.doc,
          primary: inc,
          secondary: null,
          recommended: tpl.id === recommendedTemplateId && inc === eligible[0],
        });
      }
      continue;
    }

    if (dualVehicleModeOf(tpl.doc) === 'two') {
      skip.push({
        templateId: tpl.id,
        templateName: tpl.name,
        reason: 'dual_two_model_unsupported',
        detail: `"${tpl.name}" compares two different vehicles, which is built by hand.`,
        offer: eligible[0],
      });
      continue;
    }

    const primary = eligible[0];
    const secondary = pickSecondaryOffer(primary, eligible.slice(1));
    if (!secondary) {
      skip.push({
        templateId: tpl.id,
        templateName: tpl.name,
        reason: 'dual_needs_second_offer',
        detail:
          `"${tpl.name}" shows two offers, and the only live program for this vehicle is ` +
          `${primary.type}. Nothing else to pair it with this cycle.`,
        offer: primary,
      });
      continue;
    }

    // One variant, not one per pairing — see pickSecondaryOffer.
    build.push({
      templateId: tpl.id,
      templateName: tpl.name,
      doc: tpl.doc,
      primary,
      secondary,
      recommended: tpl.id === recommendedTemplateId,
    });
  }

  return { build, skip };
}

/**
 * The offers a vehicle should fan out across: the best eligible offer OF EACH
 * TYPE, in rank order.
 *
 * `candidates` is already ranked, so the first sighting of a type is that type's
 * winner — no re-sorting, and the same rule decides both modes.
 *
 * Deduping by type is the whole point. A vehicle routinely carries several lease
 * programs that differ only in term or down payment; without this, each would
 * become its own design through every template, and the dealer would be choosing
 * between near-identical ads instead of between real alternatives.
 *
 * @param expandTypes  When false, only the single best offer is returned —
 *                     `expandOfferTypes` off, the lean mode.
 */
export function offersToFanOut(
  candidates: OfferCandidate[],
  expandTypes: boolean,
): MarketCheckIncentive[] {
  const eligible = candidates.filter((c) => c.rank !== null);
  if (!eligible.length) return [];
  if (!expandTypes) return [eligible[0].incentive];

  const seen = new Set<string>();
  const out: MarketCheckIncentive[] = [];
  for (const c of eligible) {
    if (seen.has(c.incentive.type)) continue;
    seen.add(c.incentive.type);
    out.push(c.incentive);
  }
  return out;
}

/**
 * When a dual ad stops being usable: the EARLIER of its two offers' end dates.
 *
 * A dual ad dies with whichever offer dies first — the plate is still showing the
 * dead one. Taking the later date leaves an ad advertising terms that no longer
 * exist, which is the exact exposure the expiry sweep exists to prevent.
 *
 * Null when neither offer carries a parseable end date.
 */
export function variantExpiry(
  primary: MarketCheckIncentive,
  secondary: MarketCheckIncentive | null,
): Date | null {
  const dates = [primary, secondary]
    .filter((i): i is MarketCheckIncentive => !!i)
    .map((i) => (i.endDate ? new Date(i.endDate) : null))
    .filter((d): d is Date => !!d && !Number.isNaN(d.getTime()));
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
}
