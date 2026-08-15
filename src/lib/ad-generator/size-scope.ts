import type { DocElement, DocLayoutBox, TemplateDoc } from './doc-types';

/**
 * Whether an edit lands on the board you're looking at, or on all of them.
 *
 * The doc used to decide this for you, differently per property: placement lived
 * per size, style lived on the element. So dragging something moved it on one
 * board and recolouring it recoloured fifteen, with no say in either. Both are now
 * a choice — geometry broadcasts by writing the same box to every size, style
 * localises by writing a per-size override.
 *
 * `'size'` is the default. Editing one board must not silently rewrite the other
 * fourteen, and per-aspect-ratio placement is hand-tuned work to lose.
 */
export type EditScope = 'size' | 'all';

/**
 * Keys that stay shared no matter the scope — an element's identity and behaviour
 * rather than its appearance.
 *
 * `binding` and `visibleWhen` are here deliberately. WHAT an element shows, and
 * which offer types it belongs to, are properties of the template; letting them
 * drift per board would mean the co-op and preflight checks (which read the shared
 * elements) no longer describe what actually renders. Per-board omission already
 * has a home: `DocLayoutBox.hidden`, the eye in the Layers panel.
 */
const NEVER_OVERRIDE = new Set<keyof DocElement>([
  'id',
  'type',
  'groupId',
  'locked',
  'name',
  'binding',
  'visibleWhen',
]);

/** Whether a patch has anything left to write once the shared-only keys are dropped. */
export function overridableKeys(patch: Partial<DocElement>): (keyof DocElement)[] {
  return (Object.keys(patch) as (keyof DocElement)[]).filter((k) => !NEVER_OVERRIDE.has(k));
}

/** The element as it renders on `sizeId`: shared style, with that size's diffs on top. */
export function effectiveElement(
  el: DocElement,
  overrides: TemplateDoc['overrides'],
  sizeId: string,
): DocElement {
  const patch = overrides?.[sizeId]?.[el.id];
  if (!patch || Object.keys(patch).length === 0) return el;
  return { ...el, ...patch, id: el.id, type: el.type };
}

/** Every element as it renders on `sizeId`. */
export function effectiveElements(doc: TemplateDoc, sizeId: string): DocElement[] {
  if (!doc.overrides?.[sizeId]) return doc.elements;
  return doc.elements.map((el) => effectiveElement(el, doc.overrides, sizeId));
}

/**
 * Every distinct styling of every element across the whole doc: the shared
 * element, plus each size's overridden variant.
 *
 * For collection passes that must cover the doc rather than one board — font
 * embedding above all. A family used only on the story board still has to be
 * embedded, or that board silently renders a fallback.
 */
export function styleVariants(doc: TemplateDoc): DocElement[] {
  if (!doc.overrides) return doc.elements;
  const out = [...doc.elements];
  for (const sizeId of Object.keys(doc.overrides)) {
    for (const el of doc.elements) {
      const variant = effectiveElement(el, doc.overrides, sizeId);
      if (variant !== el) out.push(variant);
    }
  }
  return out;
}

/** Which style keys this size diverges on — what the UI offers to reset. */
export function overriddenKeys(doc: TemplateDoc, sizeId: string, elId: string): string[] {
  return Object.keys(doc.overrides?.[sizeId]?.[elId] ?? {});
}

/** Drop empty leaves so an override map never accumulates `{}` noise. */
function pruneOverrides(overrides: NonNullable<TemplateDoc['overrides']>): TemplateDoc['overrides'] {
  const next: NonNullable<TemplateDoc['overrides']> = {};
  for (const [sizeId, byEl] of Object.entries(overrides)) {
    const kept: Record<string, Partial<DocElement>> = {};
    for (const [elId, patch] of Object.entries(byEl)) {
      if (patch && Object.keys(patch).length > 0) kept[elId] = patch;
    }
    if (Object.keys(kept).length > 0) next[sizeId] = kept;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * Apply a style patch to one element at the chosen scope.
 *
 * `'all'` writes the shared element AND clears the same keys from every size's
 * overrides — otherwise a size that had diverged would keep its old value and the
 * edit would look like it silently didn't take.
 *
 * `'size'` writes only that size's override, leaving the other boards alone.
 */
export function applyElementPatch(
  doc: TemplateDoc,
  elId: string,
  patch: Partial<DocElement>,
  scope: EditScope,
  sizeId: string,
): TemplateDoc {
  const keys = overridableKeys(patch);
  // A patch touching shared-only keys (content, show-for, layer name) writes the
  // element itself whatever the scope — there's nowhere else for it to go.
  const sharedOnly = (Object.keys(patch) as (keyof DocElement)[]).filter((k) => NEVER_OVERRIDE.has(k));
  if (sharedOnly.length) {
    const sharedPatch = Object.fromEntries(sharedOnly.map((k) => [k, patch[k]])) as Partial<DocElement>;
    const withShared = {
      ...doc,
      elements: doc.elements.map((e) => (e.id === elId ? { ...e, ...sharedPatch } : e)),
    };
    if (!keys.length) return withShared;
    const rest = Object.fromEntries(keys.map((k) => [k, patch[k]])) as Partial<DocElement>;
    return applyElementPatch(withShared, elId, rest, scope, sizeId);
  }
  if (!keys.length) return doc;

  if (scope === 'all') {
    const elements = doc.elements.map((e) => (e.id === elId ? { ...e, ...patch } : e));
    if (!doc.overrides) return { ...doc, elements };
    const cleared: NonNullable<TemplateDoc['overrides']> = {};
    for (const [sid, byEl] of Object.entries(doc.overrides)) {
      const existing = byEl[elId];
      if (!existing) {
        cleared[sid] = byEl;
        continue;
      }
      const rest = { ...existing };
      for (const k of keys) delete rest[k];
      cleared[sid] = { ...byEl, [elId]: rest };
    }
    return { ...doc, elements, overrides: pruneOverrides(cleared) };
  }

  const forSize = doc.overrides?.[sizeId] ?? {};
  const merged = { ...(forSize[elId] ?? {}), ...patch };
  for (const k of NEVER_OVERRIDE) delete merged[k];
  return {
    ...doc,
    overrides: pruneOverrides({ ...doc.overrides, [sizeId]: { ...forSize, [elId]: merged } }),
  };
}

/** Send an element back to the shared style on this size (or on every size). */
export function clearElementOverride(
  doc: TemplateDoc,
  elId: string,
  sizeId: string | 'all',
): TemplateDoc {
  if (!doc.overrides) return doc;
  const next: NonNullable<TemplateDoc['overrides']> = {};
  for (const [sid, byEl] of Object.entries(doc.overrides)) {
    if (sid === sizeId || sizeId === 'all') {
      const { [elId]: _dropped, ...rest } = byEl;
      next[sid] = rest;
    } else {
      next[sid] = byEl;
    }
  }
  return { ...doc, overrides: pruneOverrides(next) };
}

/**
 * Box fields that broadcast under `'all'`: the fractional geometry.
 *
 * Fractions of the canvas mean the same box reads as the same relative PLACEMENT
 * on any aspect ratio, which is what makes broadcasting sensible at all. Size is
 * a different matter — see `rescaleBox`.
 */
const BROADCAST_BOX_KEYS = ['x', 'y', 'w', 'h'] as const;

/** How close to 1 a fraction has to be to count as running edge to edge. */
const EDGE_EPS = 0.001;

/**
 * Whether a box deliberately runs edge to edge on either axis.
 *
 * Full-bleed backgrounds, scrims and full-width text frames are MEANT to stretch
 * to whatever board they land on — re-deriving their height to preserve a shape
 * they never had would pull a background off the canvas. They keep the old
 * copy-the-fraction behaviour.
 */
function spansEdgeToEdge(box: DocLayoutBox): boolean {
  return box.w >= 1 - EDGE_EPS || box.h >= 1 - EDGE_EPS;
}

/**
 * Re-express one board's box on another board, preserving the element's SHAPE.
 *
 * THE BUG THIS FIXES. `w` is a fraction of the board's width and `h` a fraction
 * of its height. Copying the pair verbatim between boards of different aspect
 * ratios cannot preserve shape — it is arithmetically impossible. A 400×400
 * square set on a 1080×1080 board arrived as 444×233 on a 1200×628 landscape and
 * 400×711 on a 1080×1920 story: same fractions, three different shapes. Designers
 * hit this as "the size I set doesn't carry across artboards".
 *
 * The rule: `w` stays a fraction of width, so an element scales with the board's
 * width, and `h` is re-derived so the PIXEL aspect ratio matches the source. The
 * square above becomes 444×444 on landscape and 400×400 on story.
 *
 * `h` is clamped to the board — an element taller than the target can't preserve
 * its shape and not overflow, and overflowing is the worse failure. `y` follows
 * so a re-derived height can't push the box off the bottom.
 */
export function rescaleBox(
  box: DocLayoutBox,
  from: { width: number; height: number },
  to: { width: number; height: number },
): DocLayoutBox {
  const next = { ...box };
  if (spansEdgeToEdge(box)) return next;
  if (!(from.width > 0 && from.height > 0 && to.width > 0 && to.height > 0)) return next;
  const h = box.h * ((from.height * to.width) / (to.height * from.width));
  next.h = Math.min(1, h);
  next.y = Math.min(box.y, Math.max(0, 1 - next.h));
  return next;
}

/**
 * Push every element's geometry from one board onto all the others, preserving
 * shape — the repair action for templates laid out before `rescaleBox` existed,
 * whose stored boxes are already distorted and stay that way until rewritten.
 *
 * Boards that don't carry an element are left without it: re-fitting is not an
 * invitation to add elements to boards a designer deliberately left them off.
 * Per-board properties (`z`, `hidden`, framing, `fontSize`) are untouched, matching
 * what a normal broadcast leaves alone.
 */
export function refitAllSizes(doc: TemplateDoc, fromSizeId: string): TemplateDoc {
  const from = doc.sizes.find((s) => s.id === fromSizeId);
  if (!from) return doc;
  const source = doc.layouts[fromSizeId] ?? {};
  const layouts: TemplateDoc['layouts'] = { ...doc.layouts };
  for (const size of doc.sizes) {
    if (size.id === fromSizeId) continue;
    const target = doc.layouts[size.id];
    if (!target) continue;
    const next = { ...target };
    for (const [elId, box] of Object.entries(source)) {
      const prior = target[elId];
      if (!prior) continue;
      const fitted = rescaleBox(box, from, size);
      next[elId] = { ...prior, x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h };
    }
    layouts[size.id] = next;
  }
  return { ...doc, layouts };
}

/** Font size clamp, matching the builder's own stepper bounds. */
const MIN_FONT = 4;
const MAX_FONT = 400;

/**
 * Write a placement at the chosen scope.
 *
 * Under `'all'`:
 *   - fractional `x/y/w/h` are COPIED — a fraction means the same relative
 *     placement on any aspect ratio.
 *   - `fontSize` travels PROPORTIONALLY: each board's own size moves by the same
 *     ratio this one just changed by. Copying the number outright would push a
 *     1080-square's 108px headline onto a 300×250 banner and bury it, but "make it
 *     20% bigger everywhere" is exactly what asking for all sizes means.
 *   - `z`, `hidden`, `objectX/Y/Scale` stay on the board they were set on.
 *     Stacking and per-board omission are per-size by design, and per-size framing
 *     is the entire point of per-size framing.
 *
 * A size with no placement for the element yet is skipped rather than gaining
 * one: broadcasting a move shouldn't add the element to boards a designer
 * deliberately left it off.
 */
export function applyBox(
  doc: TemplateDoc,
  elId: string,
  box: DocLayoutBox,
  scope: EditScope,
  sizeId: string,
): TemplateDoc {
  if (scope === 'size') {
    return {
      ...doc,
      layouts: { ...doc.layouts, [sizeId]: { ...doc.layouts[sizeId], [elId]: box } },
    };
  }

  // How much the edited board's type just changed by, if it changed at all.
  const wasFont = doc.layouts[sizeId]?.[elId]?.fontSize;
  const nowFont = box.fontSize;
  const fontRatio =
    wasFont && nowFont && wasFont > 0 && nowFont !== wasFont ? nowFont / wasFont : null;

  // Geometry is re-derived per board rather than copied, so the element keeps its
  // shape on every aspect ratio (see rescaleBox).
  const from = doc.sizes.find((s) => s.id === sizeId);

  const layouts: TemplateDoc['layouts'] = {};
  for (const [sid, byEl] of Object.entries(doc.layouts)) {
    const prior = byEl[elId];
    if (sid === sizeId) {
      layouts[sid] = { ...byEl, [elId]: box };
      continue;
    }
    if (!prior) {
      layouts[sid] = byEl;
      continue;
    }
    const to = doc.sizes.find((s) => s.id === sid);
    const fitted = from && to ? rescaleBox(box, from, to) : box;
    const next = { ...prior };
    for (const k of BROADCAST_BOX_KEYS) next[k] = fitted[k];
    if (fontRatio && prior.fontSize) {
      next.fontSize = Math.min(MAX_FONT, Math.max(MIN_FONT, Math.round(prior.fontSize * fontRatio)));
    }
    layouts[sid] = { ...byEl, [elId]: next };
  }
  return { ...doc, layouts };
}
