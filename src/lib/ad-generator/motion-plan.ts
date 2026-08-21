import type { AdData, AdSize } from './types';
import type { BackgroundPart } from './doc-renderer';
import type { DocElement, TemplateDoc } from './doc-types';
import { resolveBinding, visibleLayers } from './doc-renderer';
import {
  hasRoundedCorners,
  motionKind,
  motionSettings,
  type ClipPlacement,
  type MotionKind,
  type MotionSettings,
} from './motion';

/**
 * The composite plan for a moving ad: how to stack this design as flat PLATES
 * with the real clips sandwiched between them.
 *
 * WHY PLATES. The obvious way to export video is to record the page — capture
 * frames of the live canvas — and it is a trap: a per-frame screenshot of
 * Chromium is minutes of CPU for six seconds of ad, and the text would be
 * re-laid-out (and re-fitted) on every frame. So the design is rasterised ONCE,
 * by the same renderer that makes the PNG, and ffmpeg does the only work that
 * actually varies frame to frame — the clip itself. The output is byte-identical
 * to the still export everywhere the video isn't.
 *
 * Splitting into runs (rather than one background clip + one overlay) is what
 * makes a clip a normal layer: a scrim can sit over the video, a second clip can
 * sit over that scrim, and z-order is honoured because the plan walks the SAME
 * ordered layer list the renderer walks.
 *
 * Pure — no ffmpeg, no Chromium — so the plan is testable on its own.
 */

export interface MotionClip {
  elId: string;
  /** Human label for notices ("Background", "Hero video"). */
  label: string;
  url: string;
  kind: MotionKind;
  /** Seconds into the source where playback (and the still frame) begins. */
  trimStart: number;
  placement: ClipPlacement;
}

export type MotionCompositeLayer =
  | {
      kind: 'plate';
      ids: string[];
      bgParts?: Record<string, BackgroundPart>;
      /** The bottom plate — carries the canvas fill (see RenderDocOptions.plate). */
      canvas?: boolean;
    }
  | { kind: 'clip'; clip: MotionClip };

export interface MotionPlan {
  /** False = nothing moves; the caller should render a still and stop. */
  hasMotion: boolean;
  layers: MotionCompositeLayer[];
  clips: MotionClip[];
  settings: MotionSettings;
  /** Fidelity gaps worth telling the user about, not reasons to refuse. */
  warnings: string[];
}

/** How many clips one ad may composite. Past this the render is slow enough on a
 *  small box to be the wrong shape of feature — a warning, not a hard stop. */
const CLIP_WARN_AT = 3;

function labelFor(el: DocElement): string {
  if (el.name?.trim()) return el.name.trim();
  if (el.type === 'background') return 'Background';
  return el.type === 'logo' ? 'Logo' : 'Image';
}

/** Combined layer opacity for a clip: the element's own opacity, times the
 *  background element's separate texture opacity when that's what's moving. */
function clipOpacity(el: DocElement): number {
  const own = el.opacity != null ? Math.min(100, Math.max(0, el.opacity)) : 100;
  const tex = el.type === 'background' && el.bgImageOpacity != null ? Math.min(100, Math.max(0, el.bgImageOpacity)) : 100;
  return (own / 100) * (tex / 100) * 100;
}

/**
 * The element's four corner radii, resolving per-corner overrides against the
 * all-corners value — the same precedence the renderer's `border-radius` uses, so
 * the mask and the CSS round identically.
 */
function cornerRadii(el: DocElement): [number, number, number, number] {
  const base = el.radius ?? 0;
  return [el.radiusTL ?? base, el.radiusTR ?? base, el.radiusBR ?? base, el.radiusBL ?? base];
}

/** Does this background element paint anything BENEATH its texture? */
function hasBaseFill(el: DocElement): boolean {
  return Boolean(el.fill || el.gradientFill || el.gradient);
}

/**
 * Build the plan. `size` supplies the pixel canvas; `data` is the MERGED render
 * data (template defaults already folded in), because a video that arrives from a
 * template default is still a video.
 */
export function planMotionComposite(
  doc: TemplateDoc,
  data: AdData,
  size: AdSize,
  override?: Partial<MotionSettings>,
): MotionPlan {
  const settings = motionSettings(doc, override);
  const warnings: string[] = [];
  const layers: MotionCompositeLayer[] = [];
  const clips: MotionClip[] = [];

  // The bottom plate always exists, even empty: it is what paints the canvas
  // fill under a `contain`-fitted clip's transparent bars.
  let plate: { ids: string[]; bgParts: Record<string, BackgroundPart>; canvas: boolean } = {
    ids: [],
    bgParts: {},
    canvas: true,
  };
  const flush = () => {
    layers.push({
      kind: 'plate',
      ids: plate.ids,
      ...(Object.keys(plate.bgParts).length ? { bgParts: plate.bgParts } : {}),
      ...(plate.canvas ? { canvas: true } : {}),
    });
    plate = { ids: [], bgParts: {}, canvas: false };
  };

  for (const { el, box } of visibleLayers(doc, size.id)) {
    const url = resolveBinding(el.binding, data);
    const kind = el.type === 'image' || el.type === 'logo' || el.type === 'background' ? motionKind(url) : null;
    if (!kind) {
      plate.ids.push(el.id);
      continue;
    }

    // A moving background carries three things in one element; the fill goes
    // under the clip and the fade over it.
    if (el.type === 'background' && hasBaseFill(el)) {
      plate.ids.push(el.id);
      plate.bgParts[el.id] = 'base';
    }
    flush();

    const fit: ClipPlacement['fit'] = el.fit ?? (el.type === 'background' ? 'cover' : 'contain');
    if (fit === 'tile') {
      warnings.push(`“${labelFor(el)}” is set to Tile, which has no video form — the clip fills its box like Cover instead.`);
    }
    if (el.blendMode && el.blendMode !== 'normal') {
      warnings.push(`The ${el.blendMode} blend mode on “${labelFor(el)}” is applied to still exports only, not to the MP4.`);
    }
    const clip: MotionClip = {
      elId: el.id,
      label: labelFor(el),
      url,
      kind,
      trimStart: Math.max(0, el.trimStart ?? 0),
      placement: {
        x: box.x * size.width,
        y: box.y * size.height,
        w: box.w * size.width,
        h: box.h * size.height,
        fit,
        focalX: box.objectX,
        focalY: box.objectY,
        // Crop zoom ONLY where the still renderer applies it: on an image/logo
        // element with a cover fit. A `background` element's texture ignores
        // `objectScale` in CSS, so honouring it here would crop the MP4 tighter
        // than the PNG of the same ad.
        ...(el.type !== 'background' && fit !== 'contain' ? { zoom: box.objectScale } : {}),
        opacity: clipOpacity(el),
        fps: settings.fps,
        ...(hasRoundedCorners(cornerRadii(el)) ? { radii: cornerRadii(el) } : {}),
      },
    };
    clips.push(clip);
    layers.push({ kind: 'clip', clip });

    if (el.type === 'background' && el.overlay) {
      plate.ids.push(el.id);
      plate.bgParts[el.id] = 'overlay';
    }
  }
  flush();

  if (clips.length > CLIP_WARN_AT) {
    warnings.push(
      `This design composites ${clips.length} clips. Every extra clip is another video decoded per size, so the export will be slow.`,
    );
  }

  return { hasMotion: clips.length > 0, layers, clips, settings, warnings };
}

/** Does this ad move at THIS size? (A clip hidden on the square but shown on the
 *  story is a real case, so motion is a per-size answer.) */
export function sizeHasMotion(doc: TemplateDoc, data: AdData, size: AdSize): boolean {
  return planMotionComposite(doc, data, size).hasMotion;
}

/** Does this ad move at ANY of its sizes? Drives whether the UI offers an MP4 at
 *  all, and whether a launch takes the video path. */
export function docHasMotion(doc: TemplateDoc, data: AdData, sizeIds?: string[]): boolean {
  const sizes = sizeIds?.length ? doc.sizes.filter((s) => sizeIds.includes(s.id)) : doc.sizes;
  return sizes.some((s) => sizeHasMotion(doc, data, s));
}
