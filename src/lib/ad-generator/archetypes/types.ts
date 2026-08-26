import type { AdSize, AdData, FieldSpec } from '../types';
import type { DocElement, DocLayoutBox, TemplateDoc, Theme } from '../doc-types';

/**
 * ARCHETYPES — a named automotive ad composition that lays itself out.
 *
 * An archetype is a FUNCTION FROM (theme, sizes) TO A TemplateDoc. That is the
 * whole design, and it is what makes this safe to try: the output is an ordinary
 * doc, so the renderer, the builder canvas, preflight, OEM compliance, the
 * co-op checks, unattended generation and every export path keep working with no
 * changes at all. Nothing downstream can tell the difference between a doc a
 * designer placed by hand and a doc an archetype produced.
 *
 * WHAT IT REPLACES. `young-subaru-offers.ts` is two docs × five boards × eleven
 * slots of hand-authored geometry — roughly two hundred lines of x/y/w/h, each
 * number chosen by eye and none of them connected to any other. Adding a sixth
 * channel size means eleven more boxes, by hand, twice. An archetype states the
 * composition once and derives every board from it, so a new size costs nothing
 * and every board stays consistent with its siblings by construction.
 *
 * ARCHETYPES ARE CODE-OWNED. Same bar as offer kinds, for the same reason: an
 * archetype carries layout rules and compliance expectations, so a
 * half-configured one would silently render a broken or non-compliant ad. What a
 * designer owns is the THEME — colour, type, logo, background treatment — plus
 * per-board overrides on the doc it produces, which are ordinary doc edits.
 */

/**
 * The designer-owned surface: everything an archetype styles itself from.
 *
 * Declared in `doc-types` because a doc an archetype produced STORES its theme —
 * that is what makes the theme editable after the fact instead of a build-time
 * argument nobody can get back to. Re-exported here because this is where it is
 * documented and where every archetype reads it.
 */
export type { Theme } from '../doc-types';

/**
 * A named role in an automotive offer ad.
 *
 * This list IS the anatomy, and it is the thing the generic builder had no way
 * to express: a text element that happens to be bound to `_offerMain` is not the
 * same thing as THE OFFER, and only one of those two can be checked, laid out or
 * reasoned about.
 */
export type SlotRole =
  | 'backdrop'
  | 'band'
  | 'divider'
  | 'logo'
  | 'tagline'
  | 'offer'
  | 'vehicle'
  | 'vehicleName'
  | 'expiration'
  | 'disclaimer';

export interface ArchetypeSlot {
  /** Element id in the produced doc. Stable, so per-board overrides survive. */
  id: string;
  role: SlotRole;
  /**
   * The GROUP this slot belongs to, as `id|Display Name`.
   *
   * Groups are builder-only — they change nothing about the render — but they are
   * what turns a composition into a KIT. A designer who wants the offer somewhere
   * else drags one thing instead of marquee-selecting three and hoping they stay
   * in step, and the lockup's internal proportions survive being moved.
   *
   * That matters more than the arrangement does. The arrangement is a suggestion a
   * designer will override; the bindings, the styling and the internal
   * relationships are the part they should never have to rebuild by hand.
   */
  group?: string;
  /** The element, styled from the theme. */
  build: (t: Theme) => DocElement;
}

export interface Archetype {
  id: string;
  name: string;
  description: string;
  slots: ArchetypeSlot[];
  /** The form fields the produced doc declares. */
  fields: FieldSpec[];
  /** Starting data for the produced doc. */
  defaults: AdData;
  /**
   * Which slots this board can carry, most-important-first shedding. Returning
   * a set smaller than `slots` is how a 300×250 drops the tagline instead of
   * rendering eight things at four pixels each.
   */
  present(size: AdSize, slots: ArchetypeSlot[]): Set<string>;
  /** Boxes for every present slot on this board. */
  layout(size: AdSize, present: Set<string>): Record<string, DocLayoutBox>;
}

/** The doc an archetype produces for a given theme and set of boards. */
export function buildArchetypeDoc(
  arch: Archetype,
  theme: Theme,
  sizes: AdSize[],
  meta: {
    id: string;
    name: string;
    description?: string;
    industries?: string[];
    defaults?: AdData;
    /** How many offers this archetype was asked for, recorded on the doc. */
    offers?: number;
  },
): TemplateDoc {
  // Every slot the archetype could place on ANY of these boards becomes an
  // element. A slot shed on one board simply has no box there — which is exactly
  // how the doc format already expresses "not on this size", so a shed slot needs
  // no new concept and no `hidden` flag.
  const used = new Set<string>();
  for (const size of sizes) for (const id of arch.present(size, arch.slots)) used.add(id);

  // The role travels ON the element: it is what the inspector reads to tell a
  // designer what a layer is for, and it survives every later edit to the doc.
  const elements: DocElement[] = arch.slots
    .filter((s) => used.has(s.id))
    .map((s) => ({
      ...s.build(theme),
      id: s.id,
      role: s.role,
      ...(s.group ? { groupId: s.group.split('|')[0] } : {}),
    }));

  // One entry per group any surviving slot names, in slot order. A group whose
  // every member was shed on every board never appears.
  const groups: NonNullable<TemplateDoc['groups']> = [];
  for (const s of arch.slots) {
    if (!s.group || !used.has(s.id)) continue;
    const [id, name] = s.group.split('|');
    if (!groups.some((g) => g.id === id)) groups.push({ id, name: name ?? id });
  }

  const layouts: TemplateDoc['layouts'] = {};
  for (const size of sizes) {
    const present = arch.present(size, arch.slots);
    const boxes = arch.layout(size, present);
    // Never emit a box for a slot this board sheds, and never emit one for a slot
    // the layout forgot — the two together are what the invariant tests check.
    layouts[size.id] = Object.fromEntries(
      Object.entries(boxes).filter(([id]) => present.has(id)),
    );
  }

  return {
    id: meta.id,
    name: meta.name,
    description: meta.description ?? arch.description,
    industries: meta.industries ?? ['Automotive'],
    // Where this design came from, so the theme stays editable afterwards.
    archetype: {
      id: arch.id,
      offers: meta.offers ?? arch.slots.filter((s) => /offerMain$/.test(s.id)).length,
      theme,
    },
    sizes,
    fields: arch.fields,
    elements,
    ...(groups.length ? { groups } : {}),
    layouts,
    defaults: { ...arch.defaults, ...(meta.defaults ?? {}) },
  };
}

/** Boxes keyed by slot id, for the layout helpers to fill in. */
export type SlotBoxes = Record<string, DocLayoutBox>;
