import type { AdData, AdSize } from '../types';
import { AD_SIZE_STARTERS } from '../ad-size-library';
import type { TemplateDoc } from '../doc-types';
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
 *
 * ── NO STORE PRESETS HERE ──
 *
 * This list is offered to EVERY account, so a rooftop's own palette does not
 * belong in it. It briefly carried two Young Subaru entries — the prototype that
 * proved an archetype could reproduce a hand-built template — and the result was a
 * Ford dealer being shown "Young Subaru" as a way to start an ad.
 *
 * They were also redundant: the compositions below use `brand: 'brand'`, so they
 * already paint themselves from whichever account the ad is for. What a store
 * preset added beyond that was a hard-coded palette (which belongs in the
 * account's branding), a channel size list (which belongs in the ad size library)
 * and sample content (which a designer edits on the template).
 *
 * `youngSubaruSingleOffer()` / `youngSubaruDualOffer()` still exist as the
 * archetype's proof, asserted in `archetypes.test.ts`. They are just not a menu
 * item.
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
  fade: { angle: 135, end: 70 },
};

/**
 * The channel set a template starts with when nobody has said otherwise.
 *
 * EVERY size in the library, not a curated few. It costs an archetype nothing to
 * lay out a board — that is the entire claim the composition makes — so the
 * useful default is the whole catalogue, and the designer switches off the
 * channels this template is not for. Curating here just made them re-add by hand
 * the boards we had decided on their behalf they would not want.
 *
 * Derived from `AD_SIZE_STARTERS` rather than restated, so the list cannot drift
 * from the library. The BUILDER goes one better and hands the archetype the
 * account's live library — including any custom sizes — so this constant is the
 * fallback for callers with no account in scope (the seed script, the tests).
 *
 * Three of these are 1080×1920 (Facebook Story, Instagram Story, TikTok). They
 * stay as three: they are three placements with three sets of safe areas, and
 * `uniqueSizeId` keeps their layouts separate.
 *
 * The one board the archetype CANNOT compose — a 728×90 leaderboard — is not in
 * the library at all, which is why nothing here has to special-case it. See the
 * note in `ad-size-library.ts`.
 */
export const DEFAULT_SIZES: AdSize[] = AD_SIZE_STARTERS.map((s) => ({
  id: s.key,
  label: `${s.name} (${s.width}×${s.height})`,
  width: s.width,
  height: s.height,
}));

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
    hint: 'Every block for one vehicle and one offer, on every board. Serves lease, APR, discount and sale price.',
    group: 'Compositions',
    offers: 1,
    theme: BRAND_THEME,
    sizes: DEFAULT_SIZES,
  },
  {
    id: 'two-vehicles',
    name: 'Two Vehicles',
    hint: 'Every block for two vehicle offers — two of each, plus a logo and disclaimer.',
    group: 'Compositions',
    offers: 2,
    theme: BRAND_THEME,
    sizes: DEFAULT_SIZES,
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
