import type { AdData, AdSize } from './types';
import type { TemplateDoc, DocElement, DocLayoutBox, Binding, GradientFill } from './doc-types';
import { offerFieldPrefix, OFFER_PLATE_DEFAULTS } from './doc-types';
import { logoVariantDataKey } from './brand-logos';
import { effectiveElements } from './size-scope';
import { cssSafeFamily } from './fonts';
import { motionKind } from './motion';

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

/** What an element's binding resolves to, for this data. Exported because the
 *  motion planner has to ask the same question the renderer asks — "what URL is
 *  actually in this slot?" — and a second copy of that rule is how a video
 *  arriving through a template default would get missed. */
export function resolveBinding(b: Binding | undefined, data: AdData): string {
  if (!b) return '';
  switch (b.kind) {
    case 'static':
      return b.value;
    case 'field':
      return data[b.key] ?? '';
    case 'brand':
      // A pinned logo variant, falling back to whichever logo the ad is using —
      // an account with no `dark` file on record still gets a logo rather than a
      // hole. `brandLogoData` normally fills every variant key for exactly this
      // reason; the fallback covers data assembled without it.
      if (b.key === 'logoUrl' && b.variant) {
        return data[logoVariantDataKey(b.variant)] || data.logoUrl || '';
      }
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
  /** Preview only: keep wrong-offer-type elements on the canvas, dimmed. */
  dimOffType: boolean;
  /** Keys of number-typed fields — their values render with thousands commas. */
  numberKeys: Set<string>;
  /** How a motion layer (video / animated GIF source) renders. `live` emits the
   *  real clip — it plays in the builder and a browser preview, and the exporter
   *  freezes it at `trimStart` for a still. `omit` drops it, leaving the hole the
   *  MP4 compositor fills with the actual clip. */
  motion: MotionRenderMode;
  /** MP4 compositing only: for a `background` element, render just this part of
   *  it, so its base fill can sit UNDER the clip and its fade overlay OVER it.
   *  Absent = the element renders whole, as it always has. */
  bgParts?: Record<string, BackgroundPart>;
}

/** See {@link RenderCtx.motion}. */
export type MotionRenderMode = 'live' | 'omit';

/** Which slice of a `background` element to draw — see {@link RenderCtx.bgParts}. */
export type BackgroundPart = 'base' | 'overlay';

/**
 * Conditional visibility (`visibleWhen`): the element shows only when the gating
 * field's value is in the allowed set (e.g. a `%` badge only for `offerType: apr`).
 *
 * Exported because the builder needs the SAME answer to decide which elements to
 * outline and hit-test. Two copies of this rule is how the canvas ended up drawing
 * frames for blocks it wasn't rendering.
 */
export function isElementVisibleFor(el: DocElement, data: AdData): boolean {
  if (!el.visibleWhen) return true;
  return el.visibleWhen.in.includes(String(data[el.visibleWhen.field] ?? ''));
}

/**
 * The inner media tag for an image slot — a `<video>` when the source is a clip,
 * an `<img>` otherwise.
 *
 * ONE tag serves the builder canvas, the browser preview AND the still export.
 * It autoplays muted (which is the only autoplay a browser allows, and what a
 * feed does anyway), and carries `data-still-at` so the PNG exporter can pause
 * and seek it to a known frame instead of screenshotting whichever frame the
 * decoder happened to be on — that non-determinism is the whole reason the
 * attribute exists.
 *
 * An animated GIF stays an `<img>`: it animates natively, and promoting it to a
 * video element would change how every existing texture renders.
 */
function mediaTag(url: string, el: DocElement, inner: string): string {
  if (motionKind(url) !== 'video') {
    return `<img src="${url}" alt="" style="${inner}" />`;
  }
  const stillAt = Math.max(0, el.trimStart ?? 0);
  return (
    `<video src="${url}" autoplay muted loop playsinline preload="auto"` +
    ` data-motion data-still-at="${stillAt}" style="${inner}"></video>`
  );
}

function renderElement(el: DocElement, box: DocLayoutBox, data: AdData, ctx: RenderCtx): string {
  const { width, height, brand, brandStack } = ctx;
  // On export a wrong-type element is omitted entirely; in the builder it's kept
  // but dimmed when the All tab asks to see every type at once.
  const condHidden = !isElementVisibleFor(el, data);
  // Omitted on export, and in preview too unless the builder asked to see every
  // offer type at once. Four offer blocks occupying one spot read as a smear when
  // they're all kept, which defeated the point of previewing a single type.
  if (condHidden && !(ctx.preview && ctx.dimOffType)) return '';
  // data-el-id lets the builder find + move this node live during a drag.
  const idAttr = ` data-el-id="${esc(el.id)}"`;
  // A `visibleWhen`-gated element (wrong offer type) is dimmed/blurred in the
  // builder so the designer can still see + edit it; it's omitted on export.
  // An EYE-hidden element (`box.hidden`) is removed from the artboard entirely
  // (see the render-loop filter) — never dimmed — so it reads as truly hidden.
  const dim = condHidden ? 'opacity:0.35;filter:blur(1.5px);' : '';
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
    //
    // When the texture is a CLIP, the MP4 compositor needs those three layers
    // pulled apart — the fill belongs under the video and the fade over it — so a
    // plate render asks for one `part` at a time. Absent (every other caller) the
    // element draws whole, exactly as before.
    const part = ctx.bgParts?.[el.id];
    const layers: string[] = [];
    // 1. Base fill (solid or gradient).
    const baseGrad = normalizeGradient(el);
    const baseBg = baseGrad ? buildGradientCss(baseGrad, brand) : el.fill ? esc(resolveColor(el.fill, brand, brand)) : '';
    if (baseBg && part !== 'overlay') layers.push(`<div style="position:absolute;inset:0;background:${baseBg};"></div>`);
    // 2. Texture (image or clip), with its own opacity. Dropped entirely on a
    //    plate render: a plate exists to leave room for the real clip.
    const texUrl = esc(resolveBinding(el.binding, data));
    const texIsMotion = motionKind(texUrl) !== null;
    const skipTexture = part != null || (texIsMotion && ctx.motion === 'omit');
    if (texUrl && !skipTexture) {
      const texOp = el.bgImageOpacity != null && el.bgImageOpacity < 100 ? `opacity:${clamp01(el.bgImageOpacity / 100)};` : '';
      if ((el.fit ?? 'cover') === 'tile' && !texIsMotion) {
        const tilePct = Math.max(2, clamp01(el.tileScale ?? 0.25) * 100);
        layers.push(`<div style="position:absolute;inset:0;${texOp}background-image:url(${texUrl});background-repeat:repeat;background-size:${tilePct}% auto;"></div>`);
      } else {
        const objPos = box.objectX != null || box.objectY != null ? `${clamp01(box.objectX ?? 0.5) * 100}% ${clamp01(box.objectY ?? 0.5) * 100}%` : 'center';
        // Crop zoom, same as a plain cover image. A background could always carry
        // a per-size focal point but never a zoom, so on a board whose aspect
        // ratio differed sharply from the photo's there was no way to scale the
        // image up and choose what the crop kept. Per size, like the focal point
        // it pivots on.
        const bgScale = (el.fit ?? 'cover') === 'cover' && box.objectScale && box.objectScale > 1 ? box.objectScale : 1;
        const bgZoom = bgScale > 1 ? `transform:scale(${bgScale});transform-origin:${objPos};` : '';
        const inner = `width:100%;height:100%;object-fit:${el.fit === 'tile' ? 'cover' : (el.fit ?? 'cover')};object-position:${objPos};${bgZoom}`;
        layers.push(`<div style="position:absolute;inset:0;overflow:hidden;${texOp}">${mediaTag(texUrl, el, inner)}</div>`);
      }
    }
    // 3. Fade / overlay gradient on top.
    if (el.overlay && part !== 'base') {
      const ov = normalizeGradient({ gradientFill: el.overlay });
      if (ov) layers.push(`<div style="position:absolute;inset:0;background:${buildGradientCss(ov, brand)};"></div>`);
    }
    if (!layers.length) return '';
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
    // A clip on a plate render: leave the hole. The compositor puts the real
    // frames here, cropped by the same numbers this element would have used.
    if (ctx.motion === 'omit' && motionKind(url) !== null) return '';
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
    // A clip has no tiled form (a repeating video is a different feature), so it
    // fills its box like `cover` rather than rendering as a single frozen frame.
    const isClip = motionKind(url) === 'video';
    const fit = isClip && el.fit === 'tile' ? 'cover' : (el.fit ?? 'contain');
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
    const inner = `width:100%;height:100%;object-fit:${fit};object-position:${objectPos};${zoom}`;
    return `<div${idAttr} style="${dim}${fx}${pos}overflow:hidden;${radius}">${mediaTag(url, el, inner)}</div>`;
  }

  if (el.type === 'offer') {
    // ── THE OFFER PLATE ────────────────────────────────────────────────────
    //
    // One element, three assembled rows: the label, the figure, the terms. The
    // values come from whatever `assembleOffer` made of this ad's offer, so the
    // same plate renders "PER MONTH LEASE / $299/mo / 36-month lease · $2,999
    // due at signing" and "APR / 1.9% / for 60 months" with no per-type copies
    // and no `visibleWhen`.
    //
    // The rows are shares of the plate's own height and each fits its own text,
    // which is where per-type emphasis comes from for free: "1.9%" is a shorter
    // string than "$299/mo", so it fills its row at a larger size. Nobody
    // configures a font size per offer type.
    const p = offerFieldPrefix(el);
    const parts = {
      label: esc(String(data[`_${p}offerLabel`] ?? '')),
      figure: esc(String(data[`_${p}offerMain`] ?? '')),
      terms: esc(String(data[`_${p}offerTerms`] ?? '')),
    };
    // An empty plate would be an invisible element on the canvas, so preview
    // shows what it IS. Export renders nothing rather than a placeholder.
    if (!parts.figure) {
      if (!ctx.preview) return '';
      parts.label = parts.label || 'OFFER LABEL';
      parts.figure = '$&mdash;';
    }

    const plate = { ...OFFER_PLATE_DEFAULTS, ...(el.offerPlate ?? {}) };
    const family = el.fontFamily ? `'${cssSafeFamily(el.fontFamily)}', ${brandStack}` : brandStack;
    const figureColor = resolveColor(el.color, brand, '#0f172a');
    // The label and terms are supporting type. `bg`, padding and radius belong to
    // the plate as a whole rather than to any one row.
    const mutedColor = '#475569';
    const align = el.align ?? 'left';
    const items = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
    const plateBg = el.bg ? `background:${esc(resolveColor(el.bg, brand, brand))};` : '';

    const row = (
      text: string,
      share: number | null,
      opts: { color: string; weight: number; upper?: boolean; spacing?: number; line?: number },
    ): string => {
      if (!text) return '';
      // `share: null` is the figure — it takes whatever the other two leave.
      const size = share == null ? 'flex:1 1 auto;min-height:0;' : `flex:0 0 ${(share * 100).toFixed(2)}%;`;
      const style =
        `${size}display:flex;flex-direction:column;justify-content:center;align-items:${items};overflow:hidden;` +
        `font-family:${family};font-weight:${opts.weight};color:${esc(opts.color)};` +
        `text-align:${align};line-height:${opts.line ?? 1.05};` +
        (opts.upper ? 'text-transform:uppercase;' : '') +
        (opts.spacing ? `letter-spacing:${opts.spacing}px;` : '');
      // Same fit contract as a text element: the value sits in a trimmed inner
      // box so the row hugs the glyph ink rather than the font's line box.
      const inner = `<div data-fit-inner style="display:inline-block;max-width:100%;white-space:pre-wrap;text-box:trim-both cap alphabetic;">${text}</div>`;
      return `<div data-fit style="${style}">${inner}</div>`;
    };

    const body =
      row(parts.label, plate.labelShare, { color: mutedColor, weight: 700, upper: true, spacing: el.letterSpacing ?? 1.5 }) +
      row(parts.figure, null, { color: figureColor, weight: el.fontWeight ?? 800, line: el.lineHeight ?? 0.95 }) +
      row(parts.terms, plate.termsShare, { color: mutedColor, weight: 500, line: 1.25 });

    const styles =
      pos +
      `display:flex;flex-direction:column;justify-content:center;gap:${Math.max(0, plate.gapPx)}px;` +
      plateBg +
      paddingCss(el) +
      borderRadiusCss(el) +
      'overflow:hidden;';
    return `<div${idAttr} style="${dim}${fx}${styles}">${body}</div>`;
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
  // Text has two modes now: SHRINK (holds the chosen font, shrinks to fit on
  // overflow) and FILL (font auto-scales to fill). The retired WRAP/HUG modes
  // (`wrap`/`autoSize`) fold into SHRINK so old elements migrate.
  // FILL: a fixed W×H frame. The font auto-scales (fit script / builder
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
  // Two sizing modes (see doc-types). SHRINK (default): a fixed W×H frame; the
  // text holds the element's CHOSEN font size and only scales DOWN to fit when a
  // value would overflow — never up. `data-fit-max` carries the chosen size as the
  // cap. FILL: the font auto-scales (up + down) to maximize within the frame; no
  // cap. Both go through the fit script/parent (`data-fit`). Legacy `wrap`/`autoSize`
  // (the retired Wrap/Hug modes) fold into SHRINK. The value lives in a `text-box`-
  // trimmed inner box so the FRAME hugs the glyph ink (cap height → baseline), not
  // the font's line box — killing the ascent/descent "leading" gap (most visible on
  // big numbers). It's inline-block + max-width:100% so it wraps at the frame width
  // AND shrink-wraps to the ink for the fit to measure THIS node, not a Range.
  const marker = el.shrink || el.wrap || el.autoSize
    ? `data-fit data-fit-max="${box.fontSize ?? 16}"`
    : 'data-fit';
  // Members of a fit group settle on the smallest size any of them needs — see
  // `DocElement.fitGroup`. Emitted as an attribute so the fit script can find the
  // group without knowing anything about the doc.
  const group = el.fitGroup ? ` data-fit-group="${esc(el.fitGroup)}"` : '';
  const inner = `<div data-fit-inner style="display:inline-block;max-width:100%;white-space:pre-wrap;text-box:trim-both cap alphabetic;">${value}</div>`;
  return `<div${idAttr} ${marker}${group} style="${dim}${fx}${styles}">${inner}</div>`;
}

/**
 * The elements this size actually draws, in paint order.
 *
 * Exported because the MP4 compositor has to split the SAME ordered list this
 * renderer walks — a plate that disagreed with the render about z-order or about
 * which layers are hidden would composite the design in the wrong sequence.
 */
export function visibleLayers(doc: TemplateDoc, sizeId: string): { el: DocElement; box: DocLayoutBox }[] {
  const layout = doc.layouts[sizeId] ?? {};
  return effectiveElements(doc, sizeId)
    .map((el) => ({ el, box: layout[el.id] }))
    // Eye-hidden elements are removed from the artboard in BOTH preview and
    // export — hiding a layer takes it off the canvas, not just dims it. Elements
    // dragged fully off the artboard are "detached" (a canvas-only parking spot
    // in the builder) — never part of the rendered ad, so drop them here too.
    .filter(
      (x): x is { el: DocElement; box: DocLayoutBox } =>
        Boolean(x.box) && !x.box!.hidden && !isBoxDetached(x.box!),
    )
    .sort((a, b) => (a.box.z ?? 0) - (b.box.z ?? 0));
}

export interface RenderDocOptions {
  preview?: boolean;
  dimOffType?: boolean;
  /** How motion layers render. Default `live` — the clip is in the markup, which
   *  is what a browser and the still exporter both want. */
  motion?: MotionRenderMode;
  /**
   * MP4 compositing: render this design as a flat PLATE — only the named
   * elements, on a transparent canvas, with motion layers omitted. The exporter
   * renders one plate per run of static layers between clips, then ffmpeg stacks
   * plate → clip → plate in the same order.
   */
  plate?: {
    ids: string[];
    bgParts?: Record<string, BackgroundPart>;
    /** The BOTTOM plate, which paints the canvas fill + accent bar. Every plate
     *  above a clip is transparent instead, or it would hide the video. */
    canvas?: boolean;
  };
}

/** Render a TemplateDoc + data at a given size into a full HTML document. */
export function renderDoc(
  doc: TemplateDoc,
  data: AdData,
  size: AdSize,
  opts?: RenderDocOptions,
): string {
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
  const ctx: RenderCtx = {
    width,
    height,
    brand,
    brandStack,
    preview: opts?.preview ?? false,
    dimOffType: opts?.dimOffType ?? false,
    numberKeys,
    // A plate never carries the clip: that is the point of a plate.
    motion: opts?.plate ? 'omit' : (opts?.motion ?? 'live'),
    bgParts: opts?.plate?.bgParts,
  };

  // Per-size style overrides are merged inside `visibleLayers`, so every
  // downstream read (fit markers, colours, image fit) sees the element as THIS
  // size renders it.
  const plateIds = opts?.plate ? new Set(opts.plate.ids) : null;
  const body = visibleLayers(doc, size.id)
    .filter(({ el }) => !plateIds || plateIds.has(el.id))
    .map(({ el, box }) => renderElement(el, box, data, ctx))
    .join('\n');

  // Canvas base fill (solid / gradient) + optional brand accent bar. A
  // background IMAGE is a normal full-bleed image element/layer now — not a
  // doc-level field — so it flows through renderElement like everything else.
  const bg = doc.background;
  const bgGrad = normalizeGradient(bg);
  // A plate paints no canvas fill: it is stacked OVER the clip (and over the
  // base plate, which is the one render that does carry the fill), so an opaque
  // white ground here would hide the video completely.
  const bgCss = opts?.plate && !opts.plate.canvas
    ? 'transparent'
    : bgGrad
      ? buildGradientCss(bgGrad, brand)
      : bg?.color
        ? esc(bg.color)
        : '#ffffff';
  // The accent bar is canvas chrome, not an element, so it rides with the canvas
  // fill: on the normal render, and on the base plate (whose id list is empty).
  const accentBar = bg?.accentBar && (!opts?.plate || opts.plate.canvas)
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
  // How much room this element gives its text, and the node whose ink is measured.
  function room(el){
    var cs=getComputedStyle(el);
    return {
      w: el.clientWidth-parseFloat(cs.paddingLeft||0)-parseFloat(cs.paddingRight||0),
      h: el.clientHeight-parseFloat(cs.paddingTop||0)-parseFloat(cs.paddingBottom||0),
      inner: el.querySelector('[data-fit-inner]')
    };
  }
  // Does this element's text fit at \`px\`? Measures the TRIMMED inner box so the
  // frame is filled with glyph ink rather than the taller line box; width comes
  // from scrollWidth because unbreakable text overflows the max-width cap.
  function fitsAt(el,px,r){
    el.style.fontSize=px+'px';
    var w,h;
    if(r.inner){ w=r.inner.scrollWidth; h=r.inner.getBoundingClientRect().height; }
    else { var rg=document.createRange(); rg.selectNodeContents(el); var rr=rg.getBoundingClientRect(); w=rr.width; h=rr.height; }
    return w<=r.w+0.5 && h<=r.h+0.5;
  }
  // The largest size in (0, hi] at which every element in \`els\` fits.
  function largestFitting(els,hi){
    var rooms=els.map(room);
    function all(px){ for(var i=0;i<els.length;i++){ if(!fitsAt(els[i],px,rooms[i])) return false; } return true; }
    if(all(hi)) return hi;
    var lo=1, h=hi;
    for(var i=0;i<18;i++){ var mid=(lo+h)/2; if(all(mid)) lo=mid; else h=mid; }
    return lo;
  }
  function fitOne(el){
    try{
      var r=room(el);
      if(r.w<=0||r.h<=0)return;
      // data-fit-max caps the size (SHRINK): hold the chosen size, only shrink to
      // fit on overflow — never grow past it. Absent (FILL) → maximize to frame.
      var capAttr=el.getAttribute('data-fit-max');
      var cap=capAttr?parseFloat(capAttr):0;
      el.style.fontSize=largestFitting([el], cap>0?cap:Math.max(2,r.h*2))+'px';
    }catch(e){}
  }
  // A FIT GROUP settles on one size for every member — see DocElement.fitGroup.
  // Two offer figures in a comparison must be the same size even though one is
  // bound by its width and the other by its height.
  //
  // NOT simply the minimum of the individual sizes: the smallest member might be
  // small because it WRAPS, and a wrapping label at another member's size needs
  // more height than its box has. (Measured: "PER MONTH LEASE" beside "APR" on a
  // 600x400 dual overflowed its box by 18px under a plain-minimum rule.) So the
  // group takes the largest size at which EVERY member still fits.
  function syncGroups(){
    var groups={};
    document.querySelectorAll('[data-fit-group]').forEach(function(el){
      var k=el.getAttribute('data-fit-group');
      (groups[k]=groups[k]||[]).push(el);
    });
    Object.keys(groups).forEach(function(k){
      var els=groups[k];
      if(els.length<2)return;
      var min=Infinity;
      els.forEach(function(el){ var v=parseFloat(el.style.fontSize||'0'); if(v>0&&v<min)min=v; });
      if(!isFinite(min))return;
      var px=largestFitting(els,min);
      els.forEach(function(el){ el.style.fontSize=px+'px'; });
    });
  }
  function fitAll(){ document.querySelectorAll('[data-fit]').forEach(fitOne); syncGroups(); }
  window.__fitText=fitAll;
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fitAll);
  fitAll();
  try{
    // A single element re-fitting alone would break its group's parity, so the
    // group pass runs after any observed re-fit too.
    var ro=new ResizeObserver(function(es){ es.forEach(function(e){ fitOne(e.target); }); syncGroups(); });
    var mo=new MutationObserver(function(){ fitAll(); });
    document.querySelectorAll('[data-fit]').forEach(function(el){
      ro.observe(el);
      mo.observe(el,{characterData:true,childList:true,subtree:true});
    });
  }catch(e){}
})();`;
