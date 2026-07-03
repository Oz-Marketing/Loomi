import type { AdData, AdSize } from './types';
import type { TemplateDoc, DocElement, DocLayoutBox, Binding, GradientFill } from './doc-types';
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

/** Parse a hex color (`#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`) → channels + alpha
 *  (0..1). Returns null for non-hex input (e.g. an unresolved `'brand'` token). */
function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  if (h.length === 6) h += 'ff';
  if (h.length !== 8 || /[^0-9a-fA-F]/.test(h)) return null;
  const int = parseInt(h, 16);
  return { r: (int >>> 24) & 255, g: (int >>> 16) & 255, b: (int >>> 8) & 255, a: (int & 255) / 255 };
}

/** Apply a stop opacity (0–100) to an already brand-resolved color, folding it
 *  into any alpha the hex already carries. Returns the original color untouched
 *  when it ends up fully opaque, so plain solid stops stay as clean hex. */
function applyAlpha(color: string, opacityPct?: number): string {
  const pct = opacityPct == null ? 100 : Math.min(100, Math.max(0, opacityPct));
  const rgba = hexToRgba(color);
  if (!rgba) return color;
  const a = rgba.a * (pct / 100);
  if (a >= 1) return color;
  return `rgba(${rgba.r},${rgba.g},${rgba.b},${Number(a.toFixed(3))})`;
}

/** Normalized gradient — the single shape the renderer builds CSS from,
 *  regardless of whether the source used the new `gradientFill` or the legacy
 *  two-stop fields. */
interface NormGradient {
  type: 'linear' | 'radial';
  angle: number;
  radialShape: 'circle' | 'ellipse';
  center: [number, number];
  stops: { color: string; pos: number; opacity?: number }[];
}

/** Read a gradient from either the new `gradientFill` or the deprecated
 *  `gradient`/`gradientAngle`/`gradientStops` triple (so existing templates keep
 *  rendering). Returns null when the source has no gradient. */
function normalizeGradient(
  src:
    | {
        gradientFill?: GradientFill;
        gradient?: [string, string];
        gradientAngle?: number;
        gradientStops?: [number, number];
      }
    | undefined,
): NormGradient | null {
  if (!src) return null;
  const gf = src.gradientFill;
  if (gf && Array.isArray(gf.stops) && gf.stops.length >= 2) {
    return {
      type: gf.type === 'radial' ? 'radial' : 'linear',
      angle: gf.angle ?? 135,
      radialShape: gf.radialShape === 'circle' ? 'circle' : 'ellipse',
      center: gf.center ?? [50, 50],
      stops: gf.stops.map((s) => ({ color: s.color, pos: s.pos, opacity: s.opacity })),
    };
  }
  if (src.gradient) {
    const gs = src.gradientStops;
    return {
      type: 'linear',
      angle: src.gradientAngle ?? 135,
      radialShape: 'ellipse',
      center: [50, 50],
      stops: [
        { color: src.gradient[0], pos: gs?.[0] ?? 0 },
        { color: src.gradient[1], pos: gs?.[1] ?? 100 },
      ],
    };
  }
  return null;
}

/** Build a CSS gradient string from a normalized gradient. Colors are
 *  brand-resolved, alpha-folded, and escaped. */
function buildGradientCss(g: NormGradient, brand: string): string {
  const stops = [...g.stops]
    // CSS clamps a stop whose position trails the previous one — sort ascending
    // so a multi-stop editor that leaves stops out of order still renders right.
    .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
    .map((s) => {
      const col = esc(applyAlpha(resolveColor(s.color, brand, brand), s.opacity));
      return `${col} ${clamp01((s.pos ?? 0) / 100) * 100}%`;
    })
    .join(', ');
  if (g.type === 'radial') {
    const cx = clamp01((g.center[0] ?? 50) / 100) * 100;
    const cy = clamp01((g.center[1] ?? 50) / 100) * 100;
    return `radial-gradient(${g.radialShape} at ${cx}% ${cy}%, ${stops})`;
  }
  return `linear-gradient(${g.angle}deg, ${stops})`;
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
  // Element-level compositing: opacity (any type) + blend mode. When dimmed in
  // preview, the dim opacity wins so "hidden" stays legible; blend still applies.
  const opacityFx = el.opacity != null && el.opacity < 100 ? `opacity:${clamp01(el.opacity / 100)};` : '';
  const blendFx = el.blendMode && el.blendMode !== 'normal' ? `mix-blend-mode:${esc(el.blendMode)};` : '';
  const fx = (dim ? '' : opacityFx) + blendFx;
  const pos =
    `position:absolute;` +
    `left:${box.x * width}px;top:${box.y * height}px;` +
    `width:${box.w * width}px;height:${box.h * height}px;`;

  if (el.type === 'shape') {
    const kind = el.shapeKind ?? 'rect';
    // Gradient fill (multi-stop, linear/radial, per-stop alpha) mirrors the
    // canvas background; else a solid fill. Reads legacy fields for old templates.
    const grad = normalizeGradient(el);
    const bg = grad ? buildGradientCss(grad, brand) : esc(resolveColor(el.fill, brand, brand));
    // rect → rounded corners; ellipse → 50% radius; triangle/diamond/star → a
    // CSS clip-path silhouette on the filled box.
    const clip = SHAPE_CLIP[kind];
    const shapeStyle = clip
      ? `clip-path:${clip};`
      : kind === 'ellipse'
        ? 'border-radius:50%;'
        : `border-radius:${el.radius ?? 0}px;`;
    return `<div${idAttr} style="${dim}${fx}${pos}background:${bg};${shapeStyle}"></div>`;
  }

  if (el.type === 'image' || el.type === 'logo') {
    const url = esc(resolveBinding(el.binding, data));
    const minEdge = Math.min(box.w * width, box.h * height);
    if (!url) {
      // Empty image slot: nothing on export (an empty slot shouldn't leave a
      // dashed box in the finished ad — same as empty text). In the builder it's
      // a subtle placeholder so the designer sees where the image goes. Cap the
      // corner radius + label size so a full-bleed slot doesn't render a giant
      // rounded dashed border + oversized "Image" text across the whole artboard.
      if (!ctx.preview) return '';
      const phRadius = el.radius != null ? el.radius : Math.min(minEdge * 0.06, 16);
      const phFont = Math.min(minEdge * 0.14, 40);
      return `<div${idAttr} style="${dim}${fx}${pos}display:flex;align-items:center;justify-content:center;border:1.5px dashed #cbd5e1;border-radius:${phRadius}px;color:#94a3b8;font-size:${phFont}px;font-family:${brandStack};">${el.type === 'logo' ? 'Logo' : 'Image'}</div>`;
    }
    const fit = el.fit ?? 'contain';
    // Tile fill: repeat the image to fill the box (seamless textures/patterns).
    // Tile width is a fraction of the box width so density is size-independent.
    if (fit === 'tile') {
      const tilePct = Math.max(2, clamp01(el.tileScale ?? 0.25) * 100);
      const tileRadius = el.radius ? `border-radius:${el.radius}px;` : '';
      return `<div${idAttr} style="${dim}${fx}${pos}overflow:hidden;${tileRadius}background-image:url(${url});background-repeat:repeat;background-size:${tilePct}% auto;"></div>`;
    }
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
    return `<div${idAttr} style="${dim}${fx}${pos}overflow:hidden;${radius}"><img src="${url}" alt="" style="width:100%;height:100%;object-fit:${fit};object-position:${objectPos};${zoom}" /></div>`;
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
  return `<div${idAttr} style="${dim}${fx}${styles}">${value}</div>`;
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
  const bgGrad = normalizeGradient(bg);
  const bgCss = bgGrad
    ? buildGradientCss(bgGrad, brand)
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
