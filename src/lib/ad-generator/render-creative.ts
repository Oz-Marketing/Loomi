import { adTemplateFromDoc } from './doc-template';
import { renderAdBatch } from './render';
import { usedFontFamilies } from './fonts';
import { embedAccountFontCss, googleFontFaceCss } from './render-fonts';
import { usedGoogleFontFamilies } from './google-fonts';
import type { TemplateDoc } from './doc-types';
import type { AdData } from './types';
import { stillRenderFor } from './posterize';
import { buildS3Key, isS3Configured, s3PublicUrl, uploadToS3 } from '@/lib/s3';

/**
 * Headless creative rendering — render a `TemplateDoc` + `AdData` to PNGs, and
 * (optionally) persist them to S3.
 *
 * The existing render routes stream a download to the browser and keep nothing,
 * which is fine for a human clicking Export but useless to a worker that has to
 * leave something behind. This is the same pipeline — same doc, same font
 * embedding, same `renderAdBatch` — ending in bytes the caller can store.
 *
 * Server-only: launches Chromium and touches S3.
 */

/** Merge template defaults under the supplied data, exactly as the renderer does.
 *
 *  ⚠️ Anything gated on the ad's values — preflight above all — MUST run against
 *  THIS merged result, not the raw patch. A field absent from `data` is not
 *  absent at render time: it falls back to the template default, which for the
 *  offer numbers is deliberate placeholder scaffolding ("X,XXX"). Checking the
 *  unmerged data would therefore miss exactly the leak preflight exists to stop. */
export function mergeRenderData(doc: TemplateDoc, data: AdData): AdData {
  return { ...doc.defaults, ...data };
}

/**
 * Merge the data and inline every font the design uses — the shared preamble of
 * any headless render.
 *
 * Extracted because the MP4 pipeline needs the identical treatment: its plates are
 * the same design rasterised by the same renderer, so a font resolved differently
 * there would make the video and the PNG two different ads.
 */
export async function prepareRenderData(
  doc: TemplateDoc,
  data: AdData,
  accountKey?: string,
  opts?: {
    /** Roll up every account's fonts (an admin acting across accounts), instead of
     *  scoping to `accountKey`. Never set from a worker: there is no session for a
     *  worker to be unrestricted on behalf of. */
    unrestricted?: boolean;
  },
): Promise<AdData> {
  const merged = mergeRenderData(doc, data);

  // Embed the fonts the design actually uses. Scoped to this sub-account rather
  // than the admin-style roll-up the interactive route can do: a worker has no
  // session to be "unrestricted" on behalf of, and an account's own brand fonts
  // are what its ads should render in.
  const families = usedFontFamilies(doc.elements, [merged.fontFamily]);
  const withFonts = await embedAccountFontCss(accountKey, { ...merged }, { families, unrestricted: opts?.unrestricted });

  // Inline any curated Google fonts too — a one-shot screenshot must never race
  // a stylesheet fetch.
  const googleCss = await googleFontFaceCss(usedGoogleFontFamilies(doc.elements, withFonts.fontFamily));
  if (googleCss) withFonts.fontFaceCss = `${withFonts.fontFaceCss ?? ''}\n${googleCss}`;
  return withFonts;
}

export interface RenderedSize {
  sizeId: string;
  label: string;
  width: number;
  height: number;
  png: Buffer;
}

export interface RenderCreativeInput {
  doc: TemplateDoc;
  /** Ad data. Template defaults are merged underneath (see mergeRenderData). */
  data: AdData;
  /** Scopes custom-font embedding to this sub-account's uploaded brand fonts. */
  accountKey?: string;
  /** Sizes to render. Defaults to every size the doc defines. */
  sizeIds?: string[];
  /** Pixel density. 2 = retina, matching the interactive export. */
  scale?: number;
}

/**
 * Render the creative at each requested size. One Chromium session for the whole
 * batch — launching the browser dominates latency, so a per-size loop would be
 * dramatically slower for a template with four sizes.
 */
export async function renderCreativeSizes({
  doc,
  data,
  accountKey,
  sizeIds,
  scale = 2,
}: RenderCreativeInput): Promise<RenderedSize[]> {
  // Checked before any work: posterizing and embedding fonts for a size list that
  // matches nothing is wasted effort.
  const sizes = sizeIds?.length ? doc.sizes.filter((s) => sizeIds.includes(s.id)) : doc.sizes;
  if (sizes.length === 0) throw new Error('No sizes to render');

  const withFonts = await prepareRenderData(doc, data, accountKey);

  // A clip becomes its poster frame before Chromium sees it — production's
  // headless browser has no H.264 decoder, so a video layer would otherwise
  // rasterise as a hole. No-op for a still ad. See lib/ad-generator/posterize.ts.
  const still = await stillRenderFor({ doc, template: adTemplateFromDoc(doc.id, doc), data: withFonts });
  const template = still.template;

  const pngs = await renderAdBatch(
    sizes.map((size) => ({
      html: template.render(still.data, size),
      width: size.width,
      height: size.height,
      scale,
    })),
  );

  return sizes.map((size, i) => ({
    sizeId: size.id,
    label: size.label,
    width: size.width,
    height: size.height,
    png: pngs[i],
  }));
}

export interface PersistedRender extends Omit<RenderedSize, 'png'> {
  url: string;
  key: string;
  bytes: number;
}

export interface RenderToS3Input extends RenderCreativeInput {
  /**
   * Stable identifier for this creative — becomes part of the S3 key, so the
   * SAME creative re-rendered overwrites its previous PNGs instead of piling up
   * a new copy on every run. Use the creative id (or, before one exists, the
   * offer fingerprint).
   */
  creativeId: string;
}

/**
 * Render and persist to S3, returning stable public URLs.
 *
 * Throws when S3 isn't configured — a caller that just wants pixels (a dry run,
 * a preview) should use {@link renderCreativeSizes} instead of silently getting
 * no artifacts.
 */
export async function renderCreativeToS3({
  creativeId,
  ...input
}: RenderToS3Input): Promise<PersistedRender[]> {
  if (!isS3Configured()) {
    throw new Error('S3 is not configured — cannot persist rendered ads');
  }
  const rendered = await renderCreativeSizes(input);

  const out: PersistedRender[] = [];
  for (const r of rendered) {
    // Deterministic: same creative + same size = same object.
    const key = buildS3Key(input.accountKey ?? null, `adgen-${creativeId}`, `${r.sizeId}.png`);
    await uploadToS3(key, r.png, 'image/png');
    out.push({
      sizeId: r.sizeId,
      label: r.label,
      width: r.width,
      height: r.height,
      url: s3PublicUrl(key),
      key,
      bytes: r.png.length,
    });
  }
  return out;
}
