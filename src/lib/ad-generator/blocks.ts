/**
 * Reusable "blocks" — a saved cluster of builder elements (e.g. a Lease/APR
 * offer block) a designer can insert instead of rebuilding it every time.
 *
 * Pure helpers (no React/prisma) shared by the builder and the blocks API, so
 * the save/insert geometry + field-seeding is testable in isolation.
 *
 * Geometry note: a block is a LOCKUP, not a bag of elements — see
 * `insertBlockIntoDoc`. `doc.layouts` boxes are normalized 0–1 fractions, and
 * copying those fractions element-by-element between boards of different shapes
 * is what used to pull a block apart.
 */
import type { AdData, FieldSpec } from './types';
import type { DocElement, DocLayoutBox, TemplateDoc } from './doc-types';
import { addFieldKit } from './vehicle-fields';
import { offerKindForDoc, type OfferKind } from './offer-kinds';
import { rescaleBox, sizeFitOf } from './size-scope';

export const BLOCK_PAYLOAD_VERSION = 1;

export interface BlockPayload {
  version: number;
  /** Source artboard pixel size — used to scale `fontSize` into other sizes. */
  sourceSize: { w: number; h: number };
  /** The block's elements. Their `id`s are keys into `boxes`; regenerated on insert. */
  elements: DocElement[];
  /** Normalized box (from the source size) per element id. */
  boxes: Record<string, DocLayoutBox>;
  /** Which offer field kit the bindings need re-seeded on insert (offer blocks). */
  offerKit: 'single' | 'dual' | null;
  /** Non-offer field specs the bindings reference, re-seeded on insert. */
  requiredFields: FieldSpec[];
  /** Starter defaults for `requiredFields`, keyed by field key. */
  requiredDefaults: AdData;
  /** Element groups the block's elements belong to (+ their ancestor groups),
   *  re-created with FRESH ids on insert so a saved group stays grouped. Absent
   *  on blocks saved before this was added — treated as an empty list. */
  groups?: NonNullable<TemplateDoc['groups']>;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * A member that is NOT part of the lockup's internal spacing.
 *
 * A full-bleed backdrop or a croppable photo inside a block is scenery: it is
 * meant to fill whatever board it lands on, so it keeps the per-element
 * treatment (`rescaleBox`) and is left out of the block's bounding box — a
 * background stretching edge to edge would otherwise BE the bounding box and
 * every real member would be positioned relative to the whole canvas.
 */
function isScenery(el: DocElement, box: DocLayoutBox): boolean {
  return sizeFitOf(el).bleed || box.w >= 0.999 || box.h >= 0.999;
}

/** The lockup's bounding box in SOURCE pixels, or null if it has no members. */
function lockupBounds(
  payload: BlockPayload,
): { l: number; t: number; w: number; h: number } | null {
  const { w: W, h: H } = payload.sourceSize;
  if (!(W > 0 && H > 0)) return null;
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (const el of payload.elements) {
    const box = payload.boxes[el.id];
    if (!box || isScenery(el, box)) continue;
    l = Math.min(l, box.x * W);
    t = Math.min(t, box.y * H);
    r = Math.max(r, (box.x + box.w) * W);
    b = Math.max(b, (box.y + box.h) * H);
  }
  return r > l && b > t ? { l, t, w: r - l, h: b - t } : null;
}

/** Field-binding keys referenced by the given elements. */
function fieldKeysOf(elements: DocElement[]): string[] {
  const keys: string[] = [];
  for (const el of elements) {
    if (el.binding?.kind === 'field' && el.binding.key) keys.push(el.binding.key);
  }
  return keys;
}

/** Detect which offer kit (if any) the bindings depend on. */
function detectOfferKit(fieldKeys: string[]): 'single' | 'dual' | null {
  const hasOffer2 = fieldKeys.some((k) => k.startsWith('_o2_') || k.startsWith('o2_'));
  if (hasOffer2) return 'dual';
  const hasOffer1 = fieldKeys.some((k) => k === '_offerMain' || k === '_offerLabel' || k === '_offerTerms');
  return hasOffer1 ? 'single' : null;
}

/**
 * Build a saved block payload from the current selection. `selectedIds` are the
 * elements to capture; boxes are read from the currently-active size.
 */
export function buildBlockPayload(
  doc: TemplateDoc,
  selectedIds: string[],
  activeSizeId: string,
): BlockPayload | null {
  const idSet = new Set(selectedIds);
  // Preserve document order (z/stacking sanity), not click order.
  const elements = doc.elements.filter((e) => idSet.has(e.id)).map((e) => structuredClone(e));
  if (elements.length === 0) return null;

  const sizeLayout = doc.layouts[activeSizeId] ?? {};
  const boxes: Record<string, DocLayoutBox> = {};
  for (const el of elements) {
    const box = sizeLayout[el.id];
    if (box) boxes[el.id] = { ...box };
  }
  const size = doc.sizes.find((s) => s.id === activeSizeId) ?? doc.sizes[0];
  const sourceSize = { w: size?.width ?? 1080, h: size?.height ?? 1080 };

  const fieldKeys = fieldKeysOf(elements);
  const offerKit = detectOfferKit(fieldKeys);

  // Capture any real (non-computed) fields the bindings reference, plus their
  // starter defaults, so the block seeds them wherever it's inserted.
  const referenced = new Set(fieldKeys);
  const requiredFields = doc.fields.filter((f) => referenced.has(f.key));
  const requiredDefaults: AdData = {};
  for (const f of requiredFields) {
    if (doc.defaults[f.key] != null) requiredDefaults[f.key] = doc.defaults[f.key];
  }

  // Capture the groups the selection belongs to, walking up each element's
  // groupId → parentId chain so nested grouping is preserved on insert.
  const groupIds = new Set<string>();
  for (const el of elements) {
    let gid = el.groupId;
    while (gid && !groupIds.has(gid)) {
      groupIds.add(gid);
      gid = doc.groups?.find((g) => g.id === gid)?.parentId;
    }
  }
  const groups = (doc.groups ?? []).filter((g) => groupIds.has(g.id));

  return { version: BLOCK_PAYLOAD_VERSION, sourceSize, elements, boxes, offerKit, requiredFields, requiredDefaults, groups };
}

/** Merge missing fields + defaults into a doc (never overwrites existing). */
function mergeFields(doc: TemplateDoc, fields: FieldSpec[], defaults: AdData): TemplateDoc {
  const have = new Set(doc.fields.map((f) => f.key));
  const add = fields.filter((f) => !have.has(f.key));
  const mergedDefaults = { ...doc.defaults };
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in mergedDefaults)) mergedDefaults[k] = v;
  }
  if (add.length === 0) return { ...doc, defaults: mergedDefaults };
  return { ...doc, fields: [...doc.fields, ...add], defaults: mergedDefaults };
}

/**
 * Insert a block into a doc: clone its elements with fresh ids, place them on
 * EVERY size, bump z above everything, nudge the cluster so it doesn't sit
 * exactly on top of existing content, then re-seed any fields the bindings need.
 * Returns the next doc and the new element ids (for selecting them).
 *
 * ── A block is a LOCKUP ──────────────────────────────────────────────────────
 *
 * Its members are placed RELATIVE TO THE BLOCK, not relative to the board: the
 * lockup's bounding box is scaled by the board's width ratio, and every member
 * sits at its own offset inside that box, scaled by the same factor. So the gaps
 * between a price and its disclaimer are the same multiple of the type size on
 * every artboard, which is the whole reason a designer saved the cluster.
 *
 * Placing each member independently — copying its `x`/`y` fractions and letting
 * `rescaleBox` re-derive its size — is what this replaces, and it destroyed
 * every block it touched. Measured on the shipped "Sale Price" block, inserted
 * once: the gap between the price and the MSRP line came out 43px on a
 * 1080×1080, 261px on a 1080×1920, and MINUS 1px (overlapping) on a 300×250.
 * Each element was individually the right size; the arrangement was gone.
 * The cause is arithmetic, not tuning — `y` is a fraction of the board's HEIGHT,
 * so on a taller board every member drifts down by more than its own size grows,
 * and on a squat one they collide.
 *
 * Two members opt out. Scenery (a full-bleed backdrop, a croppable photo) keeps
 * the per-element treatment, since it is meant to fill the board rather than
 * hold a position in the lockup. And a `sizeMode: 'fixed'` member keeps its
 * PIXEL size while still being placed at a scaled offset — a pinned badge is the
 * same object on every board, but where it sits in the lockup still travels.
 */
export function insertBlockIntoDoc(
  doc: TemplateDoc,
  payload: BlockPayload,
  makeId: (type: string) => string,
): { doc: TemplateDoc; newIds: string[] } {
  const OFFSET = 0.03;
  const idMap = new Map<string, string>();
  // Re-create the block's groups with FRESH ids so a saved group stays grouped
  // without colliding with the target doc's group ids.
  const groupIdMap = new Map<string, string>();
  for (const g of payload.groups ?? []) groupIdMap.set(g.id, makeId('group'));

  const newElements: DocElement[] = payload.elements.map((el) => {
    const id = makeId(el.type);
    idMap.set(el.id, id);
    const clone = structuredClone(el);
    clone.id = id;
    // Remap group membership to the freshly-created group. Drop it only if the
    // group wasn't captured (older block, or a partial selection).
    if (clone.groupId) {
      const remapped = groupIdMap.get(clone.groupId);
      if (remapped) clone.groupId = remapped;
      else delete clone.groupId;
    }
    return clone;
  });

  const newGroups: NonNullable<TemplateDoc['groups']> = (payload.groups ?? []).map((g) => ({
    ...g,
    id: groupIdMap.get(g.id)!,
    parentId: g.parentId ? groupIdMap.get(g.parentId) : undefined,
  }));

  const from = { width: payload.sourceSize.w, height: payload.sourceSize.h };
  const bounds = lockupBounds(payload);

  const layouts: TemplateDoc['layouts'] = { ...doc.layouts };
  for (const size of doc.sizes) {
    const sid = size.id;
    const existing = layouts[sid] ?? {};
    const maxZ = Object.values(existing).reduce((m, b) => Math.max(m, b.z ?? 0), 0);
    // The lockup — and the type inside it — scales by the WIDTH ratio, matching
    // how `rescaleBox` anchors geometry. It used to scale by HEIGHT while the
    // frame's fractions were copied untouched, so on a landscape board the frame
    // grew wider and shorter while the type shrank: the two moved in opposite
    // directions and the block broke.
    const widthScale = from.width ? size.width / from.width : 1;
    // Shrink (never grow) if the scaled lockup wouldn't fit the board. A block is
    // type and panels, so overflow here is a CUT, not a crop — unlike scenery,
    // which is allowed to hang off (see sizeFitOf's `bleed`).
    const fitScale = bounds
      ? Math.min(
          1,
          size.width / (bounds.w * widthScale),
          size.height / (bounds.h * widthScale),
        )
      : 1;
    const k = widthScale * Math.min(1, fitScale);
    // Where the lockup sits: its own top-left keeps its fractional position
    // (nudged off existing content), clamped so the whole cluster stays aboard.
    const blockW = bounds ? (bounds.w * k) / size.width : 0;
    const blockH = bounds ? (bounds.h * k) / size.height : 0;
    const originX = bounds
      ? clamp(bounds.l / from.width + OFFSET, 0, Math.max(0, 1 - blockW))
      : 0;
    const originY = bounds
      ? clamp(bounds.t / from.height + OFFSET, 0, Math.max(0, 1 - blockH))
      : 0;

    const next: Record<string, DocLayoutBox> = { ...existing };
    for (const el of payload.elements) {
      const box = payload.boxes[el.id];
      const newId = idMap.get(el.id);
      if (!box || !newId) continue;
      const fit = sizeFitOf(el);
      // The anti-overlap nudge must not undo a deliberate bleed: an element wider
      // or taller than the board has no in-bounds position to be clamped to, and
      // clamping it to 0 would slam a centred background against the top-left.
      const nudge = (pos: number, extent: number) =>
        extent >= 1 ? pos : clamp(pos + OFFSET, 0, 1 - extent);

      if (!bounds || isScenery(el, box)) {
        // Scenery: per-element, as before — it fills the board, it doesn't hold a
        // place in the lockup.
        const fitted = rescaleBox(box, from, size, fit);
        const fontSize =
          box.fontSize != null
            ? fit.mode === 'fixed'
              ? box.fontSize
              : Math.max(1, Math.round(box.fontSize * widthScale))
            : null;
        next[newId] = {
          ...fitted,
          x: nudge(fitted.x, fitted.w),
          y: nudge(fitted.y, fitted.h),
          z: (box.z ?? 0) + maxZ + 1,
          ...(fontSize != null ? { fontSize } : {}),
        };
        continue;
      }

      // A lockup member: offset inside the block, both scaled by the same factor.
      const offX = (box.x * from.width - bounds.l) * k;
      const offY = (box.y * from.height - bounds.t) * k;
      // Fixed keeps its real size (and its type) on every board; scale follows k.
      const wPx = box.w * from.width * (fit.mode === 'fixed' ? 1 : k);
      const hPx = box.h * from.height * (fit.mode === 'fixed' ? 1 : k);
      const fontSize =
        box.fontSize != null
          ? fit.mode === 'fixed'
            ? box.fontSize
            : Math.max(1, Math.round(box.fontSize * k))
          : null;
      next[newId] = {
        ...box,
        x: originX + offX / size.width,
        y: originY + offY / size.height,
        w: wPx / size.width,
        h: hPx / size.height,
        z: (box.z ?? 0) + maxZ + 1,
        ...(fontSize != null ? { fontSize } : {}),
      };
    }
    layouts[sid] = next;
  }

  let next: TemplateDoc = {
    ...doc,
    elements: [...doc.elements, ...newElements],
    layouts,
    ...(newGroups.length ? { groups: [...(doc.groups ?? []), ...newGroups] } : {}),
  };
  // ── The schema invariant ──────────────────────────────────────────────────
  //
  // A block may NEVER widen the doc's schema beyond what its offer kind
  // declares. Both merges below would otherwise do exactly that: the seeded
  // "Lease" / "APR offer" / "Vehicle offer block" rows carry `offerKit: 'single'`
  // and vehicle `requiredFields`, so inserting one into a GENERAL ad would graft
  // the vehicle offer schema onto a template that has no offer — the same class
  // of corruption `blankTemplateDoc` used to cause for every doc.
  //
  // The elements still insert either way. A binding to a field the kind doesn't
  // have renders blank, which is visible and fixable; a silently mutated schema
  // is neither. The builder also filters incompatible blocks out of the list
  // (see `blockFitsKind`) — this is the safety net behind that, for a block
  // inserted some other way.
  const kind = offerKindForDoc(doc);
  const declared = new Set(kind.fields.map((f) => f.key));
  if (payload.offerKit && kind.capabilities.dualOffer) next = addFieldKit(next, payload.offerKit);
  const allowed = payload.requiredFields.filter((f) => declared.has(f.key));
  if (allowed.length) next = mergeFields(next, allowed, payload.requiredDefaults);

  return { doc: next, newIds: [...idMap.values()] };
}

/**
 * Can this block be inserted into a doc of `kind` without losing anything?
 *
 * False when the block needs a field the kind doesn't declare — a vehicle offer
 * block on a general ad. Used to filter the builder's block list, so an
 * incompatible block is never offered rather than being offered and then
 * silently arriving half-wired (see the invariant in `insertBlockIntoDoc`).
 *
 * `offerKit` counts as a requirement: a block carrying one is built around the
 * offer question set.
 */
export function blockFitsKind(payload: BlockPayload, kind: OfferKind): boolean {
  if (payload.offerKit && !kind.capabilities.dualOffer) return false;
  const declared = new Set(kind.fields.map((f) => f.key));
  return payload.requiredFields.every((f) => declared.has(f.key));
}
