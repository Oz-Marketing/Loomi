import type { DocElement, TemplateDoc, Theme } from '../doc-types';
import { vehicleOfferArchetype } from './vehicle-offer-archetype';
import type { Archetype } from './types';

/**
 * RETHEMING a doc an archetype produced — the editable half of Phase 3.
 *
 * The theme is an argument to the archetype, so the obvious way to change it is
 * to rebuild the doc. That is also the wrong way: it would throw away every
 * override, addition and reposition the designer made after the design landed,
 * which is most of the value of producing an ordinary doc in the first place.
 *
 * So a retheme is a RECOLOUR. It re-runs the archetype's slots against the new
 * theme and copies across only the keys a theme owns — the ink, the fill, the
 * gradient — matching elements by id. Geometry, bindings, layer names, per-board
 * overrides and anything hand-placed are left exactly as they are.
 *
 * A designer who has deliberately recoloured one layer loses that on a retheme,
 * which is the correct trade: they asked for the palette to change.
 */

/**
 * The style keys a theme decides. Everything else on an element belongs to
 * whoever touched it last.
 *
 * `gradientFill` is here because the fade IS the theme's background treatment;
 * `color`, `fill` and `bg` because those are what the five colours paint.
 */
const THEME_KEYS = ['color', 'fill', 'bg', 'gradientFill'] as const satisfies readonly (keyof DocElement)[];

/** The archetypes a stored `doc.archetype.id` can name. */
function archetypeFor(id: string, offers: number): Archetype | undefined {
  const arch = vehicleOfferArchetype(offers === 2 ? 2 : 1);
  return arch.id === id ? arch : undefined;
}

/**
 * The doc restyled to `theme`, or the doc unchanged when it did not come from an
 * archetype this build knows — a doc is never worth breaking for a recolour.
 */
export function applyTheme(doc: TemplateDoc, theme: Theme): TemplateDoc {
  const record = doc.archetype;
  if (!record) return doc;
  const arch = archetypeFor(record.id, record.offers);
  if (!arch) return doc;

  const restyled = new Map<string, DocElement>();
  for (const slot of arch.slots) restyled.set(slot.id, slot.build(theme));

  return {
    ...doc,
    archetype: { ...record, theme },
    elements: doc.elements.map((el) => {
      const next = restyled.get(el.id);
      if (!next) return el; // hand-placed: not the theme's business
      const patch: Partial<DocElement> = {};
      for (const key of THEME_KEYS) {
        // Assigning through a union of value types needs the widening; the keys
        // are fixed above, so this stays honest.
        (patch as Record<string, unknown>)[key] = next[key];
      }
      return { ...el, ...patch };
    }),
    // A per-board override that pinned an old colour would win over the recolour
    // and look like the theme change failed on that board alone.
    overrides: stripThemeOverrides(doc.overrides),
  };
}

/** The same overrides with every theme-owned key dropped. */
function stripThemeOverrides(overrides: TemplateDoc['overrides']): TemplateDoc['overrides'] {
  if (!overrides) return overrides;
  const out: NonNullable<TemplateDoc['overrides']> = {};
  for (const [sizeId, byEl] of Object.entries(overrides)) {
    const kept: Record<string, Partial<DocElement>> = {};
    for (const [elId, patch] of Object.entries(byEl ?? {})) {
      const rest = { ...patch };
      for (const key of THEME_KEYS) delete rest[key];
      if (Object.keys(rest).length > 0) kept[elId] = rest;
    }
    if (Object.keys(kept).length > 0) out[sizeId] = kept;
  }
  return out;
}

/** The theme a doc is currently wearing, when it came from an archetype. */
export function docTheme(doc: TemplateDoc): Theme | undefined {
  return doc.archetype?.theme;
}
