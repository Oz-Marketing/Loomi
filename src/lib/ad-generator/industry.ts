import type { AdTemplate } from './types';
import type { TemplateDoc } from './doc-types';
import { OFFER_KINDS, offerKindForDoc, type OfferKind } from './offer-kinds';

/**
 * Industry scoping for ad templates.
 *
 * `industries` is organizational metadata — a taxonomy (alongside category +
 * tags) for filtering the template library as it grows. It is NOT a hard gate:
 * a template with NO industries set is global to EVERY industry, so an untagged
 * template a designer publishes/deploys always shows. A template WITH
 * industries is scoped to those — a designer tags it (e.g. Automotive) so it
 * only surfaces for matching accounts.
 */

/** Industries that use vehicle offers (the EVOX / MarketCheck tooling). */
export const VEHICLE_INDUSTRIES = ['automotive', 'powersports'] as const;

export function isVehicleIndustry(industry: string | null | undefined): boolean {
  return VEHICLE_INDUSTRIES.includes((industry ?? '').trim().toLowerCase() as (typeof VEHICLE_INDUSTRIES)[number]);
}

/**
 * The industries a template is tagged for. Empty ⇒ untagged ⇒ global to every
 * industry (see `templateInIndustry`).
 */
export function effectiveIndustries(t: Pick<AdTemplate, 'industries'>): string[] {
  return t.industries ?? [];
}

/**
 * Whether `accountIndustry` (an account `category`) should see this template.
 * - Admin / no account (empty industry) → everything (the full library).
 * - Untagged template (no industries) → everything (global to all industries).
 * - Tagged template → only accounts whose category matches one of its tags.
 */
export function templateInIndustry(t: Pick<AdTemplate, 'industries'>, accountIndustry: string | null | undefined): boolean {
  const industry = (accountIndustry ?? '').trim().toLowerCase();
  if (!industry) return true; // admin / no account selected → full library
  const inds = effectiveIndustries(t);
  if (!inds.length) return true; // untagged → global to every industry
  return inds.some((i) => i.trim().toLowerCase() === industry);
}

/**
 * The offer KINDS an account in `industry` may start an ad or template against.
 *
 * The registry itself is industry-blind on purpose — a kind is a field schema
 * plus offer math, and neither knows who is looking at it. This is where that
 * meets the account: the vehicle kind's whole capability row (a year/make/model
 * picker, EVOX jellybeans, a VIN, unattended generation from an inventory feed)
 * only exists for a business that sells vehicles. Offering it to a marketing
 * agency handed them a form asking for a lease term.
 *
 * Keyed off `capabilities.vehiclePicker` rather than a list of kind ids so a
 * kind added later lands on the right side of this without editing it, and
 * derived rather than stored for the reason `composesDisclaimer` is: a flag
 * would be free to disagree with the capability row it is describing.
 *
 * Empty industry = admin / no account selected, which sees the whole registry —
 * the same rule `templateInIndustry` uses for the library itself. An account
 * with no industry set is treated the same way: withholding a kind because
 * nobody filled in a settings field would break every dealer that hasn't.
 */
export function offerKindsForIndustry(industry: string | null | undefined): OfferKind[] {
  const set = (industry ?? '').trim();
  if (!set || isVehicleIndustry(set)) return OFFER_KINDS;
  return OFFER_KINDS.filter((k) => !k.capabilities.vehiclePicker);
}

/**
 * Whether a template built against this doc's kind is usable by an account in
 * `industry`.
 *
 * The kind gate is INDEPENDENT of the `industries` tag above. A tag is a
 * designer's filing choice and an untagged template is global; a kind is what
 * the form actually asks for, and a vehicle offer's questions have no answers
 * at a dental practice no matter how it was filed. Both have to pass.
 *
 * A doc with no `offerKind` reads as `vehicle` (`offerKindForDoc`), which is
 * correct: every template written before kinds existed carried the vehicle
 * schema. That does mean a non-vehicle account stops seeing legacy templates —
 * which is the point, since those are the ones that were handing it a VIN field.
 */
export function kindInIndustry(
  doc: Pick<TemplateDoc, 'offerKind'>,
  industry: string | null | undefined,
): boolean {
  const kind = offerKindForDoc(doc);
  return offerKindsForIndustry(industry).some((k) => k.id === kind.id);
}
