import type { AdData, AdSize } from './types';
import type { TemplateDoc, DocElement, DocLayoutBox, Binding, DocBgOverlay } from './doc-types';
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

/** `#rgb` / `#rrggbb` → `rgba(r,g,b,a)`. Falls back to black on a bad hex. */
function hexToRgba(hex: string, alpha: number): string {
  let h = (hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const ok = /^[0-9a-fA-F]{6}$/.test(h);
  const r = ok ? parseInt(h.slice(0, 2), 16) : 0;
  const g = ok ? parseInt(h.slice(2, 4), 16) : 0;
  const b = ok ? parseInt(h.slice(4, 6), 16) : 0;
  return `rgba(${r},${g},${b},${clamp01(alpha)})`;
}

/** CSS for the legibility scrim drawn over the background image. */
function overlayCss(o: DocBgOverlay): string {
  const color = o.color ?? '#000000';
  const op = clamp01(o.opacity ?? 0.4);
  const solid = hexToRgba(color, op);
  const clear = hexToRgba(color, 0);
  if (o.direction === 'top') return `linear-gradient(to bottom, ${solid} 0%, ${clear} 60%)`;
  if (o.direction === 'bottom') return `linear-gradient(to top, ${solid} 0%, ${clear} 60%)`;
  return solid; // 'full' / default — even tint
}

/** A human-ish label for an empty binding, shown as a placeholder in preview mode. */
function bindingLabel(b: Binding | undefined): string {
  if (!b) return 'Text';
  if (b.kind === 'static') return b.value || 'Text';
  return b.key; // field key or brand key
}

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
    const fill = resolveColor(el.fill, brand, brand);
    return `<div${idAttr} style="${dim}${pos}background:${esc(fill)};border-radius:${el.radius ?? 0}px;"></div>`;
  }

  if (el.type === 'image' || el.type === 'logo') {
    const url = esc(resolveBinding(el.binding, data));
    const minEdge = Math.min(box.w * width, box.h * height);
    if (!url) {
      // Empty slot placeholder so the builder canvas shows where it goes.
      return `<div${idAttr} style="${dim}${pos}display:flex;align-items:center;justify-content:center;border:2px dashed #cbd5e1;border-radius:${minEdge * 0.06}px;color:#cbd5e1;font-size:${minEdge * 0.14}px;font-family:${brandStack};">${el.type === 'logo' ? 'Logo' : 'Image'}</div>`;
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
    return `<div${idAttr} style="${dim}${pos}overflow:hidden;"><img src="${url}" alt="" style="width:100%;height:100%;object-fit:${fit};object-position:${objectPos};" /></div>`;
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
    // Keep hidden elements in PREVIEW (dimmed); drop them on export.
    .filter((x): x is { el: DocElement; box: DocLayoutBox } => Boolean(x.box) && (ctx.preview || !x.box!.hidden))
    .sort((a, b) => (a.box.z ?? 0) - (b.box.z ?? 0))
    .map(({ el, box }) => renderElement(el, box, data, ctx))
    .join('\n');

  const bg = doc.background;
  const bgCss = bg?.gradient
    ? `linear-gradient(135deg, ${esc(bg.gradient[0])} 0%, ${esc(bg.gradient[1])} 100%)`
    : bg?.color
      ? esc(bg.color)
      : '#ffffff';

  // Full-bleed background image (cover) + per-size focal point. The image
  // always fills the canvas; framing chooses WHAT stays in frame so one image
  // works across every aspect ratio. `zoom` scales in toward the focal point.
  const bgImageUrl = esc(resolveBinding(bg?.image, data));
  let bgImage = '';
  let scrim = '';
  if (bgImageUrl) {
    const fr = doc.bgFraming?.[size.id] ?? {};
    const fx = clamp01(fr.x ?? 0.5) * 100;
    const fy = clamp01(fr.y ?? 0.5) * 100;
    const zoom = Math.max(1, Number.isFinite(fr.zoom as number) ? (fr.zoom as number) : 1);
    const scale = zoom !== 1 ? `transform:scale(${zoom});transform-origin:${fx}% ${fy}%;` : '';
    bgImage = `<img src="${bgImageUrl}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:${fx}% ${fy}%;${scale}" />`;
    if (bg?.overlay) scrim = `<div style="position:absolute;inset:0;background:${overlayCss(bg.overlay)};"></div>`;
  }

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
<body><div class="ad">${bgImage}${scrim}${accentBar}${body}</div></body>
</html>`;
}
