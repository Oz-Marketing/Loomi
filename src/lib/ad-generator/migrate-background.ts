import type { TemplateDoc, DocElement } from './doc-types';

/**
 * Retire a doc's legacy doc-level `doc.background` fill by converting it into a
 * full-bleed `shape` element (solid or gradient) at the back — so the one way to
 * set a background is a plain Image/Shape layer, and the old canvas-fill path
 * can be dropped.
 *
 * - Solid `color` → the element's `fill`.
 * - `gradientFill` (new) or the legacy `gradient`/`gradientAngle`/`gradientStops`
 *   → the element's `gradientFill`.
 * - `accentBar` (a separate feature, not a fill) is preserved on `doc.background`.
 * - The element is placed full-bleed (0,0,1,1) behind everything on every size.
 *
 * Idempotent: a doc that already has any `background` element (already migrated,
 * or authored with the new model) is returned unchanged. A doc whose background
 * has no fill (empty, or accentBar-only) is left unchanged.
 *
 * Pure — no DB. The migration script maps this over saved AdTemplateDoc /
 * AdCreative rows.
 */
export function migrateDocBackground(doc: TemplateDoc): { doc: TemplateDoc; changed: boolean } {
  const bg = doc.background;
  const hasFill = !!(bg && (bg.color || bg.gradient || bg.gradientFill));
  const id = 'background-migrated';
  const alreadyMigrated = doc.elements.some((e) => e.id === id);
  if (!hasFill || alreadyMigrated) return { doc, changed: false };

  const el: DocElement = { id, type: 'shape', name: 'Background' };
  if (bg!.gradientFill) {
    el.gradientFill = bg!.gradientFill;
  } else if (bg!.gradient) {
    el.gradientFill = {
      type: 'linear',
      angle: bg!.gradientAngle ?? 135,
      stops: [
        { color: bg!.gradient[0], pos: bg!.gradientStops?.[0] ?? 0 },
        { color: bg!.gradient[1], pos: bg!.gradientStops?.[1] ?? 100 },
      ],
    };
  } else if (bg!.color) {
    el.fill = bg!.color;
  }

  const layouts: TemplateDoc['layouts'] = { ...doc.layouts };
  for (const s of doc.sizes) {
    const cur = layouts[s.id] ?? {};
    const minZ = Object.values(cur).reduce((m, b) => Math.min(m, b.z ?? 0), 0);
    layouts[s.id] = { ...cur, [id]: { x: 0, y: 0, w: 1, h: 1, z: minZ - 1 } };
  }

  // Keep accentBar (a separate top-bar feature); drop the fill fields.
  const nextBackground = bg!.accentBar ? { accentBar: true } : undefined;

  return {
    doc: { ...doc, elements: [...doc.elements, el], layouts, background: nextBackground },
    changed: true,
  };
}
