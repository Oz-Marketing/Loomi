import type { DocElement, DocLayoutBox, SizeMode, TemplateDoc } from './doc-types';

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
 * `binding`, `visibleWhen` and `sizeMode` are here deliberately. WHAT an element shows, and
 * which offer types it belongs to, are properties of the template; letting them
 * drift per board would mean the co-op and preflight checks (which read the shared
 * elements) no longer describe what actually renders. Per-board omission already
 * has a home: `DocLayoutBox.hidden`, the eye in the Layers panel.
 *
 * `sizeMode` is the same argument for geometry: it says whether the element is
 * measured in board fractions or in real pixels, and a per-board answer to that
 * would mean "fixed 200×200" held on some boards and not others.
 */
const NEVER_OVERRIDE = new Set<keyof DocElement>([
  'id',
  'type',
  'groupId',
  'locked',
  'name',
  'binding',
  'visibleWhen',
  'sizeMode',
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

/** An element's sizing mode, with the compatibility default. */
export function sizeModeOf(el: Pick<DocElement, 'sizeMode'> | undefined): SizeMode {
  return el?.sizeMode ?? 'scale';
}

/**
 * How an element should be re-expressed on another board.
 *
 * Two independent questions, bundled so no call site can answer half of them —
 * every cross-board path (broadcast, re-fit, add-a-size, copy-layout,
 * insert-a-block) has to ask the same one.
 */
export interface SizeFit {
  /** Relative to the board, or pinned to real pixels. See {@link DocElement.sizeMode}. */
  mode: SizeMode;
  /**
   * May this element hang off the edge of the artboard?
   *
   * TRUE only where the content is a PHOTO the frame already crops — a
   * `background` element, or a `cover`/`tile` image. Holding one of those inside
   * the board is the wrong trade: a 486×864 hero photo squashed to 436×250 to
   * "fit" a leaderboard has been ruined, whereas the same photo at 436×776 simply
   * hangs off the top and bottom and the board crops it. That IS what a designer
   * means by a background image.
   *
   * FALSE everywhere else, deliberately — this is the narrow exception, not a new
   * default:
   *   • text — the frame drives the font fit, so a 3×-tall frame renders type 3×
   *     too big;
   *   • `contain` images and logos — they letterbox inside their box, so a box
   *     bigger than the board just pushes the mark off the edge;
   *   • plain shapes — a badge or a card behind some text is meant to sit ON the
   *     board, and shapes that genuinely bleed are nearly always edge-to-edge
   *     already, which `spansEdgeToEdge` exempts anyway.
   */
  bleed: boolean;
}

/** Whether this element's overflow is a crop (a feature) or a cut (a bug). */
function overflowIsCropped(el: Pick<DocElement, 'type' | 'fit'> | undefined): boolean {
  if (!el) return false;
  // A background's texture layer is a cover photo by default.
  if (el.type === 'background') return (el.fit ?? 'cover') !== 'contain';
  if (el.type === 'image' || el.type === 'logo') {
    // Matches the renderer's own default for these two: `contain`.
    const fit = el.fit ?? 'contain';
    return fit === 'cover' || fit === 'tile';
  }
  return false; // text, shape
}

/** The re-fit rules for one element. The single source of truth for all callers. */
export function sizeFitOf(el: Pick<DocElement, 'sizeMode' | 'type' | 'fit'> | undefined): SizeFit {
  return { mode: sizeModeOf(el), bleed: overflowIsCropped(el) };
}

/**
 * Place an extent on the target board, letting it hang off the edge when that is
 * the only way to keep the element's real size or shape.
 *
 * When the extent fits, `start` is preserved (nudged in only if it would run past
 * the far edge) — the long-standing behaviour, so nothing moves in the common
 * case. When it does not fit and the element may bleed, it overflows SYMMETRICALLY
 * about its old centre, so a background crops evenly instead of sliding to one
 * side. When it may not bleed, it fills the board exactly (`0..1`) rather than
 * keeping a stale negative offset — that combination used to leave a visible strip
 * of empty canvas at the bottom of a bleeding background.
 */
function placeExtent(start: number, oldExtent: number, extent: number, bleed: boolean) {
  if (extent <= 1) return { pos: Math.min(start, Math.max(0, 1 - extent)), extent };
  if (bleed) return { pos: start + oldExtent / 2 - extent / 2, extent };
  return { pos: 0, extent: 1 };
}

/**
 * Re-express one board's box on another board.
 *
 * THE BUG BEHIND ALL OF THIS. `w` is a fraction of the board's width and `h` a
 * fraction of its height. Copying the pair verbatim between boards of different
 * aspect ratios cannot preserve anything — it is arithmetically impossible. A
 * 400×400 square set on a 1080×1080 board arrived as 444×233 on a 1200×628
 * landscape and 400×711 on a 1080×1920 story: same fractions, three different
 * shapes. Designers hit this as "the size I set doesn't carry across artboards".
 *
 * There are two right answers to that, and which one applies is the element's
 * own {@link DocElement.sizeMode}:
 *
 * `'scale'` (default) — RELATIVE. `w` stays a fraction of width so the element
 * grows with the board, and `h` is re-derived so the PIXEL aspect ratio matches
 * the source. The square above becomes 444×444 on landscape and 400×400 on
 * story: same shape, board-appropriate size. Right for headlines, hero images,
 * anything that should feel proportionally the same.
 *
 * `'fixed'` — ABSOLUTE. Both edges are converted back to source pixels and
 * re-expressed on the target, so 200×200 stays 200×200 on a 500×500 and on a
 * 2000×500. Right for a logo lockup, a badge, a QR code, a legal plate — things
 * with a correct real size that a wide board has no business inflating.
 *
 * Position stays fractional in BOTH modes: a fraction means the same relative
 * placement on any aspect ratio, which is what makes broadcasting a move
 * sensible. Only the element's own extent is in question here.
 *
 * What happens when the result does not fit the target board is `fit.bleed`'s
 * call: a cover photo or a panel HANGS OFF the edge and is cropped (the point of
 * a background), while text and contained logos clamp to the board, because there
 * overflow cuts content instead of framing it. See {@link SizeFit}.
 */
export function rescaleBox(
  box: DocLayoutBox,
  from: { width: number; height: number },
  to: { width: number; height: number },
  fit: Partial<SizeFit> = {},
): DocLayoutBox {
  const { mode = 'scale', bleed = false } = fit;
  const next = { ...box };
  if (!(from.width > 0 && from.height > 0 && to.width > 0 && to.height > 0)) return next;
  if (mode === 'fixed') {
    // Straight pixel round-trip: source fraction → source px → target fraction.
    const across = placeExtent(box.x, box.w, (box.w * from.width) / to.width, bleed);
    const down = placeExtent(box.y, box.h, (box.h * from.height) / to.height, bleed);
    next.x = across.pos;
    next.w = across.extent;
    next.y = down.pos;
    next.h = down.extent;
    return next;
  }
  if (spansEdgeToEdge(box)) return next;
  const down = placeExtent(
    box.y,
    box.h,
    box.h * ((from.height * to.width) / (to.height * from.width)),
    bleed,
  );
  next.y = down.pos;
  next.h = down.extent;
  return next;
}

/**
 * The px font size a fixed element should carry on `to`, given the source board.
 *
 * A fixed element is meant to be the SAME object on every board, so its type is
 * pinned along with its frame — a 200×200 badge whose label shrank with the
 * board would be 200×200 with the wrong words in it. Scale-mode type is handled
 * separately (proportionally, in {@link applyBox}), because there the element
 * itself is a different size per board and the type has to follow.
 */
function pinnedFontSize(box: DocLayoutBox, prior: DocLayoutBox): number | undefined {
  return box.fontSize ?? prior.fontSize;
}

/**
 * Push every element's geometry from one board onto all the others, each element
 * re-derived by its own {@link DocElement.sizeMode} — the repair action for
 * templates laid out before this arithmetic existed, whose stored boxes are
 * already distorted and stay that way until something rewrites them.
 *
 * Boards that don't carry an element are left without it: re-fitting is not an
 * invitation to add elements to boards a designer deliberately left them off.
 * Per-board properties (`z`, `hidden`, framing) are untouched, matching what a
 * normal broadcast leaves alone — as is `fontSize` on SCALE elements, whose type
 * is hand-tuned per board. Fixed elements do take the source's font size, because
 * a fixed element is meant to be the same object everywhere, type included.
 */
export function refitAllSizes(doc: TemplateDoc, fromSizeId: string, onlyElId?: string): TemplateDoc {
  const from = doc.sizes.find((s) => s.id === fromSizeId);
  if (!from) return doc;
  const source = doc.layouts[fromSizeId] ?? {};
  const fitOf = new Map(doc.elements.map((e) => [e.id, sizeFitOf(e)]));
  const layouts: TemplateDoc['layouts'] = { ...doc.layouts };
  for (const size of doc.sizes) {
    if (size.id === fromSizeId) continue;
    const target = doc.layouts[size.id];
    if (!target) continue;
    const next = { ...target };
    for (const [elId, box] of Object.entries(source)) {
      if (onlyElId && elId !== onlyElId) continue;
      const prior = target[elId];
      if (!prior) continue;
      const fit = fitOf.get(elId) ?? { mode: 'scale' as const, bleed: false };
      const fitted = rescaleBox(box, from, size, fit);
      next[elId] = {
        ...prior,
        x: fitted.x,
        y: fitted.y,
        w: fitted.w,
        h: fitted.h,
        ...(fit.mode === 'fixed' ? { fontSize: pinnedFontSize(box, prior) } : {}),
      };
    }
    layouts[size.id] = next;
  }
  return { ...doc, layouts };
}

/**
 * Re-derive ONE element's geometry on every other board from `fromSizeId`.
 *
 * What the builder runs the moment a designer flips an element between Scale and
 * Fixed. Without it the new mode would only bite on the element's next geometry
 * edit — the designer would tick "Fixed", see nothing change on the board they
 * were complaining about, and reasonably conclude the switch does nothing.
 */
export function refitElementAcrossSizes(
  doc: TemplateDoc,
  elId: string,
  fromSizeId: string,
): TemplateDoc {
  return refitAllSizes(doc, fromSizeId, elId);
}

/** Font size clamp, matching the builder's own stepper bounds. */
const MIN_FONT = 4;
const MAX_FONT = 400;

/**
 * Write a placement at the chosen scope.
 *
 * Under `'all'`:
 *   - `x/y` are COPIED as fractions — a fraction means the same relative
 *     placement on any aspect ratio.
 *   - `w/h` are re-derived per board by the element's {@link DocElement.sizeMode}:
 *     SCALE keeps the shape at a board-appropriate size, FIXED keeps the literal
 *     pixels. See `rescaleBox`.
 *   - `fontSize` travels PROPORTIONALLY on a scale element: each board's own size
 *     moves by the same ratio this one just changed by. Copying the number
 *     outright would push a 1080-square's 108px headline onto a 300×250 banner and
 *     bury it, but "make it 20% bigger everywhere" is exactly what asking for all
 *     sizes means. On a FIXED element the number is copied outright, because a
 *     fixed element is the same object on every board.
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

  // Geometry is re-derived per board rather than copied, so the element keeps
  // either its shape or its pixels on every aspect ratio (see rescaleBox).
  const from = doc.sizes.find((s) => s.id === sizeId);
  const fit = sizeFitOf(doc.elements.find((e) => e.id === elId));

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
    const fitted = from && to ? rescaleBox(box, from, to, fit) : box;
    const next = { ...prior };
    for (const k of BROADCAST_BOX_KEYS) next[k] = fitted[k];
    if (fit.mode === 'fixed') {
      const pinned = pinnedFontSize(box, prior);
      if (pinned != null) next.fontSize = Math.min(MAX_FONT, Math.max(MIN_FONT, pinned));
    } else if (fontRatio && prior.fontSize) {
      next.fontSize = Math.min(MAX_FONT, Math.max(MIN_FONT, Math.round(prior.fontSize * fontRatio)));
    }
    layouts[sid] = { ...byEl, [elId]: next };
  }
  return { ...doc, layouts };
}
