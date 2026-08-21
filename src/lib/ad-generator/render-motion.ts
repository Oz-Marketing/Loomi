import { createWriteStream } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { renderDoc } from './doc-renderer';
import { renderAdBatch, type RenderAdItem } from './render';
import { prepareRenderData } from './render-creative';
import { enrichOfferFields } from './offer-text';
import sharp from 'sharp';
import {
  clipFitFilter,
  clipOpacityFilter,
  even,
  hasRoundedCorners,
  roundedMaskSvg,
  type MotionSettings,
} from './motion';
import { planMotionComposite, type MotionClip, type MotionPlan } from './motion-plan';
import { posterizeMotion } from './posterize';
import { FfmpegUnavailableError, isFfmpegAvailable, runFfmpeg } from '@/lib/render/ffmpeg';
import type { TemplateDoc } from './doc-types';
import type { AdData, AdSize } from './types';

/**
 * Motion export — the same ad, as an MP4.
 *
 * The design is rasterised ONCE per plate by the renderer that makes the PNG, and
 * ffmpeg composites the clip between those plates (see `motion-plan.ts` for why
 * plates rather than frame capture). So the video is the still export, with the
 * background moving — not a second interpretation of the template that can drift
 * from it.
 *
 * Every ad also comes back with a POSTER: the ordinary still render, frozen on
 * the frame the video opens on. Meta requires a thumbnail for a video ad, and
 * taking it from our own renderer means the thumbnail and the first frame agree.
 *
 * Server-only: Chromium, ffmpeg, the filesystem and (optionally) S3.
 */

/** Refuse a source bigger than this rather than pull it onto a small droplet.
 *  The media library's own video ceiling is 200MB; a source that large is raw
 *  camera footage, and transcoding it per size is not what this is for. */
const MAX_SOURCE_BYTES = 120 * 1024 * 1024;

export interface MotionRender {
  sizeId: string;
  label: string;
  width: number;
  height: number;
  /** H.264/MP4 bytes, silent (see the encoder args). */
  mp4: Buffer;
  /** The matching still, on the video's first frame. */
  poster: Buffer;
  durationSec: number;
  fps: number;
  /** Fidelity notes from the plan (blend modes, tile fits, clip count). */
  warnings: string[];
}

export interface RenderMotionInput {
  doc: TemplateDoc;
  /** Ad data. Template defaults are merged underneath, as in every render. */
  data: AdData;
  accountKey?: string;
  /** Sizes to render. Defaults to every size that actually moves. */
  sizeIds?: string[];
  /** Overrides the doc's own duration/fps (the export dialog's controls). */
  settings?: Partial<MotionSettings>;
  /** Admin font roll-up — see `prepareRenderData`. Set by the interactive route,
   *  never by a worker. */
  unrestrictedFonts?: boolean;
}

/** Is video export possible on this server at all? */
export function motionExportAvailable(): Promise<boolean> {
  return isFfmpegAvailable();
}

/** Pull a clip to disk. Streamed, never buffered: a 100MB source held in memory
 *  on a 2GB box is the difference between a slow export and a dead process. */
async function fetchClip(url: string, dest: string): Promise<void> {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    const meta = url.slice(0, comma);
    const payload = url.slice(comma + 1);
    if (!meta.includes(';base64')) throw new Error('Only base64 data: clips are supported');
    const buf = Buffer.from(payload, 'base64');
    if (buf.length > MAX_SOURCE_BYTES) throw new Error('That clip is too large to export');
    await writeFile(dest, buf);
    return;
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Could not fetch the clip (${res.status})`);
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared && declared > MAX_SOURCE_BYTES) {
    throw new Error(
      `That clip is ${Math.round(declared / 1024 / 1024)}MB — too large to export. Compress it, or trim it first.`,
    );
  }
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(dest));
}

/** ffmpeg input args for one clip: start at the trim point and loop forever, so a
 *  two-second clip fills a six-second ad instead of freezing on its last frame. */
function clipInputArgs(clip: MotionClip, path: string, durationSec: number): string[] {
  const seek = clip.trimStart > 0 ? ['-ss', clip.trimStart.toFixed(3)] : [];
  // A GIF loops with -ignore_loop, a video with -stream_loop; using the wrong one
  // silently produces a clip that stops early and holds its last frame.
  const loop = clip.kind === 'gif' ? ['-ignore_loop', '0'] : ['-stream_loop', '-1'];
  return [...loop, ...seek, '-t', durationSec.toFixed(3), '-i', path];
}

/** Which ffmpeg inputs a layer occupies. */
interface LayerInputs {
  /** The plate PNG, or the clip. */
  index: number;
  /** A rounded-corner alpha mask, when the clip is rounded. */
  maskIndex?: number;
}

/** The whole filtergraph: plates and clips stacked in the plan's order. */
function buildFilterGraph(params: {
  plan: MotionPlan;
  /** Inputs per layer, in plan order. */
  inputs: LayerInputs[];
  width: number;
  height: number;
  fps: number;
}): string {
  const { plan, inputs, width, height, fps } = params;
  const chains: string[] = [];
  const labels: string[] = [];

  plan.layers.forEach((layer, i) => {
    const src = `${inputs[i].index}:v`;
    const label = `l${i}`;
    if (layer.kind === 'plate') {
      // A plate is a still PNG at canvas size: normalise its rate and give it an
      // alpha channel so it can be laid over the clip beneath it.
      chains.push(`[${src}]scale=${width}:${height},fps=${fps},format=rgba,setpts=PTS-STARTPTS[${label}]`);
    } else {
      const p = { ...layer.clip.placement, fps };
      const maskIndex = inputs[i].maskIndex;
      if (maskIndex == null) {
        chains.push(`[${src}]${[clipFitFilter(p), clipOpacityFilter(p.opacity)].filter(Boolean).join(',')}[${label}]`);
      } else {
        // Round the corners by MULTIPLYING the clip's alpha by the mask, not by
        // replacing it. `alphamerge` alone overwrites alpha, which turns a
        // `contain` fit's transparent letterbox bars into opaque black inside the
        // rounded rect — the design's background stops showing through the very
        // gap it was meant to show through.
        chains.push(`[${src}]${clipFitFilter(p)},split=2[${label}a][${label}b]`);
        chains.push(`[${maskIndex}:v]format=gray,fps=${fps},setpts=PTS-STARTPTS[${label}m]`);
        chains.push(`[${label}b]alphaextract[${label}e]`);
        chains.push(`[${label}e][${label}m]blend=all_mode=multiply[${label}am]`);
        // Fade last: `colorchannelmixer` SCALES alpha, so it composes with the
        // rounding instead of discarding it.
        const fade = clipOpacityFilter(p.opacity);
        chains.push(`[${label}a][${label}am]alphamerge${fade ? `,${fade}` : ''}[${label}]`);
      }
    }
    labels.push(label);
  });

  // Stack: each layer over the accumulated result, at its own position.
  let acc = labels[0];
  plan.layers.forEach((layer, i) => {
    if (i === 0) return;
    const out = `c${i}`;
    const x = layer.kind === 'clip' ? Math.round(layer.clip.placement.x) : 0;
    const y = layer.kind === 'clip' ? Math.round(layer.clip.placement.y) : 0;
    // `shortest=0` + `eof_action=pass`: the plates are -t-limited stills and the
    // clips loop, so nothing should be allowed to cut the composite short.
    chains.push(`[${acc}][${labels[i]}]overlay=${x}:${y}:format=auto:eof_action=pass:shortest=0[${out}]`);
    acc = out;
  });

  // yuv420p is not optional: it is what every social platform (and QuickTime)
  // will actually decode.
  chains.push(`[${acc}]format=yuv420p[out]`);
  return chains.join(';');
}

/**
 * Render each moving size to an MP4 + poster.
 *
 * Sizes that carry no clip are skipped rather than exported as a still video —
 * a caller that wants those wants the PNG pipeline, and silently handing back a
 * six-second freeze frame would hide the fact that nothing moves there.
 */
export async function renderMotionSizes({
  doc,
  data,
  accountKey,
  sizeIds,
  settings,
  unrestrictedFonts,
}: RenderMotionInput): Promise<MotionRender[]> {
  if (!(await motionExportAvailable())) throw new FfmpegUnavailableError();

  const merged = enrichOfferFields(
    await prepareRenderData(doc, data, accountKey, { unrestricted: unrestrictedFonts }),
  );
  const chosen: AdSize[] = sizeIds?.length ? doc.sizes.filter((s) => sizeIds.includes(s.id)) : doc.sizes;

  // Plan first: it decides which sizes move, and how many plates each needs.
  const planned = chosen
    .map((size) => ({ size, plan: planMotionComposite(doc, merged, size, settings) }))
    .filter((p) => p.plan.hasMotion);
  if (!planned.length) {
    throw new Error('Nothing in this ad moves — no video or animated layer at the sizes you picked.');
  }

  // ── one Chromium session for every plate AND every poster ──
  //
  // Launching the browser dominates latency (the same reason the PNG batch
  // exists), and a four-size motion export needs a dozen rasterisations.
  //
  // The POSTER renders from a posterized copy (clips already swapped for their
  // frames) while the PLATES render from the original — a plate must still see a
  // clip in order to leave a hole for it.
  const still = await posterizeMotion(doc, merged);
  const items: RenderAdItem[] = [];
  const index: { sizeIdx: number; kind: 'poster' | 'plate'; layerIdx?: number }[] = [];
  planned.forEach(({ size, plan }, sizeIdx) => {
    // The poster is the ordinary still export, at export density.
    items.push({ html: renderDoc(still.doc, still.data, size, {}), width: size.width, height: size.height, scale: 2 });
    index.push({ sizeIdx, kind: 'poster' });
    plan.layers.forEach((layer, layerIdx) => {
      if (layer.kind !== 'plate') return;
      items.push({
        html: renderDoc(doc, merged, size, { plate: { ids: layer.ids, bgParts: layer.bgParts, canvas: layer.canvas } }),
        width: size.width,
        height: size.height,
        // Native density: the MP4 is encoded at the canvas's own pixel size, so a
        // 2× plate would only be downscaled again.
        scale: 1,
        // The bottom plate is the opaque ground; everything above it must keep its
        // alpha or it would black out the clip underneath.
        transparent: !layer.canvas,
      });
      index.push({ sizeIdx, kind: 'plate', layerIdx });
    });
  });
  const shots = await renderAdBatch(items);

  const dir = await mkdtemp(join(tmpdir(), 'loomi-motion-'));
  try {
    // One download per distinct source, shared across sizes — the same background
    // clip usually appears at every aspect ratio.
    const clipPaths = new Map<string, string>();
    let clipSeq = 0;
    const pathForClip = async (clip: MotionClip): Promise<string> => {
      const cached = clipPaths.get(clip.url);
      if (cached) return cached;
      const ext = clip.kind === 'gif' ? 'gif' : 'mp4';
      const dest = join(dir, `src-${clipSeq++}.${ext}`);
      await fetchClip(clip.url, dest);
      clipPaths.set(clip.url, dest);
      return dest;
    };

    const out: MotionRender[] = [];
    for (let sizeIdx = 0; sizeIdx < planned.length; sizeIdx++) {
      const { size, plan } = planned[sizeIdx];
      const width = even(size.width);
      const height = even(size.height);
      const { durationSec, fps } = plan.settings;

      // Write this size's plates (and any corner masks) out, and collect ffmpeg
      // inputs in plan order.
      const args: string[] = [];
      const inputs: LayerInputs[] = [];
      let nextInput = 0;
      for (let layerIdx = 0; layerIdx < plan.layers.length; layerIdx++) {
        const layer = plan.layers[layerIdx];
        if (layer.kind === 'plate') {
          const shotAt = index.findIndex((m) => m.sizeIdx === sizeIdx && m.kind === 'plate' && m.layerIdx === layerIdx);
          const platePath = join(dir, `plate-${sizeIdx}-${layerIdx}.png`);
          await writeFile(platePath, shots[shotAt]);
          args.push('-loop', '1', '-t', durationSec.toFixed(3), '-i', platePath);
          inputs.push({ index: nextInput++ });
          continue;
        }
        args.push(...clipInputArgs(layer.clip, await pathForClip(layer.clip), durationSec));
        const entry: LayerInputs = { index: nextInput++ };
        const { radii, w, h } = layer.clip.placement;
        if (hasRoundedCorners(radii)) {
          // Rasterised with sharp rather than another Chromium shot: it's one small
          // SVG, and the browser is already busy with the plates.
          const maskPath = join(dir, `mask-${sizeIdx}-${layerIdx}.png`);
          const svg = roundedMaskSvg(even(w), even(h), radii!);
          await writeFile(maskPath, await sharp(Buffer.from(svg)).png().toBuffer());
          args.push('-loop', '1', '-t', durationSec.toFixed(3), '-i', maskPath);
          entry.maskIndex = nextInput++;
        }
        inputs.push(entry);
      }

      const mp4Path = join(dir, `out-${sizeIdx}.mp4`);
      await runFfmpeg(
        [
          ...args,
          '-filter_complex',
          buildFilterGraph({ plan, inputs, width, height, fps }),
          '-map',
          '[out]',
          '-c:v',
          'libx264',
          // veryfast, not slower: this runs on a shared one-vCPU box, and the extra
          // minutes a better preset costs buy a few percent of file size on a clip
          // nobody will scrub through.
          '-preset',
          'veryfast',
          '-crf',
          '21',
          '-profile:v',
          'high',
          '-level',
          '4.0',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          '-r',
          String(fps),
          '-t',
          durationSec.toFixed(3),
          // Silent, deliberately. A feed autoplays muted, and shipping a soundtrack
          // would mean shipping music licensing with it.
          '-an',
          mp4Path,
        ],
        // Scaled to the ad's length: the default would fail a legitimate 30-second
        // render on a slow box, and a flat 10 minutes would let a wedged encode sit
        // there holding the only slot.
        { timeoutMs: Math.min(480_000, Math.max(120_000, durationSec * 15_000)) },
      );

      const posterAt = index.findIndex((m) => m.sizeIdx === sizeIdx && m.kind === 'poster');
      out.push({
        sizeId: size.id,
        label: size.label,
        width,
        height,
        mp4: await readFile(mp4Path),
        poster: shots[posterAt],
        durationSec,
        fps,
        warnings: plan.warnings,
      });
    }
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => null);
  }
}

/*
 * There is deliberately no `renderMotionToS3` counterpart to `renderCreativeToS3`.
 *
 * The still pipeline persists at GENERATION time because a thumbnail is what the
 * review queue shows. Video isn't: encoding an MP4 per size for every generated
 * draft — most of which are never launched — would spend minutes of a shared
 * one-vCPU box on artifacts nobody asked for, and the launch path re-renders from
 * the ad's own doc anyway. So video is produced when it is exported or published,
 * and a draft's thumbnail stays the poster frame.
 */
