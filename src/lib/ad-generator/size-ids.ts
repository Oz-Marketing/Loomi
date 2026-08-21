import type { DocLayoutBox, TemplateDoc } from './doc-types';
import { rescaleBox, sizeFitOf } from './size-scope';

/**
 * Size ids: assigning them without collisions, and repairing docs that already
 * collided.
 *
 * A size's id is its dimensions (`1080x1920`), and `doc.layouts` is keyed by it.
 * That makes duplicate ids corrupting rather than cosmetic: the catalog has three
 * different 1080×1920 sizes (Facebook Story, Instagram Story/Reels, TikTok), and
 * adding them together used to hand all three the same id — so they shared one
 * layout, the canvas pager (which finds the current board by id) could never
 * advance past the first of them, and removing one removed all three.
 */

/** `1080x1920`, `1080x1920-2`, … — the first form not already taken. */
export function uniqueSizeId(taken: Iterable<string>, width: number, height: number): string {
  const used = new Set(taken);
  const base = `${width}x${height}`;
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export interface SizeToAdd {
  label: string;
  width: number;
  height: number;
}

/**
 * Add sizes to a doc in ONE pass, so ids stay unique across the whole batch.
 *
 * Adding them one at a time can't work from a React updater: each call would
 * read the same pre-batch size list and dedupe against a doc that doesn't yet
 * contain its siblings. Each new board starts from `fromSizeId`'s layout (or
 * empty) so it isn't blank.
 *
 * That starting layout is RE-DERIVED for the new board's aspect ratio, not
 * copied. Cloning the fractions was the same arithmetic mistake broadcasting
 * used to make: a 200×200 badge cloned from a 500×500 onto a 2000×500 arrived
 * 800×500. Each element is re-fitted by its own `sizeMode` — scale elements keep
 * their shape, fixed elements keep their pixels.
 */
export function addSizesToDoc(
  doc: TemplateDoc,
  sizes: SizeToAdd[],
  fromSizeId?: string,
): { doc: TemplateDoc; addedIds: string[] } {
  if (!sizes.length) return { doc, addedIds: [] };

  const source = (fromSizeId && doc.layouts[fromSizeId]) || {};
  const from = fromSizeId ? doc.sizes.find((s) => s.id === fromSizeId) : undefined;
  const fitOf = new Map(doc.elements.map((e) => [e.id, sizeFitOf(e)]));
  const taken = new Set(doc.sizes.map((s) => s.id));
  const nextSizes = [...doc.sizes];
  const nextLayouts: TemplateDoc['layouts'] = { ...doc.layouts };
  const addedIds: string[] = [];

  for (const s of sizes) {
    const id = uniqueSizeId(taken, s.width, s.height);
    taken.add(id);
    addedIds.push(id);
    nextSizes.push({ id, label: `${s.label} ${s.width}×${s.height}`, width: s.width, height: s.height });
    // Type follows the frame: a scale element gets the board's width ratio (a
    // 108px headline off a 1080 board would otherwise bury a 300×250 banner),
    // while a fixed element keeps its own px like the rest of its geometry.
    const fontScale = from && from.width > 0 ? s.width / from.width : 1;
    const layout: Record<string, DocLayoutBox> = {};
    for (const [elId, box] of Object.entries(source)) {
      if (!from) {
        layout[elId] = { ...box };
        continue;
      }
      const fit = fitOf.get(elId) ?? { mode: 'scale' as const, bleed: false };
      const fitted = rescaleBox(box, from, s, fit);
      if (fit.mode === 'scale' && fitted.fontSize != null) {
        fitted.fontSize = Math.max(1, Math.round(fitted.fontSize * fontScale));
      }
      layout[elId] = fitted;
    }
    nextLayouts[id] = layout;
  }

  return { doc: { ...doc, sizes: nextSizes, layouts: nextLayouts }, addedIds };
}

/**
 * Give every size in an already-saved doc a unique id, so a doc written before
 * batch-add assigned ids collision-free becomes editable again.
 *
 * The first size keeping an id keeps it; later twins are renamed and get their
 * OWN COPY of the layout they were sharing — the boards are the same dimensions,
 * so the shared layout is the design each of them should keep.
 *
 * Idempotent, and pure: returns the same object when there's nothing to fix, so
 * callers can use `changed` to decide whether to persist.
 */
export function dedupeSizeIds(doc: TemplateDoc): { doc: TemplateDoc; changed: boolean } {
  const taken = new Set<string>();
  let changed = false;

  const sizes = doc.sizes.map((s) => {
    if (!taken.has(s.id)) {
      taken.add(s.id);
      return s;
    }
    const id = uniqueSizeId(taken, s.width, s.height);
    taken.add(id);
    changed = true;
    return { ...s, id };
  });

  if (!changed) return { doc, changed: false };

  const layouts: TemplateDoc['layouts'] = { ...doc.layouts };
  doc.sizes.forEach((original, i) => {
    const renamed = sizes[i];
    if (renamed.id !== original.id && doc.layouts[original.id]) {
      layouts[renamed.id] = structuredClone(doc.layouts[original.id]);
    }
  });

  return { doc: { ...doc, sizes, layouts }, changed: true };
}
