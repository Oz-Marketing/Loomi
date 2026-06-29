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

export type DocElementType = 'text' | 'image' | 'logo' | 'shape';

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
  /** Inner padding in px (text with a `bg`, or to inset shape content). */
  padding?: number;
  align?: 'left' | 'center' | 'right';
  // ── image / logo ──
  fit?: 'contain' | 'cover';
  /** Element opacity, 0–100 (percent). Undefined = fully opaque. Used by
   *  images/logos for watermarks & overlays; rendered on the element wrapper. */
  opacity?: number;
  // ── shape ──
  /** Hex fill, or `'brand'`. */
  fill?: string;
  /** Corner radius in px. Applies to shapes AND images/logos (rounds the
   *  image, which is clipped by the wrapper's overflow:hidden). */
  radius?: number;
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
}

/** Canvas base fill. A background IMAGE is a full-bleed image element/layer
 *  (not a doc-level field) — see DocElement + the builder's "Background image". */
export interface DocBackground {
  /** Solid fill (hex). Ignored when `gradient` is set. */
  color?: string;
  /** Two-stop linear gradient [from, to]. */
  gradient?: [string, string];
  /** Gradient direction in degrees (CSS linear-gradient angle). Defaults to 135. */
  gradientAngle?: number;
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
  /** Optional ad-type label for grouping (e.g. 'Vehicle Offer', 'Event'). */
  adType?: string;
  sizes: AdSize[];
  /** Form fields the user fills — reuses FieldSpec (copy / maxLength /
   *  visibleWhen all carry straight over from the code-template work). */
  fields: FieldSpec[];
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
