/**
 * Reusable "blocks" — a saved cluster of builder elements (e.g. a Lease/APR
 * offer block) a designer can insert instead of rebuilding it every time.
 *
 * Pure helpers (no React/prisma) shared by the builder and the blocks API, so
 * the save/insert geometry + field-seeding is testable in isolation.
 *
 * Geometry note: `doc.layouts` boxes are normalized 0–1 fractions, which are
 * size-agnostic — so a block's boxes apply to EVERY size in the target doc.
 * The only size-dependent value is `fontSize` (px), which we scale by the
 * artboard-height ratio between the source and target size.
 */
import type { AdData, FieldSpec } from './types';
import type { DocElement, DocLayoutBox, TemplateDoc } from './doc-types';
import { addFieldKit } from './vehicle-fields';

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
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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

  return { version: BLOCK_PAYLOAD_VERSION, sourceSize, elements, boxes, offerKit, requiredFields, requiredDefaults };
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
 * Insert a block into a doc: clone its elements with fresh ids, place their
 * (size-agnostic) boxes on EVERY size — scaling `fontSize` per size, bumping
 * z above everything, and nudging the cluster so it doesn't sit exactly on top
 * of existing content — then re-seed any fields the bindings need. Returns the
 * next doc and the new element ids (for selecting them).
 */
export function insertBlockIntoDoc(
  doc: TemplateDoc,
  payload: BlockPayload,
  makeId: (type: string) => string,
): { doc: TemplateDoc; newIds: string[] } {
  const OFFSET = 0.03;
  const idMap = new Map<string, string>();
  const newElements: DocElement[] = payload.elements.map((el) => {
    const id = makeId(el.type);
    idMap.set(el.id, id);
    const clone = structuredClone(el);
    clone.id = id;
    // A block is self-contained; drop group membership so it doesn't reference
    // a group that doesn't exist in the target doc.
    delete clone.groupId;
    return clone;
  });

  const layouts: TemplateDoc['layouts'] = { ...doc.layouts };
  for (const size of doc.sizes) {
    const sid = size.id;
    const existing = layouts[sid] ?? {};
    const maxZ = Object.values(existing).reduce((m, b) => Math.max(m, b.z ?? 0), 0);
    const scale = payload.sourceSize.h ? size.height / payload.sourceSize.h : 1;
    const next: Record<string, DocLayoutBox> = { ...existing };
    for (const el of payload.elements) {
      const box = payload.boxes[el.id];
      const newId = idMap.get(el.id);
      if (!box || !newId) continue;
      next[newId] = {
        ...box,
        x: clamp(box.x + OFFSET, 0, Math.max(0, 1 - box.w)),
        y: clamp(box.y + OFFSET, 0, Math.max(0, 1 - box.h)),
        z: (box.z ?? 0) + maxZ + 1,
        ...(box.fontSize != null ? { fontSize: Math.max(1, Math.round(box.fontSize * scale)) } : {}),
      };
    }
    layouts[sid] = next;
  }

  let next: TemplateDoc = { ...doc, elements: [...doc.elements, ...newElements], layouts };
  if (payload.offerKit) next = addFieldKit(next, payload.offerKit);
  if (payload.requiredFields.length) next = mergeFields(next, payload.requiredFields, payload.requiredDefaults);

  return { doc: next, newIds: [...idMap.values()] };
}
