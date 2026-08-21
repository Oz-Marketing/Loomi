import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveBinding } from './doc-renderer';
import { adTemplateFromDoc } from './doc-template';
import { motionKind } from './motion';
import { isFfmpegAvailable, runFfmpeg } from '@/lib/render/ffmpeg';
import type { DocElement, TemplateDoc } from './doc-types';
import type { AdData, AdTemplate } from './types';

/**
 * Turn a moving ad into a still one BEFORE Chromium sees it, by replacing each
 * clip with the frame it should be frozen on.
 *
 * WHY THIS EXISTS. The renderer emits a real `<video>`, and the screenshot
 * pipeline pauses it on `trimStart` — which works in a browser and on a developer
 * machine. Production's headless browser is a stripped Chromium build with no
 * proprietary codecs, so an H.264 clip there decodes to nothing and the PNG
 * export of a video ad would come back with a hole where the background should
 * be — and Meta's video thumbnail is that same render.
 *
 * Handing Chromium a PNG instead removes the question entirely: no codec, no
 * decode, no seek to race. It's also cheaper — ffmpeg reads one frame from a
 * remote URL without pulling the whole clip through the browser.
 *
 * Best-effort by design: with no ffmpeg on the box this returns the doc untouched
 * and the in-page freeze remains the fallback, so a still export never fails just
 * because it couldn't be optimised.
 *
 * Server-only.
 */

/** Cap the extracted frame's width. Retina export of the largest ad size is
 *  ~2160px; anything beyond that is a bigger data: URI for pixels nobody sees. */
const MAX_FRAME_WIDTH = 2160;

/** Elements whose content is a clip, in doc order. */
function motionElements(doc: TemplateDoc, data: AdData): DocElement[] {
  return (doc.elements ?? []).filter(
    (el) =>
      (el.type === 'image' || el.type === 'logo' || el.type === 'background') &&
      motionKind(resolveBinding(el.binding, data)) !== null,
  );
}

/** Does this ad have any clip at all? (Cheap; no ffmpeg, no I/O.) */
export function hasMotionSource(doc: TemplateDoc, data: AdData): boolean {
  return motionElements(doc, data).length > 0;
}

export interface PosterizeResult {
  doc: TemplateDoc;
  data: AdData;
  /** How many clips were replaced. 0 = nothing to do, or no encoder available. */
  posterized: number;
}

/**
 * Replace every clip in `doc`/`data` with a `data:` PNG of its poster frame.
 *
 * Returns new objects; the inputs are untouched (a doc is shared with the caller's
 * other renders, and one of those may be the MP4 export that needs the real clip).
 */
export async function posterizeMotion(doc: TemplateDoc, data: AdData): Promise<PosterizeResult> {
  const clips = motionElements(doc, data);
  if (!clips.length || !(await isFfmpegAvailable())) return { doc, data, posterized: 0 };

  const dir = await mkdtemp(join(tmpdir(), 'loomi-poster-'));
  try {
    // One extraction per (source, timestamp): the same background clip usually
    // appears on several elements and at every size.
    const frames = new Map<string, string>();
    let seq = 0;
    const nextData = { ...data };
    const replacements = new Map<string, string>();

    for (const el of clips) {
      const url = resolveBinding(el.binding, data);
      const at = Math.max(0, el.trimStart ?? 0);
      const cacheKey = `${url}@${at}`;
      let dataUri = frames.get(cacheKey);
      if (dataUri === undefined) {
        const out = join(dir, `frame-${seq++}.png`);
        try {
          await runFfmpeg(
            [
              // Input seeking, so ffmpeg jumps to the frame instead of decoding up
              // to it — the difference between instant and a whole clip decoded.
              ...(at > 0 ? ['-ss', at.toFixed(3)] : []),
              '-i',
              url,
              '-frames:v',
              '1',
              '-vf',
              `scale='min(${MAX_FRAME_WIDTH},iw)':-2`,
              out,
            ],
            { timeoutMs: 60_000 },
          );
          dataUri = `data:image/png;base64,${(await readFile(out)).toString('base64')}`;
        } catch {
          // A source we can't read is left as-is: the renderer will show the same
          // empty layer the preview showed, which is the honest outcome.
          dataUri = '';
        }
        frames.set(cacheKey, dataUri);
      }
      if (dataUri) replacements.set(el.id, dataUri);
    }
    if (!replacements.size) return { doc, data, posterized: 0 };

    const elements = doc.elements.map((el) => {
      const frame = replacements.get(el.id);
      if (!frame) return el;
      const b = el.binding;
      // A static binding is rewritten on the element. A field binding is rewritten
      // in the DATA instead, so every element sharing that field gets the frame —
      // including ones on other sizes.
      if (b?.kind === 'field') {
        nextData[b.key] = frame;
        return el;
      }
      return { ...el, binding: { kind: 'static' as const, value: frame } };
    });

    return { doc: { ...doc, elements }, data: nextData, posterized: replacements.size };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => null);
  }
}

/**
 * The still-render pair for an ad: the template and data to rasterise, with any
 * clip already replaced by its poster frame.
 *
 * The shape the interactive export routes want — they hold an `AdTemplate` (the
 * render function) and only sometimes the doc behind it. With no doc, or nothing
 * moving, or no encoder, the inputs come straight back and the render is exactly
 * what it was before this existed.
 */
export async function stillRenderFor(params: {
  template: AdTemplate;
  doc: TemplateDoc | null;
  /** Already merged over the template defaults. */
  data: AdData;
}): Promise<{ template: AdTemplate; data: AdData }> {
  const { template, doc, data } = params;
  if (!doc || !hasMotionSource(doc, data)) return { template, data };
  const posterized = await posterizeMotion(doc, data);
  if (!posterized.posterized) return { template, data };
  return {
    template: adTemplateFromDoc(template.id, posterized.doc),
    data: { ...posterized.doc.defaults, ...posterized.data },
  };
}
