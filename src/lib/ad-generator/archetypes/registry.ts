import type { AdData, AdSize } from '../types';
import type { TemplateDoc } from '../doc-types';
import { YOUNG_SUBARU_SIZES } from '../templates/young-subaru-offers';
import { SUBARU_DEFAULTS, SUBARU_DUAL_DEFAULTS, YOUNG_SUBARU_THEME } from './young-subaru-archetype';
import { vehicleOfferArchetype, type OfferCount } from './vehicle-offer-archetype';
import { buildArchetypeDoc, type Theme } from './types';

/**
 * THE STARTING POINTS a designer picks from — the registry behind "start from an
 * archetype" in the builder.
 *
 * An entry is an archetype plus a theme plus the channel sizes it suggests. That
 * is the whole of what makes one starting point differ from another, which is the
 * point: the composition and its layout rules are shared, so a new entry is a
 * palette and a size list rather than another set of hand-placed boxes.
 *
 * CODE-OWNED, like the archetypes themselves and for the same reason — see
 * docs/ad-generator-archetypes.md §7.2. What a designer owns is everything they
 * do to the doc after it lands: restyle, reposition, add layers, override a board.
 */

/**
 * The default theme: it paints itself from the ACCOUNT.
 *
 * `'brand'` is resolved by the renderer to whichever account the ad is being made
 * for, so this one entry is a usable starting point for every rooftop rather than
 * a grey template somebody has to recolour before it looks like anything.
 */
export const BRAND_THEME: Theme = {
  base: '#ffffff',
  brand: 'brand',
  ink: '#0f172a',
  muted: '#475569',
  onBrand: '#ffffff',
  fade: { angle: 135, end: 70 },
};

/** The social/display set a template starts with when nobody has said otherwise. */
export const DEFAULT_SIZES: AdSize[] = [
  { id: 'square', label: 'Square 1:1 (1080×1080)', width: 1080, height: 1080 },
  { id: 'landscape', label: 'Landscape (1200×628)', width: 1200, height: 628 },
  { id: 'story', label: 'Story 9:16 (1080×1920)', width: 1080, height: 1920 },
];

export interface ArchetypeStart {
  id: string;
  name: string;
  /** One line on when to reach for it. */
  hint: string;
  /** Picker heading. Compositions first, then anything store-specific. */
  group: string;
  offers: OfferCount;
  theme: Theme;
  sizes: AdSize[];
  /**
   * Sample content the boards arrive filled with, over the archetype's own. A
   * store preset knows its rooftop's name and its vehicles; a generic composition
   * leaves the archetype's placeholders in place.
   */
  defaults?: AdData;
}

export const ARCHETYPE_STARTS: ArchetypeStart[] = [
  {
    id: 'vehicle-offer',
    name: 'Vehicle Offer',
    hint: 'One vehicle, one offer. Serves lease, APR, discount and sale price from the same design.',
    group: 'Compositions',
    offers: 1,
    theme: BRAND_THEME,
    sizes: DEFAULT_SIZES,
  },
  {
    id: 'two-vehicles',
    name: 'Two Vehicles',
    hint: 'Two offers side by side — a comparison. Stacks itself on tall boards.',
    group: 'Compositions',
    offers: 2,
    theme: BRAND_THEME,
    sizes: DEFAULT_SIZES,
  },
  {
    id: 'young-subaru-single',
    name: 'Young Subaru — One Offer',
    hint: 'The Subaru palette across the five channels Young runs: Facebook, email, Google and both KSL formats.',
    group: 'Young Automotive',
    offers: 1,
    theme: YOUNG_SUBARU_THEME,
    sizes: YOUNG_SUBARU_SIZES,
    defaults: SUBARU_DEFAULTS,
  },
  {
    id: 'young-subaru-dual',
    name: 'Young Subaru — Two Offers',
    hint: 'Two Subaru offers, same five channels.',
    group: 'Young Automotive',
    // The dual's fade runs as a top band rather than a diagonal — a theme choice.
    offers: 2,
    theme: { ...YOUNG_SUBARU_THEME, fade: { angle: 180, end: 45 } },
    sizes: YOUNG_SUBARU_SIZES,
    defaults: { ...SUBARU_DEFAULTS, ...SUBARU_DUAL_DEFAULTS },
  },
];

export function archetypeStart(id: string): ArchetypeStart | undefined {
  return ARCHETYPE_STARTS.find((s) => s.id === id);
}

/**
 * The doc a starting point produces, keeping the template's own identity.
 *
 * `meta` carries what belongs to the TEMPLATE rather than the archetype — its id,
 * its name, its publishing scope — so picking a starting point on a template that
 * already exists replaces the design without renaming or re-scoping it.
 */
export function docFromStart(
  start: ArchetypeStart,
  meta: { id: string; name?: string; sizes?: AdSize[] },
): TemplateDoc {
  return buildArchetypeDoc(
    vehicleOfferArchetype(start.offers),
    start.theme,
    // A designer who already added the boards they want keeps them; otherwise the
    // starting point brings its own channel set.
    meta.sizes?.length ? meta.sizes : start.sizes,
    {
      id: meta.id,
      name: meta.name?.trim() || start.name,
      industries: ['Automotive'],
      defaults: start.defaults,
    },
  );
}

/** The starts grouped for the picker, in registry order. */
export function archetypeStartGroups(): { group: string; items: ArchetypeStart[] }[] {
  const order: string[] = [];
  const by = new Map<string, ArchetypeStart[]>();
  for (const s of ARCHETYPE_STARTS) {
    const list = by.get(s.group);
    if (list) list.push(s);
    else {
      by.set(s.group, [s]);
      order.push(s.group);
    }
  }
  return order.map((group) => ({ group, items: by.get(group)! }));
}
