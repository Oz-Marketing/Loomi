import type { AdTemplate } from './types';

/**
 * Industry scoping for ad templates.
 *
 * The ad generator is built to support any Loomi industry, but the current
 * template set is automotive (vehicle offers). Templates carry an `industries`
 * list; a template with none is classified by its content. An account only sees
 * templates whose industries include its own — so non-automotive accounts see
 * nothing until templates are authored for them.
 */

/** Industries that use vehicle offers (the EVOX / MarketCheck tooling). */
export const VEHICLE_INDUSTRIES = ['automotive', 'powersports'] as const;

export function isVehicleIndustry(industry: string | null | undefined): boolean {
  return VEHICLE_INDUSTRIES.includes((industry ?? '').trim().toLowerCase() as (typeof VEHICLE_INDUSTRIES)[number]);
}

/** Does a template carry the structured offer / vehicle-image fields? */
function hasVehicleFields(t: Pick<AdTemplate, 'fields'>): boolean {
  return t.fields.some((f) => f.key === 'offerType' || f.key === 'vehicleImageUrl');
}

/**
 * The industries a template applies to: its explicit `industries`, or — when
 * unset — derived from content (vehicle templates → Automotive + Powersports;
 * anything else → none, so it stays hidden until tagged).
 */
export function effectiveIndustries(t: Pick<AdTemplate, 'industries' | 'fields'>): string[] {
  if (t.industries && t.industries.length) return t.industries;
  if (hasVehicleFields(t)) return ['Automotive', 'Powersports'];
  return [];
}

/**
 * Whether `accountIndustry` (an account `category`) should see this template.
 * Admin/no account (empty industry) sees everything (managing the full library).
 */
export function templateInIndustry(t: Pick<AdTemplate, 'industries' | 'fields'>, accountIndustry: string | null | undefined): boolean {
  const industry = (accountIndustry ?? '').trim().toLowerCase();
  if (!industry) return true; // admin / no account selected → full library
  return effectiveIndustries(t).some((i) => i.trim().toLowerCase() === industry);
}
