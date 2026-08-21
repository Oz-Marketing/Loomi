import type { TemplateDoc } from './doc-types';

/**
 * Motion sources — the pure half of video/animated backgrounds.
 *
 * A motion layer is not a new element type. It is an ordinary `image` or
 * `background` element whose resolved URL happens to point at a clip, which is
 * why a designer places, crops, focal-points, rounds and layers video with the
 * exact controls they already know, and why every template written before this
 * existed keeps rendering unchanged.
 *
 * The consequence is that "does this ad move?" is a question about DATA, not
 * about the document's shape — so it gets answered here, in one place, by URL,
 * rather than by a flag someone has to remember to set.
 *
 * Pure (no Node, no browser): the renderer, the builder, the export route and the
 * Meta launch path all have to agree on the answer.
 */

/** What kind of moving source a URL points at. */
export type MotionKind = 'video' | 'gif';

/** Video containers we accept as a motion layer. `mov` is here because it is what
 *  comes out of a phone and off an OEM's asset portal; it is transcoded on export
 *  like everything else. */
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'm4v'];

/** MIME types that map to a motion source, for the upload/picker side where a
 *  URL may be opaque (a presigned S3 link carries no extension). */
export function isMotionMime(mime: string | null | undefined): boolean {
  const m = (mime ?? '').toLowerCase();
  return m.startsWith('video/') || m === 'image/gif';
}

/** `accept` list for a file input / picker that takes stills OR motion. */
export const MOTION_ACCEPT = 'video/mp4,video/webm,video/quicktime,image/gif';

/**
 * Which kind of motion a URL is, or null for a still.
 *
 * Extension-based, and query strings are stripped first so a signed URL still
 * classifies. A GIF is reported as motion — it animates in a browser and ffmpeg
 * reads it as frames — but it stays an `<img>` in the DOM (see the renderer),
 * because turning it into a `<video>` would break every existing template that
 * uses an animated GIF as a texture.
 */
export function motionKind(url: string | null | undefined): MotionKind | null {
  if (!url) return null;
  const clean = String(url).split(/[?#]/)[0].toLowerCase();
  // A data: URI carries its type instead of an extension.
  if (clean.startsWith('data:')) {
    if (clean.startsWith('data:image/gif')) return 'gif';
    return clean.startsWith('data:video/') ? 'video' : null;
  }
  const ext = clean.slice(clean.lastIndexOf('.') + 1);
  if (VIDEO_EXTS.includes(ext)) return 'video';
  return ext === 'gif' ? 'gif' : null;
}

/** Is this URL a moving source at all? */
export function isMotionUrl(url: string | null | undefined): boolean {
  return motionKind(url) !== null;
}

/**
 * MP4 defaults.
 *
 * Six seconds because that is the length social platforms actually watch: Meta
 * reports the bulk of feed video attention inside the first few seconds, and a
 * longer default only makes a heavier file for frames nobody sees. 30fps is the
 * floor at which pans read as smooth.
 */
export const MOTION_DEFAULTS = { durationSec: 6, fps: 30 } as const;

/** Hard bounds. A 60-second ad render on a one-vCPU box is a timeout, not a
 *  feature — and the cap is also what keeps an accidental `durationSec: 600`
 *  from pinning the render queue. */
export const MOTION_LIMITS = { minSec: 1, maxSec: 30, minFps: 12, maxFps: 60 } as const;

export interface MotionSettings {
  durationSec: number;
  fps: number;
}

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** The doc's motion settings, clamped, with defaults filled in. */
export function motionSettings(
  doc: Pick<TemplateDoc, 'motion'> | null | undefined,
  override?: Partial<MotionSettings>,
): MotionSettings {
  const raw = { ...(doc?.motion ?? {}), ...(override ?? {}) };
  return {
    durationSec: clampNum(raw.durationSec, MOTION_LIMITS.minSec, MOTION_LIMITS.maxSec, MOTION_DEFAULTS.durationSec),
    fps: Math.round(clampNum(raw.fps, MOTION_LIMITS.minFps, MOTION_LIMITS.maxFps, MOTION_DEFAULTS.fps)),
  };
}

// ── ffmpeg filter construction ───────────────────────────────────────────────
//
// Kept here, beside the model, and pure: the filtergraph is where a crop is
// silently wrong by a few pixels, and a string this fiddly deserves tests that
// don't need a video file or a binary on PATH.

export interface ClipPlacement {
  /** Destination box in canvas pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** How the clip fills its box. `tile` is treated as `cover` (see clipFilter). */
  fit: 'cover' | 'contain' | 'tile';
  /** Focal point 0..1 for a cover crop. Defaults to centre. */
  focalX?: number;
  focalY?: number;
  /** Crop zoom (>= 1) past the cover fit, pivoting on the focal point. */
  zoom?: number;
  /** Layer opacity 0..100. */
  opacity?: number;
  fps: number;
  /**
   * Corner radii in px, [TL, TR, BR, BL], when the layer is rounded.
   *
   * Present because a rounded video card is ordinary social design, and a still
   * that rounds while the MP4 squares off is exactly the kind of quiet difference
   * a co-op-approved layout can't afford. The compositor turns these into an
   * alpha mask; see `roundedMaskSvg`.
   */
  radii?: [number, number, number, number];
}

/** Are any of a clip's corners actually rounded? */
export function hasRoundedCorners(radii?: [number, number, number, number]): boolean {
  return Boolean(radii?.some((r) => r > 0));
}

/**
 * A white-on-black rounded rectangle, as SVG — the alpha mask for a rounded clip.
 *
 * White is opaque and black is transparent: ffmpeg's `alphamerge` reads the
 * mask's LUMA as the clip's alpha, so the shape has to be drawn in brightness
 * rather than in alpha (a transparent-cornered PNG would flatten to black and
 * mask nothing).
 */
export function roundedMaskSvg(w: number, h: number, radii: [number, number, number, number]): string {
  // Clamp each corner to what the box can hold, matching how a browser resolves
  // an over-large border-radius.
  const max = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = radii.map((r) => Math.max(0, Math.min(max, r))) as [number, number, number, number];
  const d = [
    `M ${tl} 0`,
    `H ${w - tr}`,
    tr ? `A ${tr} ${tr} 0 0 1 ${w} ${tr}` : `V 0`,
    `V ${h - br}`,
    br ? `A ${br} ${br} 0 0 1 ${w - br} ${h}` : `H ${w}`,
    `H ${bl}`,
    bl ? `A ${bl} ${bl} 0 0 1 0 ${h - bl}` : `H 0`,
    `V ${tl}`,
    tl ? `A ${tl} ${tl} 0 0 1 ${tl} 0` : `V 0`,
    'Z',
  ].join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#000"/><path d="${d}" fill="#fff"/></svg>`;
}

/** Round to an even integer — h264 chroma subsampling wants even dimensions, and
 *  an odd intermediate is where "height not divisible by 2" comes from. */
export function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/**
 * Layer opacity as a filter step, or '' at full opacity.
 *
 * Separate from the fit so it can be applied AFTER a corner mask: the mixer
 * SCALES the alpha channel, so masking then fading keeps the rounded corners,
 * while fading then masking would throw the fade away.
 */
export function clipOpacityFilter(opacity?: number): string {
  if (opacity == null || opacity >= 100) return '';
  return `colorchannelmixer=aa=${(Math.max(0, opacity) / 100).toFixed(4)}`;
}

/**
 * The fit half of a clip's chain: scale + crop to its box and normalise the
 * frame rate, leaving alpha untouched.
 *
 * The crop mirrors the CSS the still renderer emits (`object-fit` +
 * `object-position` + the zoom transform) rather than approximating it, because
 * the MP4 and the PNG of the same ad have to frame the vehicle identically.
 */
export function clipFitFilter(p: ClipPlacement): string {
  const w = even(p.w);
  const h = even(p.h);
  const fx = Math.min(1, Math.max(0, p.focalX ?? 0.5));
  const fy = Math.min(1, Math.max(0, p.focalY ?? 0.5));
  const zoom = p.zoom && p.zoom > 1 ? p.zoom : 1;
  const steps: string[] = [];
  // Alpha first: `pad` and `colorchannelmixer` both need a channel to write to,
  // and a source that arrives as yuv420p has none.
  steps.push('format=rgba');
  if (p.fit === 'contain') {
    // Letterbox inside the box, transparent bars — so whatever the designer put
    // behind the clip shows through instead of a black band.
    steps.push(`scale=w=${w}:h=${h}:force_original_aspect_ratio=decrease`);
    steps.push(`pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black@0`);
  } else {
    // cover (and tile, which has no video meaning — a repeating clip is a
    // different feature, so it fills like cover and the plan warns).
    const sw = even(w * zoom);
    const sh = even(h * zoom);
    steps.push(`scale=w=${sw}:h=${sh}:force_original_aspect_ratio=increase`);
    steps.push(`crop=${w}:${h}:(in_w-out_w)*${fx.toFixed(4)}:(in_h-out_h)*${fy.toFixed(4)}`);
  }
  steps.push(`fps=${p.fps}`);
  steps.push('setpts=PTS-STARTPTS');
  return steps.join(',');
}

/** Fit + opacity in one chain — the whole treatment for a clip with square
 *  corners. A rounded clip composes the two around its mask instead. */
export function clipFilter(p: ClipPlacement): string {
  return [clipFitFilter(p), clipOpacityFilter(p.opacity)].filter(Boolean).join(',');
}

/** Where a clip's scaled box lands on the canvas (even-aligned to match
 *  {@link clipFilter}, so the overlay can't be a pixel off its crop). */
export function overlayPosition(p: Pick<ClipPlacement, 'x' | 'y'>): { x: number; y: number } {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}
