import type { AdSize } from '../types';
import type { ComposedBoard } from '../size-ids';
import type { DocElement, DocLayoutBox, TemplateDoc, Theme } from '../doc-types';
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
 * `color`, `fill` and `bg` because those are what the five colours paint;
 * `fontFamily` because a theme names the display and reading faces, and a
 * retheme that recoloured the type but left the wrong family behind would be
 * half a restyle.
 *
 * `fontFamily` is also the first theme key whose value can legitimately be
 * UNDEFINED — a theme naming no face means "use the account's stack" — so a
 * retheme from a font-bearing theme back to a bare one correctly clears the
 * family rather than leaving the old one stranded. Same trade the colours
 * already make: a designer who hand-set a face on an archetype slot loses it on
 * a retheme, because they asked for the type to change.
 */
const THEME_KEYS = ['color', 'fill', 'bg', 'gradientFill', 'fontFamily'] as const satisfies readonly (keyof DocElement)[];

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
        // ONLY keys the rebuilt slot actually DEFINES. A theme has no opinion
        // about a property its slots never set, and copying `undefined` across
        // would silently wipe whatever the designer had put there.
        //
        // This matters now in a way it did not before: the starting points build
        // PLAIN boxes, so a rebuilt slot defines no colours or faces at all, and
        // an unguarded copy would clear a designer's own styling every time the
        // theme was touched.
        if (next[key] === undefined) continue;
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

/**
 * COMPOSING A NEWLY ADDED BOARD, for a doc an archetype produced.
 *
 * The problem this solves, in the terms a designer hits it in: lay a design out
 * on a 500×1000, add a 2000×500, and every box arrives somewhere absurd. Nothing
 * is broken — `addSizesToDoc` re-fits each element by its own `sizeMode`, which
 * faithfully preserves each SHAPE. But shape is not composition. A portrait board
 * stacks its copy above the vehicle; a strip four times wider than it is tall
 * puts the copy beside it. Going between them is a re-arrangement, and no
 * per-element arithmetic can perform one, because the arithmetic cannot see that
 * the thing it is moving is an offer plate.
 *
 * The archetype can. It already decides `isWide`, already sheds what a board has
 * no room for, and already holds every legibility floor in real pixels — it just
 * only ever ran at creation. This is that same composition, run again for one new
 * board, which is why a sixth channel size genuinely costs nothing.
 *
 * ── WHAT IT DELIBERATELY DOES NOT TOUCH ──
 *
 * Only slots the archetype owns. A designer who added their own layers keeps
 * them, carried over by the rescale path exactly as before — the composition has
 * no opinion about a layer it did not place, and inventing one would silently
 * move somebody's work.
 *
 * Boards that already exist are never recomposed either. This runs for a board
 * being ADDED, where there is no prior arrangement to lose. Re-running it over a
 * board a designer has tuned would throw that tuning away, which is precisely the
 * mistake `applyTheme` is careful not to make.
 *
 * Returns null when the doc came from no archetype this build knows — a doc is
 * never worth rearranging on a guess.
 */
export function composeBoard(doc: TemplateDoc, size: AdSize): ComposedBoard | null {
  const record = doc.archetype;
  if (!record) return null;
  const arch = archetypeFor(record.id, record.offers);
  if (!arch) return null;

  // The archetype owns every slot id it defines, whether or not the doc still
  // carries that element — `owns` is a statement about WHOSE id it is, not about
  // what exists. Narrowing it to the live elements looked tidier and was wrong:
  // a slot the designer DELETED then fell outside `owns`, took the rescale path,
  // and was resurrected on the next board they added, carried over from a stale
  // box in the source board's layout.
  const owns = new Set(arch.slots.map((s) => s.id));
  // What the doc still HAS decides what gets a BOX. Deleted stays deleted.
  const alive = new Set(doc.elements.map((e) => e.id));

  const present = arch.present(size, arch.slots);
  const boxes: Record<string, DocLayoutBox> = {};
  for (const [id, b] of Object.entries(arch.layout(size, present))) {
    if (present.has(id) && alive.has(id)) boxes[id] = b;
  }
  return { boxes, owns };
}
