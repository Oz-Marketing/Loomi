import type { AdTemplate } from './types';

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
