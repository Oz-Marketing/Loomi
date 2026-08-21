import type { TemplateDoc } from '../doc-types';
import type { AdSize } from '../types';
import { YOUNG_SUBARU_SIZES } from '../templates/young-subaru-offers';
import { vehicleOfferArchetype } from './vehicle-offer-archetype';
import { buildArchetypeDoc, type Theme } from './types';

/**
 * Young Subaru, rebuilt as a THEME on the Vehicle Offer archetype.
 *
 * Compare with `templates/young-subaru-offers.ts`, which produces the same
 * template as five hand-authored layouts of eleven boxes each. Everything below
 * the theme is derived, so the two things a designer actually chose — the Subaru
 * palette and the fade treatment — are the only things stated here.
 *
 * The prototype for the automotive-specific direction. Not wired into the seed
 * script yet: it exists to be compared against the hand-built doc, and to prove
 * that a sixth channel size costs nothing.
 */

export const YOUNG_SUBARU_THEME: Theme = {
  base: '#199fdb', // Subaru light blue
  brand: '#0a3d8f', // Subaru deep blue — the offer figure + expiration pill
  ink: '#0f172a',
  muted: '#334155',
  onBrand: '#ffffff',
  fade: { angle: 135, end: 70 },
};

const SUBARU_DEFAULTS = {
  dealerName: 'Young Subaru',
  brandColor: YOUNG_SUBARU_THEME.brand,
  financialInstitution: 'Subaru Motors Finance',
  vehicleName: '2026 Subaru Outback',
  tagline: 'Adventure Starts Here',
  vehicleImageUrl: '',
};

/** The doc, for whatever set of boards Young wants — defaults to the five they run. */
export function youngSubaruSingleOffer(sizes: AdSize[] = YOUNG_SUBARU_SIZES): TemplateDoc {
  return buildArchetypeDoc(vehicleOfferArchetype, YOUNG_SUBARU_THEME, sizes, {
    id: 'young-subaru-single-offer-arch',
    name: 'Young Subaru — Single Offer',
    description:
      'One offer on the Young Subaru background (base fill + fade + drop-in topo texture), laid out per channel.',
    industries: ['Automotive'],
    defaults: SUBARU_DEFAULTS,
  });
}
