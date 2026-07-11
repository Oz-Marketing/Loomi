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
  | { kind: 'brand'; key: 'dealerName' | 'logoUrl' | 'brandColor' } // from the account
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
  /** Text only: when true the box HUGS its text — it never wraps (explicit
   *  newlines still break), and resizing the box scales the FONT instead of
   *  reflowing. The renderer sizes the element to its content (anchored by
   *  `align`), so it hugs whatever value is present at render time, including
   *  dynamic client data. Undefined/false = the classic fixed box that wraps
   *  within its width (keep this for paragraph text like legal disclaimers). */
  autoSize?: boolean;
  // ── image / logo ──
  /** `contain` fits inside the box, `cover` fills + crops, `tile` repeats the
   *  image to fill (for seamless textures/patterns). */
  fit?: 'contain' | 'cover' | 'tile';
  /** For `fit:'tile'` — tile width as a fraction of the element box width (0..1);
   *  height auto-preserves aspect, and it repeats to fill. Resolution-independent
   *  so tile density stays constant across sizes. Default 0.25 (four across). */
  tileScale?: number;
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

export interface TemplateDoc {
  id: string;
  name: string;
  description?: string;
  /** Industries this template is offered to (account `category` values, e.g.
   *  'Automotive', 'Powersports'). Empty/undefined → derived from content
   *  (vehicle templates default to Automotive + Powersports). Drives which
   *  accounts see it in the picker. */
  industries?: string[];
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
  defaults: AdData;
}
