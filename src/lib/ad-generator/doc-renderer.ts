import type { AdData, AdSize } from './types';
import type { TemplateDoc, DocElement, DocLayoutBox, Binding } from './doc-types';
import { cssSafeFamily } from './fonts';

/**
 * The data-driven renderer: interprets a TemplateDoc into a full HTML document
 * sized to the ad. This is the SAME renderer the builder canvas uses and the
 * Puppeteer pipeline rasterizes — so what a designer lays out is exactly what
 * exports. Pure (no Node/browser-only imports) so it runs on both sides.
 */

/** Escape user data before it goes into HTML. */
function esc(v: string | undefined): string {
  return (v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveBinding(b: Binding | undefined, data: AdData): string {
  if (!b) return '';
  switch (b.kind) {
    case 'static':
      return b.value;
    case 'field':
      return data[b.key] ?? '';
    case 'brand':
      return data[b.key] ?? '';
  }
}

/** Resolve a color token: `'brand'` → the account color, else the hex, else fallback. */
function resolveColor(c: string | undefined, brand: string, fallback: string): string {
  if (!c) return fallback;
  return c === 'brand' ? brand : c;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}


/** A human-ish label for an empty binding, shown as a placeholder in preview mode. */
function bindingLabel(b: Binding | undefined): string {
  if (!b) return 'Text';
  if (b.kind === 'static') return b.value || 'Text';
  return b.key; // field key or brand key
}

/** A box entirely outside the artboard (0..1) is "detached" — omitted from the
 *  rendered ad (the builder keeps it as a canvas-only parking spot). */
function isBoxDetached(b: { x: number; y: number; w: number; h: number }): boolean {
  return b.x + b.w <= 0 || b.x >= 1 || b.y + b.h <= 0 || b.y >= 1;
}

/** CSS clip-path silhouettes for non-rectangular shapes (rect/ellipse use
 *  border-radius instead, so they're absent here). Shared by the export
 *  renderer and the builder's shape picker so both stay in sync. */
export const SHAPE_CLIP: Record<string, string | undefined> = {
  rect: undefined,
  ellipse: undefined,
  triangle: 'polygon(50% 0%, 100% 100%, 0% 100%)',
  diamond: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
  star: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
};

interface RenderCtx {
  width: number;
  height: number;
  brand: string;
  brandStack: string;
  /** Builder canvas: show empty text bindings as muted placeholders so every
   *  element stays visible + selectable. Off for export. */
  preview: boolean;
}

function renderElement(el: DocElement, box: DocLayoutBox, data: AdData, ctx: RenderCtx): string {
  const { width, height, brand, brandStack } = ctx;
  // data-el-id lets the builder find + move this node live during a drag.
  const idAttr = ` data-el-id="${esc(el.id)}"`;
  // In the builder, a hidden element is dimmed/blurred (still visible so it can
  // be re-shown) rather than removed; on export it's omitted entirely.
  const dim = ctx.preview && box.hidden ? 'opacity:0.35;filter:blur(1.5px);' : '';
  const pos =
    `position:absolute;` +
    `left:${box.x * width}px;top:${box.y * height}px;` +
    `width:${box.w * width}px;height:${box.h * height}px;`;

  if (el.type === 'shape') {
    const kind = el.shapeKind ?? 'rect';
    // Gradient fill mirrors the canvas background; else a solid fill.
    let bg: string;
    if (el.gradient) {
      const gs = el.gradientStops;
      const gs0 = clamp01((gs?.[0] ?? 0) / 100) * 100;
      const gs1 = clamp01((gs?.[1] ?? 100) / 100) * 100;
      bg = `linear-gradient(${el.gradientAngle ?? 135}deg, ${esc(resolveColor(el.gradient[0], brand, brand))} ${gs0}%, ${esc(resolveColor(el.gradient[1], brand, brand))} ${gs1}%)`;
    } else {
      bg = esc(resolveColor(el.fill, brand, brand));
    }
    // rect → rounded corners; ellipse → 50% radius; triangle/diamond/star → a
    // CSS clip-path silhouette on the filled box.
    const clip = SHAPE_CLIP[kind];
    const shapeStyle = clip
      ? `clip-path:${clip};`
      : kind === 'ellipse'
        ? 'border-radius:50%;'
        : `border-radius:${el.radius ?? 0}px;`;
    return `<div${idAttr} style="${dim}${pos}background:${bg};${shapeStyle}"></div>`;
  }

  if (el.type === 'image' || el.type === 'logo') {
    const url = esc(resolveBinding(el.binding, data));
    const minEdge = Math.min(box.w * width, box.h * height);
    // Designer-set opacity (0–100). Undefined / 100 = fully opaque.
    const opacity = el.opacity != null && el.opacity < 100 ? `opacity:${clamp01(el.opacity / 100)};` : '';
    if (!url) {
      // Empty image slot: nothing on export (an empty slot shouldn't leave a
      // dashed box in the finished ad — same as empty text). In the builder it's
      // a subtle placeholder so the designer sees where the image goes. Cap the
      // corner radius + label size so a full-bleed slot doesn't render a giant
      // rounded dashed border + oversized "Image" text across the whole artboard.
      if (!ctx.preview) return '';
      const phRadius = el.radius != null ? el.radius : Math.min(minEdge * 0.06, 16);
      const phFont = Math.min(minEdge * 0.14, 40);
      return `<div${idAttr} style="${dim}${opacity}${pos}display:flex;align-items:center;justify-content:center;border:1.5px dashed #cbd5e1;border-radius:${phRadius}px;color:#94a3b8;font-size:${phFont}px;font-family:${brandStack};">${el.type === 'logo' ? 'Logo' : 'Image'}</div>`;
    }
    const fit = el.fit ?? 'contain';
    // A cover image can carry a per-size focal point (object-position) so one
    // background frames correctly across aspect ratios; else sensible defaults.
    const objectPos =
      fit === 'cover' && (box.objectX != null || box.objectY != null)
        ? `${clamp01(box.objectX ?? 0.5) * 100}% ${clamp01(box.objectY ?? 0.5) * 100}%`
        : el.type === 'logo'
          ? 'left center'
          : 'center';
    // Corner radius rounds the image — the wrapper clips it via overflow:hidden.
    const radius = el.radius ? `border-radius:${el.radius}px;` : '';
    // Crop zoom — a cover image can be scaled up past its cover fit, pivoting on
    // the focal point so the designer's crop stays framed. The wrapper clips it.
    const cropScale = fit === 'cover' && box.objectScale && box.objectScale > 1 ? box.objectScale : 1;
    const zoom =
      cropScale > 1
        ? `transform:scale(${cropScale});transform-origin:${clamp01(box.objectX ?? 0.5) * 100}% ${clamp01(box.objectY ?? 0.5) * 100}%;`
        : '';
    return `<div${idAttr} style="${dim}${opacity}${pos}overflow:hidden;${radius}"><img src="${url}" alt="" style="width:100%;height:100%;object-fit:${fit};object-position:${objectPos};${zoom}" /></div>`;
  }

  // text
  let value = esc(resolveBinding(el.binding, data));
  let placeholder = false;
  if (!value) {
    if (!ctx.preview) return '';
    value = esc(bindingLabel(el.binding));
    placeholder = true;
  }
  const family = el.fontFamily ? `"${esc(el.fontFamily)}", ${brandStack}` : brandStack;
  const color = placeholder ? '#cbd5e1' : resolveColor(el.color, brand, '#0f172a');
  const items = el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start';
  const bg = !placeholder && el.bg ? `background:${esc(resolveColor(el.bg, brand, brand))};` : '';
  const padding = el.padding ? `padding:${el.padding}px;` : '';
  const radius = el.radius ? `border-radius:${el.radius}px;` : '';
  const styles =
    pos +
    `display:flex;flex-direction:column;justify-content:center;align-items:${items};` +
    `font-family:${family};font-size:${box.fontSize ?? 16}px;font-weight:${el.fontWeight ?? 400};` +
    `color:${esc(color)};text-align:${el.align ?? 'left'};line-height:${el.lineHeight ?? 1.1};` +
    (el.letterSpacing ? `letter-spacing:${el.letterSpacing}px;` : '') +
    (el.uppercase ? 'text-transform:uppercase;' : '') +
    bg +
    padding +
    radius +
    'overflow:hidden;';
  return `<div${idAttr} style="${dim}${styles}">${value}</div>`;
}

/** Render a TemplateDoc + data at a given size into a full HTML document. */
export function renderDoc(doc: TemplateDoc, data: AdData, size: AdSize, opts?: { preview?: boolean }): string {
  const { width, height } = size;
  const brand = (data.brandColor && esc(data.brandColor)) || '#4f46e5';

  const fontFamily = cssSafeFamily(data.fontFamily ?? '');
  const fontFaceCss = data.fontFaceCss ?? '';
  const brandStack = `${fontFamily ? `"${fontFamily}", ` : ''}-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
  const ctx: RenderCtx = { width, height, brand, brandStack, preview: opts?.preview ?? false };

  const layout = doc.layouts[size.id] ?? {};
  const body = doc.elements
    .map((el) => ({ el, box: layout[el.id] }))
    // Keep hidden elements in PREVIEW (dimmed); drop them on export. Elements
    // dragged fully off the artboard are "detached" (a canvas-only parking spot
    // in the builder) — never part of the rendered ad, so drop them here too.
    .filter(
      (x): x is { el: DocElement; box: DocLayoutBox } =>
        Boolean(x.box) && (ctx.preview || !x.box!.hidden) && !isBoxDetached(x.box!),
    )
    .sort((a, b) => (a.box.z ?? 0) - (b.box.z ?? 0))
    .map(({ el, box }) => renderElement(el, box, data, ctx))
    .join('\n');

  // Canvas base fill (solid / gradient) + optional brand accent bar. A
  // background IMAGE is a normal full-bleed image element/layer now — not a
  // doc-level field — so it flows through renderElement like everything else.
  const bg = doc.background;
  const gStops = bg?.gradientStops;
  const s0 = clamp01((gStops?.[0] ?? 0) / 100) * 100;
  const s1 = clamp01((gStops?.[1] ?? 100) / 100) * 100;
  const bgCss = bg?.gradient
    ? `linear-gradient(${bg.gradientAngle ?? 135}deg, ${esc(bg.gradient[0])} ${s0}%, ${esc(bg.gradient[1])} ${s1}%)`
    : bg?.color
      ? esc(bg.color)
      : '#ffffff';
  const accentBar = bg?.accentBar
    ? `<div style="position:absolute;top:0;left:0;right:0;height:${Math.max(4, Math.min(width, height) / 80)}px;background:${brand};"></div>`
    : '';

  return `<!doctype html>
<html>
<head><meta charset="utf-8" />
<style>
  ${fontFaceCss}
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${width}px; height:${height}px; }
  .ad { width:${width}px; height:${height}px; position:relative; overflow:hidden; background:${bgCss}; }
</style></head>
<body><div class="ad">${accentBar}${body}</div></body>
</html>`;
}
