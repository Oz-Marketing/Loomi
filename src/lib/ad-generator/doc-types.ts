import type { LogoVariant } from './brand-logos';
import type { AdData, AdSize, FieldSpec } from './types';

/**
 * Data-driven ad template ("TemplateDoc") — the keystone for the visual
 * builder. A template stops being a code function and becomes a structured
 * document: the fields a user fills + per-size layouts of positioned elements
 * bound to those fields. One renderer (`renderDoc`) interprets it into the
 * SAME HTML/CSS the Puppeteer pipeline rasterizes, so the builder canvas and
 * the export are byte-for-byte the same renderer (WYSIWYG by construction).
 *
 * Designers edit this visually and never see the JSON.
 */

/** Where an element's value comes from. */
export type Binding =
  | { kind: 'field'; key: string } // a user-filled field → data[key]
  // From the account. `variant` applies to `logoUrl` only: it pins WHICH of the
  // account's logos this element shows (so a logo on a dark panel can ask for
  // the light-on-dark file), and each account still resolves its own. Absent =
  // whichever logo the ad is using.
  | { kind: 'brand'; key: 'dealerName' | 'logoUrl' | 'brandColor'; variant?: LogoVariant }
  | { kind: 'static'; value: string }; // a literal baked into the template

export type DocElementType = 'text' | 'image' | 'logo' | 'shape' | 'background';

/** CSS mix-blend-mode values — how an element composites over what's beneath it.
 *  Lets a gradient/color layer tint a texture (multiply/overlay), knock lines
 *  back (screen), etc. — the moves that let a background be composed in-app
 *  instead of pre-baked in Illustrator. `normal` / undefined = plain stacking. */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

/** One color stop in a {@link GradientFill}. */
export interface GradientStop {
  /** Hex color (`#rgb`/`#rrggbb`/`#rrggbbaa`), or `'brand'` = account color. */
  color: string;
  /** Position along the gradient line, 0–100. */
  pos: number;
  /** Stop opacity 0–100. Undefined = 100 (opaque). Lets a stop fade to
   *  transparent — e.g. a white→transparent scrim that lets a texture show
   *  through, the core move behind the Subaru-style fades. */
  opacity?: number;
}

/**
 * A multi-stop gradient fill. Supersedes the legacy two-stop
 * `gradient`/`gradientAngle`/`gradientStops` triple on shapes and the canvas
 * background — those are still READ for existing templates (see
 * `normalizeGradient` in doc-renderer), but new work writes `gradientFill`.
 */
export interface GradientFill {
  /** `'linear'` (default) or `'radial'`. */
  type?: 'linear' | 'radial';
  /** Linear only: direction in degrees (CSS linear-gradient angle). Default 135. */
  angle?: number;
  /** Radial only: silhouette. Default `'ellipse'`. */
  radialShape?: 'circle' | 'ellipse';
  /** Radial only: center [x, y] as percentages (0–100). Default [50, 50]. */
  center?: [number, number];
  /** Two or more stops. Rendered in array order; positions need not be sorted. */
  stops: GradientStop[];
}

/**
 * A shared element: its identity, binding, and base style. Position + size
 * live PER SIZE in `layouts` (so a designer tunes each aspect ratio
 * independently) — an element is the same thing across sizes, just placed
 * differently.
 *
 * Style here is the value used by EVERY size unless that size overrides it in
 * `TemplateDoc.overrides` — see {@link TemplateDoc.overrides}.
 */
export interface DocElement {
  id: string;
  type: DocElementType;
  /** Designer-set layer name (overrides the binding-derived label). */
  name?: string;
  /** Builder-only: a locked element can't be selected, moved, or edited on the
   *  canvas until unlocked. Never affects export. */
  locked?: boolean;
  /** Group membership — elements sharing a groupId move/select together and nest
   *  under the group in the Layers panel. The group list lives on the doc. */
  groupId?: string;
  /** What the element displays. Omitted for plain shapes. */
  binding?: Binding;
  /** Conditional visibility: render this element ONLY when the value of field
   *  `field` is one of `in` (e.g. `{ field: 'offerType', in: ['apr'] }` shows a
   *  `%` badge only for APR offers). Lets one template carry all offer types —
   *  the wrong-type pieces are omitted on export and dimmed (still selectable) on
   *  the builder canvas. Independent of a size's per-size `hidden` flag. */
  visibleWhen?: { field: string; in: string[] };
  // ── text ──
  /** Font family; empty / undefined = the account's brand font stack. */
  fontFamily?: string;
  fontWeight?: number;
  /** Letter spacing in px. */
  letterSpacing?: number;
  /** Unitless line height. */
  lineHeight?: number;
  uppercase?: boolean;
  /** Hex color, or `'brand'` = the account's brand color. */
  color?: string;
  /** Optional background behind the text (hex or `'brand'`) — for pills/badges
   *  like the expiration tag. Pairs with `radius` + `padding`. */
  bg?: string;
  /** Inner padding in px (text with a `bg`, or to inset shape content). Kept as
   *  the fallback for any per-side value left unset. */
  padding?: number;
  /** Per-side padding overrides (px). When any is set the renderer emits a
   *  four-value `padding` (top, right, bottom, left), falling back to `padding`
   *  (then 0) for sides left undefined. */
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  align?: 'left' | 'center' | 'right';
  /** Text vertical alignment within the fixed frame. */
  vAlign?: 'top' | 'middle' | 'bottom';
  /** SHRINK-ON-OVERFLOW mode (the default for new text). A fixed W×H frame; the
   *  text renders at the element's CHOSEN font size and only auto-shrinks (down
   *  only) when a value would overflow the frame — it never grows past the chosen
   *  size (that's FILL). The chosen font size is the CAP. When falsy the element is
   *  FILL instead: the font auto-scales (up + down) to fill the box. Aligned by
   *  `align` (horizontal) + `vAlign` (vertical) in both modes. */
  shrink?: boolean;
  /** DEPRECATED — the retired "Wrap" mode (fixed font, clip on overflow). Existing
   *  elements with `wrap` truthy are treated as SHRINK; no new element sets it. */
  wrap?: boolean;
  /** DEPRECATED — the retired "Hug" mode. Existing elements with `autoSize` truthy
   *  are treated as SHRINK; no new element sets it. */
  autoSize?: boolean;
  // ── image / logo ──
  /** `contain` fits inside the box, `cover` fills + crops, `tile` repeats the
   *  image to fill (for seamless textures/patterns). */
  fit?: 'contain' | 'cover' | 'tile';
  /** For `fit:'tile'` — tile width as a fraction of the element box width (0..1);
   *  height auto-preserves aspect, and it repeats to fill. Resolution-independent
   *  so tile density stays constant across sizes. Default 0.25 (four across). */
  tileScale?: number;
  // ── motion (a video / animated source in an image or background element) ──
  /** Seconds into the source clip this element starts at. Default 0.
   *
   *  One value drives both outputs, which is the point: a still export captures
   *  the frame at `trimStart`, and an MP4 export starts playback there — so the
   *  frame a designer picked as the poster is the frame the video opens on.
   *  A clip shorter than the ad's duration loops from here rather than freezing. */
  trimStart?: number;
  // ── all element types ──
  /** Element opacity, 0–100 (percent). Undefined = fully opaque. Applies to any
   *  element (images/logos for watermarks, shapes/text for overlays); rendered
   *  on the element wrapper. */
  opacity?: number;
  /** How this element composites over what's beneath it (CSS mix-blend-mode).
   *  Undefined / `'normal'` = plain stacking. Enables tint/knock-back moves for
   *  composing backgrounds natively. */
  blendMode?: BlendMode;
  // ── shape ──
  /** Shape silhouette. Defaults to `'rect'` (a plain rectangle). `ellipse` is a
   *  circle/oval; `triangle`/`diamond`/`star` are drawn via CSS clip-path. */
  shapeKind?: 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'star';
  /** Hex fill, or `'brand'`. Ignored when a gradient is set. */
  fill?: string;
  /** Multi-stop gradient fill (linear/radial, per-stop opacity). When set, takes
   *  precedence over `fill` and the legacy `gradient` fields. */
  gradientFill?: GradientFill;
  /** @deprecated Legacy two-stop linear gradient [from, to]. Still rendered for
   *  existing templates; new work writes `gradientFill`. */
  gradient?: [string, string];
  /** @deprecated Legacy gradient angle. See `gradientFill`. */
  gradientAngle?: number;
  /** @deprecated Legacy stop offsets [start%, end%]. See `gradientFill`. */
  gradientStops?: [number, number];
  // ── background (type:'background') ──
  // The unified full-bleed background element. It composites, bottom→top:
  //   1. base fill  — `fill` / `gradientFill` (as a shape)
  //   2. texture    — `binding` image + `fit` (cover/tile/contain) + `tileScale`
  //   3. fade       — `overlay` gradient on top (e.g. white→transparent scrim)
  // This is the single way to set a background; it replaces the old doc-level
  // `DocBackground` canvas fill and the separate full-bleed background image.
  /** Opacity (0–100) of the background's texture layer only. Undefined = 100. */
  bgImageOpacity?: number;
  /** The background's top fade/overlay gradient (composited over the texture). */
  overlay?: GradientFill;
  /** Corner radius in px (all four corners). Applies to rectangle shapes AND
   *  images/logos (rounds the image, which is clipped by the wrapper's
   *  overflow:hidden). Kept for back-compat + as the fallback for any per-corner
   *  value left unset. */
  radius?: number;
  /** Per-corner radius overrides (px). When any is set the renderer emits a
   *  four-value `border-radius` (top-left, top-right, bottom-right, bottom-left),
   *  falling back to `radius` (then 0) for corners left undefined. */
  radiusTL?: number;
  radiusTR?: number;
  radiusBR?: number;
  radiusBL?: number;
}

/**
 * Per-size placement of an element. x/y/w/h are FRACTIONS of the canvas
 * (0..1), so they're resolution-independent within a size; `fontSize` is px
 * at that size. Omit an element from a size's map (or set `hidden`) to drop it
 * there.
 */
export interface DocLayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize?: number;
  z?: number;
  hidden?: boolean;
  /** Focal point (0..1) for a `fit:cover` image — which part stays in frame per
   *  size. Maps to CSS object-position; defaults to center. Lets one background
   *  image be framed differently for square vs. story, etc. */
  objectX?: number;
  objectY?: number;
  /** Crop zoom (>= 1) for a `fit:cover` image — scales the image up inside its
   *  box so the designer can crop in past the plain cover fit. 1 / undefined =
   *  no extra zoom. Origin is the focal point (objectX/objectY). */
  objectScale?: number;
}

/** Canvas base fill. A background IMAGE is a full-bleed image element/layer
 *  (not a doc-level field) — see DocElement + the builder's "Background image". */
export interface DocBackground {
  /** Solid fill (hex). Ignored when a gradient is set. */
  color?: string;
  /** Multi-stop gradient fill (linear/radial, per-stop opacity). When set, takes
   *  precedence over `color` and the legacy `gradient` fields. */
  gradientFill?: GradientFill;
  /** @deprecated Legacy two-stop linear gradient [from, to]. Still rendered for
   *  existing templates; new work writes `gradientFill`. */
  gradient?: [string, string];
  /** @deprecated Legacy gradient angle. See `gradientFill`. */
  gradientAngle?: number;
  /** @deprecated Legacy stop offsets [start%, end%]. See `gradientFill`. */
  gradientStops?: [number, number];
  /** Thin brand-colored bar across the top (the current Vehicle Offer look). */
  accentBar?: boolean;
}

/** Which producer a template is built for. See `TemplateDoc.usage`. */
export type TemplateUsage = 'oem' | 'custom' | 'both';

/**
 * A doc's usage, with the compatibility default.
 *
 * Undefined reads as `both`, which is what every template written before this
 * field existed effectively was. The alternative — defaulting to `custom` —
 * would have stopped automation finding any template the moment this shipped.
 * New templates are created as `custom` (see `blankTemplateDoc`), so the
 * permissive default applies only to the existing library, which the Co-op team
 * narrows deliberately rather than by outage.
 */
export function templateUsage(doc: Pick<TemplateDoc, 'usage'>): TemplateUsage {
  return doc.usage ?? 'both';
}

/** Can this template be used by unattended OEM generation? */
export function usableByAutomation(doc: Pick<TemplateDoc, 'usage'>): boolean {
  return templateUsage(doc) !== 'custom';
}

/**
 * The field keys a template actually renders — every element's binding key.
 *
 * The system-field schema is fixed, so a doc carries all of them whether or not
 * it draws them. This is how a caller tells "the template has a Tagline" from
 * "the template merely inherits the Tagline field and never shows it".
 */
export function boundFieldKeys(doc: Pick<TemplateDoc, 'elements'>): Set<string> {
  const keys = new Set<string>();
  for (const el of doc.elements ?? []) {
    const b = el.binding;
    if ((b?.kind === 'field' || b?.kind === 'brand') && b.key) keys.add(b.key);
    // A condition names a field the form still has to expose, or the user can
    // never satisfy it.
    if (el.visibleWhen?.field) keys.add(el.visibleWhen.field);
  }
  return keys;
}

/** Can a person build a custom ad from this template? */
export function usableForCustom(doc: Pick<TemplateDoc, 'usage'>): boolean {
  return templateUsage(doc) !== 'oem';
}

/**
 * Is `date` inside the template's publish window?
 *
 * `schedule` has always documented itself as hiding a template outside its dates,
 * but only the automation resolver ever honoured it — in the human library a
 * seasonal plate showed all year. Absent or half-open windows are open-ended,
 * matching the field's own contract.
 */
export function templateInSchedule(doc: Pick<TemplateDoc, 'schedule'>, date: Date): boolean {
  const s = doc.schedule;
  if (!s || (!s.start && !s.end)) return true;
  // Compare as local calendar days: a window ending "2026-08-31" should include
  // all of the 31st in the dealer's own timezone, not expire at 18:00 the day
  // before because the boundary was read as UTC midnight.
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
  if (s.start && day < s.start) return false;
  if (s.end && day > s.end) return false;
  return true;
}

export interface TemplateDoc {
  id: string;
  name: string;
  description?: string;
  /** Industries this template is offered to (account `category` values, e.g.
   *  'Automotive', 'Powersports'). Empty/undefined → derived from content
   *  (vehicle templates default to Automotive + Powersports). Drives which
   *  accounts see it in the picker. */
  industries?: string[];
  /** The make/OEM this template is built for (e.g. "Kia"). When set, the builder
   *  shows a compliance checklist against that make's OEM rule — so a designer sees
   *  which required fields must be present before ads from it can be exported.
   *  Automotive only; matched case-insensitively to AdOemOfferRule.make. */
  make?: string;
  /**
   * WHAT this template is for — the two audiences produce ads very differently.
   *
   * `oem`     Unattended automation only. Every field it renders has to come from
   *           the offer feed, because there is no human to fill a blank.
   * `custom`  Human-built ads only. May carry fields only a person can supply.
   * `both`    Meets the automation bar AND is offered in the human picker. A real
   *           case for a generic offer plate — but it IS the stricter bar, not a
   *           shrug: a template nobody has checked against the feed belongs in
   *           `custom`.
   *
   * WHY THIS EXISTS. Automation's last resort is a brand fallback — any published
   * template whose `make` matches the vehicle. Nothing else distinguished "built
   * for the feed" from "built for a person", so a custom Mazda plate was already a
   * candidate for unattended Mazda ads. That contradicts this module's own rule
   * that rendering an offer through an unintended template is worse than producing
   * no ad.
   *
   * This is INTENT, and deliberately separate from co-op approval, which is
   * PERMISSION (per make, and goes stale when the design or the guidelines move).
   * A template can be intended for OEM use and still be blocked by a stale
   * approval; collapsing the two would lose that state.
   *
   * Undefined is read as `both` so existing templates keep working — see
   * `templateUsage`.
   */
  usage?: TemplateUsage;
  /** Shared template taxonomy: a single category + freeform tags, used to
   *  organize/filter this template alongside every other kind on /templates. */
  category?: string;
  tags?: string[];
  /** Publish schedule for a PUBLISHED template. Absent → live indefinitely. A
   *  window (ISO yyyy-MM-dd, inclusive) restricts when it appears in the template
   *  library: hidden before `start`, hidden after `end`. Stored in the doc JSON
   *  (no separate column). */
  schedule?: { start?: string | null; end?: string | null };
  sizes: AdSize[];
  /** Form fields the user fills — reuses FieldSpec (copy / maxLength /
   *  visibleWhen all carry straight over from the code-template work). */
  fields: FieldSpec[];
  /** Designer-defined form sections (ordered), by name. Each field's `group`
   *  points at one of these; a group can exist with no fields yet. Drives the
   *  Fields-panel sections AND the client form's grouped layout. Absent on
   *  legacy docs → derived from the fields' `group` values. */
  fieldGroups?: string[];
  background?: DocBackground;
  /**
   * MP4 output settings, used only by a design that carries a motion layer (a
   * video or animated GIF — see `lib/ad-generator/motion.ts`). Absent, or with a
   * key absent, falls back to {@link MOTION_DEFAULTS}.
   *
   * Deliberately doc-level rather than per element: an ad is one clip of one
   * length, so two videos in the same design share its duration (each looping to
   * fill it) instead of each claiming its own. Every static export ignores this
   * entirely — a doc with no motion layer never reads it.
   */
  motion?: { durationSec?: number; fps?: number };
  /** Optional safe-area margin the designer sets to mark consistent padding. A
   *  builder-only guide (never exported) the alignment snapping treats as an
   *  edge. Stored as a value + unit; converted to per-size fractions at use. */
  safeArea?: { value: number; unit: 'percent' | 'px' | 'em' | 'rem' };
  /** Shared element definitions. */
  elements: DocElement[];
  /** Element groups (⌘G in the builder) — id + display name, referenced by
   *  `DocElement.groupId`. Groups nest via `parentId` (a group inside a group).
   *  Builder-only convenience; doesn't affect render. */
  groups?: { id: string; name: string; parentId?: string; collapsed?: boolean }[];
  /** sizeId → (elementId → placement). */
  layouts: Record<string, Record<string, DocLayoutBox>>;
  /**
   * sizeId → (elementId → style that differs ON THAT SIZE).
   *
   * Placement was always per size while STYLE was always shared, so a designer
   * could tune the square's layout freely but couldn't make its headline a
   * different colour without changing all fifteen boards. These are the opt-out:
   * only the keys a size actually diverges on are stored, and the renderer merges
   * them over the element. Absent (as on every doc written before this existed)
   * means every size uses the shared style — so there's nothing to migrate.
   */
  overrides?: Record<string, Record<string, Partial<DocElement>>>;
  defaults: AdData;
}
