import type { AdSize, AdData, FieldSpec } from '../types';
import type { DocElement, DocLayoutBox, TemplateDoc } from '../doc-types';

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

/** The designer-owned surface: everything an archetype styles itself from. */
export interface Theme {
  /** Base fill behind everything. */
  base: string;
  /** Accent used for the offer figure and the expiration pill. */
  brand: string;
  /** Body/heading ink. */
  ink: string;
  /** Secondary ink — labels, terms, disclaimer. */
  muted: string;
  /** Ink used ON the brand colour (the expiration pill's text). */
  onBrand: string;
  /** The white-fade angle + how far across it runs, per the Subaru treatment. */
  fade?: { angle: number; end: number };
}

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
  /** The element, styled from the theme. */
  build: (t: Theme) => DocElement;
  /**
   * Shed order when a board has no room for everything: the LOWEST value goes
   * first. Absent means required — it is never shed, at any size.
   *
   * The disclaimer is deliberately not optional. A board too small for it is a
   * board this archetype must not claim to support, because an ad without a
   * legible disclaimer is one nobody can run.
   */
  shedAt?: number;
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
  meta: { id: string; name: string; description?: string; industries?: string[]; defaults?: AdData },
): TemplateDoc {
  // Every slot the archetype could place on ANY of these boards becomes an
  // element. A slot shed on one board simply has no box there — which is exactly
  // how the doc format already expresses "not on this size", so a shed slot needs
  // no new concept and no `hidden` flag.
  const used = new Set<string>();
  for (const size of sizes) for (const id of arch.present(size, arch.slots)) used.add(id);

  const elements: DocElement[] = arch.slots
    .filter((s) => used.has(s.id))
    .map((s) => ({ ...s.build(theme), id: s.id }));

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
    sizes,
    fields: arch.fields,
    elements,
    layouts,
    defaults: { ...arch.defaults, ...(meta.defaults ?? {}) },
  };
}

/** Slots in shed order: the first to go, first. Required slots are excluded. */
export function shedOrder(slots: ArchetypeSlot[]): ArchetypeSlot[] {
  return slots
    .filter((s) => s.shedAt != null)
    .sort((a, b) => (a.shedAt ?? 0) - (b.shedAt ?? 0));
}

/** Boxes keyed by slot id, for the layout helpers to fill in. */
export type SlotBoxes = Record<string, DocLayoutBox>;
