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

/** Add thousands separators to a plain numeric string ("2999" → "2,999",
 *  "28995.5" → "28,995.5"). Leaves already-formatted or non-numeric values
 *  ("$2,999", "36 months") untouched. */
function withThousands(v: string): string {
  const s = String(v).trim();
  const m = s.match(/^(-?)(\d{4,})(\.\d+)?$/); // 4+ digits so short ids/years aren't grouped
  if (!m) return v;
  const [, sign, intPart, dec = ''] = m;
  return sign + Number(intPart).toLocaleString('en-US') + dec;
}

/** Replace `{{ field }}` tokens in text with live values, so a designer can
 *  write a whole sentence ("With {{dueAtSigning}} due at signing") or a
 *  disclaimer in ONE text block. Tokens resolve against the merged data
 *  (form fields, computed `_offer*` tokens, brand values); number-typed fields
 *  are comma-formatted. An unknown/empty token renders as nothing. */
function interpolateTokens(text: string, data: AdData, numberKeys: Set<string>): string {
  if (!text.includes('{{')) return text;
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const raw = data[key];
    if (raw == null || raw === '') return '';
    return numberKeys.has(key) ? withThousands(raw) : raw;
  });
}

/** Resolve a color token: `'brand'` → the account color, else the hex, else fallback. */
function resolveColor(c: string | undefined, brand: string, fallback: string): string {
  if (!c) return fallback;
  return c === 'brand' ? brand : c;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/**
 * `border-radius` declaration for an element. Emits a four-value radius when any
 * per-corner override is set (TL TR BR BL), each falling back to the all-corners
 * `radius` then 0; otherwise the single `radius`. Returns '' when fully square.
 */
function borderRadiusCss(el: DocElement): string {
  const { radiusTL, radiusTR, radiusBR, radiusBL, radius } = el;
  if (radiusTL != null || radiusTR != null || radiusBR != null || radiusBL != null) {
    const c = (v?: number) => `${Math.max(0, v ?? radius ?? 0)}px`;
    return `border-radius:${c(radiusTL)} ${c(radiusTR)} ${c(radiusBR)} ${c(radiusBL)};`;
  }
  return radius ? `border-radius:${radius}px;` : '';
}

/** Per-side-aware `padding` declaration. Emits a four-value padding (top right
 *  bottom left) when any per-side override is set, each falling back to the
 *  all-sides `padding` then 0; otherwise the single `padding`. '' when none. */
function paddingCss(el: DocElement): string {
  const { paddingTop, paddingRight, paddingBottom, paddingLeft, padding } = el;
  if (paddingTop != null || paddingRight != null || paddingBottom != null || paddingLeft != null) {
    const p = (v?: number) => `${Math.max(0, v ?? padding ?? 0)}px`;
    return `padding:${p(paddingTop)} ${p(paddingRight)} ${p(paddingBottom)} ${p(paddingLeft)};`;
  }
  return padding ? `padding:${padding}px;` : '';
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
  /** Keys of number-typed fields — their values render with thousands commas. */
  numberKeys: Set<string>;
}

function renderElement(el: DocElement, box: DocLayoutBox, data: AdData, ctx: RenderCtx): string {
  const { width, height, brand, brandStack } = ctx;
  // data-el-id lets the builder find + move this node live during a drag.
  const idAttr = ` data-el-id="${esc(el.id)}"`;
  // In the builder, a hidden element is dimmed/blurred (still visible so it can
  // be selected) rather than removed; on export it's omitted.
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

  if (el.type === 'background') {
    // Unified full-bleed background: composite base fill → texture → fade overlay
    // inside one element. Replaces the old doc-level canvas fill + bg image.
    const layers: string[] = [];
    // 1. Base fill (solid or gradient).
    const baseGrad = normalizeGradient(el);
    const baseBg = baseGrad ? buildGradientCss(baseGrad, brand) : el.fill ? esc(resolveColor(el.fill, brand, brand)) : '';
    if (baseBg) layers.push(`<div style="position:absolute;inset:0;background:${baseBg};"></div>`);
    // 2. Texture image (cover / contain / tile), with its own opacity.
    const texUrl = esc(resolveBinding(el.binding, data));
    if (texUrl) {
      const texOp = el.bgImageOpacity != null && el.bgImageOpacity < 100 ? `opacity:${clamp01(el.bgImageOpacity / 100)};` : '';
      if ((el.fit ?? 'cover') === 'tile') {
        const tilePct = Math.max(2, clamp01(el.tileScale ?? 0.25) * 100);
        layers.push(`<div style="position:absolute;inset:0;${texOp}background-image:url(${texUrl});background-repeat:repeat;background-size:${tilePct}% auto;"></div>`);
      } else {
        const objPos = box.objectX != null || box.objectY != null ? `${clamp01(box.objectX ?? 0.5) * 100}% ${clamp01(box.objectY ?? 0.5) * 100}%` : 'center';
        layers.push(`<div style="position:absolute;inset:0;overflow:hidden;${texOp}"><img src="${texUrl}" alt="" style="width:100%;height:100%;object-fit:${el.fit ?? 'cover'};object-position:${objPos};" /></div>`);
      }
    }
    // 3. Fade / overlay gradient on top.
    if (el.overlay) {
      const ov = normalizeGradient({ gradientFill: el.overlay });
      if (ov) layers.push(`<div style="position:absolute;inset:0;background:${buildGradientCss(ov, brand)};"></div>`);
    }
    const radius = borderRadiusCss(el);
    return `<div${idAttr} style="${dim}${fx}${pos}overflow:hidden;${radius}">${layers.join('')}</div>`;
  }

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
        : borderRadiusCss(el);
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
      const tileRadius = borderRadiusCss(el);
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
    const radius = borderRadiusCss(el);
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
  let raw = resolveBinding(el.binding, data);
  // Replace {{field}} tokens so one text block can be a full sentence/disclaimer.
  raw = interpolateTokens(raw, data, ctx.numberKeys);
  // A text element bound directly to a number field renders with thousands commas.
  if (el.binding?.kind === 'field' && ctx.numberKeys.has(el.binding.key)) raw = withThousands(raw);
  let value = esc(raw);
  let placeholder = false;
  if (!value) {
    if (!ctx.preview) return '';
    value = esc(bindingLabel(el.binding));
    placeholder = true;
  }
  // Quote family names with SINGLE quotes: this whole style string is injected
  // into a double-quoted HTML `style="…"` attribute, so a double-quoted family
  // ("Verdana") would close the attribute early and drop the font (and every
  // declaration after it). cssSafeFamily strips any quotes/semicolons from the
  // name so it's safe inside the single-quoted CSS string and the HTML attribute.
  const family = el.fontFamily ? `'${cssSafeFamily(el.fontFamily)}', ${brandStack}` : brandStack;
  const color = placeholder ? '#cbd5e1' : resolveColor(el.color, brand, '#0f172a');
  const items = el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start';
  const bg = !placeholder && el.bg ? `background:${esc(resolveColor(el.bg, brand, brand))};` : '';
  const padding = paddingCss(el); // per-side-aware
  // Per-corner-aware (buttons can set each corner independently, like shapes).
  const radius = borderRadiusCss(el);
  const common =
    `font-family:${family};font-size:${box.fontSize ?? 16}px;font-weight:${el.fontWeight ?? 400};` +
    `color:${esc(color)};text-align:${el.align ?? 'left'};line-height:${el.lineHeight ?? 1.1};` +
    (el.letterSpacing ? `letter-spacing:${el.letterSpacing}px;` : '') +
    (el.uppercase ? 'text-transform:uppercase;' : '') +
    bg +
    padding +
    radius;
  if (el.autoSize) {
    // HUG (default): the element sizes to its content (width:max-content, no wrap;
    // explicit newlines still break via white-space:pre) and is ANCHORED by
    // `align` — the box's left/center/right edge stays fixed while the text
    // grows from it. Hugs whatever value renders, incl. dynamic client data.
    // The stored w/h aren't a clamp here — they only drive the builder's handles.
    const anchorX = el.align === 'center' ? (box.x + box.w / 2) * width : el.align === 'right' ? (box.x + box.w) * width : box.x * width;
    const anchorY = (box.y + box.h / 2) * height;
    const shiftX = el.align === 'center' ? '-50%' : el.align === 'right' ? '-100%' : '0';
    const posAuto =
      `position:absolute;left:${anchorX}px;top:${anchorY}px;transform:translate(${shiftX},-50%);` +
      `width:max-content;max-width:none;white-space:pre;`;
    return `<div${idAttr} data-hug style="${dim}${fx}${posAuto}${common}">${value}</div>`;
  }
  // FIT TO BOX: a fixed W×H frame. The font auto-scales (fit script / builder
  // parent) so the text always fills/fits the frame and never overflows — for any
  // value, incl. dynamic client data — wrapping to the width, aligned by `align`
  // (horizontal) + `vAlign` (vertical). Text can't gap away from or collide with
  // neighbours as the value changes.
  const vItems = el.vAlign === 'top' ? 'flex-start' : el.vAlign === 'bottom' ? 'flex-end' : 'center';
  // A hair of breathing room so the trimmed ink (cap-height/baseline) doesn't
  // clip glyphs that slightly overshoot those edges — ascenders, digit tops.
  // Scales with the box (border-box, so it insets rather than grows the frame);
  // skipped when the element sets its own padding.
  const fitPad = paddingCss(el) ? '' : `padding:${Math.max(1, Math.round(Math.min(box.w * width, box.h * height) * 0.05))}px;`;
  const styles =
    pos +
    `display:flex;flex-direction:column;justify-content:${vItems};align-items:${items};` +
    fitPad +
    common +
    'overflow:hidden;';
  // WRAP: a fixed W×H frame like Fit, but the font stays at the element's chosen
  // size (no auto-scale). `data-wrap` keeps it out of the fit script/parent, so
  // it never rescales — the text just wraps at the frame width and is clipped by
  // overflow:hidden. Used for paragraph copy (disclaimers) that must stay legible.
  // The value lives in a `text-box`-trimmed inner box so the FRAME hugs the
  // glyph ink (cap height → alphabetic baseline), not the font's line box — this
  // kills the ascent/descent "leading" gap above and below the text (most
  // visible on big numbers like a price). It's inline-block + max-width:100% so
  // it still wraps at the frame width AND shrink-wraps to the ink for the fit to
  // measure. The fit script/parent measure THIS node, not a Range.
  const marker = el.wrap ? 'data-wrap' : 'data-fit';
  const inner = `<div data-fit-inner style="display:inline-block;max-width:100%;white-space:pre-wrap;text-box:trim-both cap alphabetic;">${value}</div>`;
  return `<div${idAttr} ${marker} style="${dim}${fx}${styles}">${inner}</div>`;
}

/** Render a TemplateDoc + data at a given size into a full HTML document. */
export function renderDoc(doc: TemplateDoc, data: AdData, size: AdSize, opts?: { preview?: boolean }): string {
  const { width, height } = size;
  const brand = (data.brandColor && esc(data.brandColor)) || '#4f46e5';

  const fontFamily = cssSafeFamily(data.fontFamily ?? '');
  const fontFaceCss = data.fontFaceCss ?? '';
  // Google Fonts stylesheet (CSS2 API URL) for the live editor — gstatic serves
  // with permissive CORS so it loads fine in the srcdoc iframe. Exports don't use
  // this: they base64-embed the used families instead (no one-shot network race).
  const googleFontsUrl = typeof data.googleFontsUrl === 'string' ? data.googleFontsUrl : '';
  const googleLink =
    googleFontsUrl && /^https:\/\/fonts\.googleapis\.com\//.test(googleFontsUrl)
      ? `<link rel="stylesheet" href="${googleFontsUrl.replace(/"/g, '')}" />`
      : '';
  const brandStack = `${fontFamily ? `'${fontFamily}', ` : ''}-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
  const numberKeys = new Set(doc.fields.filter((f) => f.type === 'number').map((f) => f.key));
  const ctx: RenderCtx = { width, height, brand, brandStack, preview: opts?.preview ?? false, numberKeys };

  const layout = doc.layouts[size.id] ?? {};
  const body = doc.elements
    .map((el) => ({ el, box: layout[el.id] }))
    // Keep hidden elements in PREVIEW (dimmed); drop them on export. Elements
    // dragged fully off the artboard are "detached" (a canvas-only parking spot
    // in the builder) — never part of the rendered ad, so drop them here too.
    .filter(
      (x): x is { el: DocElement; box: DocLayoutBox } =>
        Boolean(x.box) &&
        (ctx.preview || !x.box!.hidden) &&
        !isBoxDetached(x.box!),
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

  // Fit-to-box text scales its font at render time so it fills/fits its fixed
  // frame. On EXPORT (Puppeteer parses scripts) this inline script does it; the
  // builder can't run it (it writes via innerHTML) and drives the same logic from
  // the parent. Exposed as window.__fitText so the exporter forces a final pass.
  const hasFit = body.includes('data-fit');
  const fitScript = hasFit ? `<script>${FIT_SCRIPT}</script>` : '';

  return `<!doctype html>
<html>
<head><meta charset="utf-8" />
${googleLink}
<style>
  ${fontFaceCss}
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${width}px; height:${height}px; }
  .ad { width:${width}px; height:${height}px; position:relative; overflow:hidden; background:${bgCss}; }
</style></head>
<body><div class="ad">${accentBar}${body}</div>${fitScript}</body>
</html>`;
}

// Injected verbatim (see renderDoc). For each [data-fit] element, binary-search
// the font size so the (wrapped) text is as large as possible while fitting the
// box's inner width AND height — it fills/fits the fixed frame and never overflows.
// Measured via a Range (padding- and alignment-agnostic). Loop-safe: font-size
// changes don't resize the fixed box, so the ResizeObserver won't re-fire; the
// MutationObserver watches text, not attributes.
const FIT_SCRIPT = `(function(){
  function fitOne(el){
    try{
      var cs=getComputedStyle(el);
      var availW=el.clientWidth-parseFloat(cs.paddingLeft||0)-parseFloat(cs.paddingRight||0);
      var availH=el.clientHeight-parseFloat(cs.paddingTop||0)-parseFloat(cs.paddingBottom||0);
      if(availW<=0||availH<=0)return;
      // Measure the trimmed inner box so the fit fills the frame with GLYPH INK,
      // not the taller line box; fall back to a Range if the inner is absent.
      var inner=el.querySelector('[data-fit-inner]');
      var lo=1, hi=Math.max(2,availH*2);
      for(var i=0;i<18;i++){
        var mid=(lo+hi)/2;
        el.style.fontSize=mid+'px';
        var w, h;
        // width via scrollWidth (unbreakable text overflows the max-width cap),
        // height via the trimmed box rect.
        if(inner){ w=inner.scrollWidth; h=inner.getBoundingClientRect().height; }
        else { var r=document.createRange(); r.selectNodeContents(el); var rr=r.getBoundingClientRect(); w=rr.width; h=rr.height; }
        if(w<=availW+0.5 && h<=availH+0.5) lo=mid; else hi=mid;
      }
      el.style.fontSize=lo+'px';
    }catch(e){}
  }
  function fitAll(){ document.querySelectorAll('[data-fit]').forEach(fitOne); }
  window.__fitText=fitAll;
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fitAll);
  fitAll();
  try{
    var ro=new ResizeObserver(function(es){ es.forEach(function(e){ fitOne(e.target); }); });
    var mo=new MutationObserver(function(){ fitAll(); });
    document.querySelectorAll('[data-fit]').forEach(function(el){
      ro.observe(el);
      mo.observe(el,{characterData:true,childList:true,subtree:true});
    });
  }catch(e){}
})();`;
