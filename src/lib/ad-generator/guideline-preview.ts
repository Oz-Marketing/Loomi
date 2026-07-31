import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { launchBrowser } from '@/lib/render/chromium';

/**
 * Render page 1 of a guideline document to a small webp — the cover thumbnail on
 * the OEM guidelines page.
 *
 * WHY THIS ROUTE. Rasterizing a PDF needs a canvas. `pdfjs-dist` alone can parse a
 * document in Node but has nothing to draw on, and the usual fix (`canvas`,
 * `@napi-rs/canvas`) is a native module — a new compiled dependency on the droplets
 * for a thumbnail. Chromium is ALREADY installed and launched for ad rendering, and
 * it has a canvas. So pdf.js runs inside the page and Chromium does the drawing;
 * nothing new gets compiled anywhere.
 *
 * Chromium's own PDF viewer was the other option and is worse: screenshotting it
 * captures the viewer's toolbar and scrollbars, and its layout is version-dependent.
 * Driving pdf.js directly gives the bare page at a known size.
 *
 * The result is stored as a data URI on the row rather than as an S3 object. These
 * are ~20-40 KB, S3 isn't configured in every environment, and a preview that only
 * appears in production would be a preview nobody trusts. Capped so a pathological
 * cover can't bloat the row.
 */

/** Long edge of the stored thumbnail, in px. Enough to read a cover title. */
const THUMB_LONG_EDGE = 420;
/** Hard ceiling on the encoded data URI. A cover that won't fit is dropped. */
const MAX_DATA_URI_BYTES = 120 * 1024;
/** Give up rather than hold a Chromium page open on a pathological document. */
const RENDER_TIMEOUT_MS = 20_000;

export interface GuidelinePreview {
  /** `data:image/webp;base64,…` */
  dataUri: string;
  pageCount: number;
  width: number;
  height: number;
}

async function firstReadable(candidates: string[]): Promise<string> {
  for (const rel of candidates) {
    try {
      return await readFile(path.join(process.cwd(), 'node_modules', rel), 'utf8');
    } catch {
      // try the next layout — pdfjs has moved these between majors
    }
  }
  throw new Error(`pdfjs-dist: none of [${candidates.join(', ')}] found in node_modules`);
}

/**
 * The bundled pdf.js browser build plus its worker, read from node_modules.
 *
 * The worker is needed even though the document is already in memory: pdf.js v4
 * refuses to parse without a `workerSrc`, and there's no server behind
 * `setContent` to serve one from. It gets injected as a blob URL inside the page.
 * The `legacy` build is preferred — it targets older syntax and so survives
 * whatever Chromium the droplet's @sparticuz bundle pins.
 */
async function pdfJsSources(): Promise<{ lib: string; worker: string }> {
  const [lib, worker] = await Promise.all([
    firstReadable([
      'pdfjs-dist/legacy/build/pdf.min.mjs',
      'pdfjs-dist/legacy/build/pdf.mjs',
      'pdfjs-dist/build/pdf.min.mjs',
      'pdfjs-dist/build/pdf.mjs',
    ]),
    firstReadable([
      'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
      'pdfjs-dist/legacy/build/pdf.worker.mjs',
      'pdfjs-dist/build/pdf.worker.min.mjs',
      'pdfjs-dist/build/pdf.worker.mjs',
    ]),
  ]);
  return { lib, worker };
}

/** The pdf.js sources, read once per process — they're ~1MB and never change. */
let sourceCache: Promise<{ lib: string; worker: string }> | null = null;
function cachedSources() {
  sourceCache ??= pdfJsSources();
  return sourceCache;
}

export type RenderPreview = (bytes: Uint8Array, mimeType: string) => Promise<GuidelinePreview | null>;

/** Long edge for a page being READ rather than thumbnailed. */
export const READ_LONG_EDGE = 1600;
const READ_QUALITY = 82;

/**
 * Render one or many covers on a SINGLE browser.
 *
 * Worth having as its own entry point: importing the library launched a fresh
 * Chromium per document, and at 33 documents that was both slow and unreliable —
 * one render failed under the memory pressure of sequential launches, then
 * succeeded on its own. One browser, one page per document.
 *
 *   await withPreviewRenderer(async (render) => {
 *     for (const doc of docs) await render(doc.bytes, doc.mime);
 *   });
 */
export async function withPreviewRenderer<T>(fn: (render: RenderPreview) => Promise<T>): Promise<T> {
  // Held on an object rather than in a plain `let`: TypeScript's control flow can't
  // see the assignment made inside the closure below, and narrows a `let` to `never`
  // by the time the finally block runs.
  const held: { browser: Browser | null } = { browser: null };
  try {
    const render: RenderPreview = async (bytes, mimeType) => {
      // Mime check BEFORE the lazy launch, so a batch of Word documents never
      // starts Chromium at all.
      if (!mimeType.includes('pdf')) return null;
      held.browser ??= await launchBrowser();
      const page = await renderOn(held.browser, bytes);
      if (!page) return null;
      const dataUri = `data:image/webp;base64,${page.buffer.toString('base64')}`;
      // The cover is stored inline on the row, so it has to stay small. A cover
      // that won't fit is dropped rather than bloating the record — the register
      // works on the hash, and a missing thumbnail is cosmetic.
      if (dataUri.length > MAX_DATA_URI_BYTES) {
        console.warn(`[guideline-preview] cover too large (${dataUri.length}B) — skipping`);
        return null;
      }
      return { dataUri, pageCount: page.pageCount, width: page.width, height: page.height };
    };
    return await fn(render);
  } finally {
    await held.browser?.close().catch(() => {});
  }
}

/**
 * Render the first page of `bytes`. Returns null when the document can't be
 * rendered — an encrypted PDF, a Word file, a corrupt upload. Callers treat a
 * missing preview as cosmetic: the register works on the hash alone.
 *
 * Launches its own browser. For more than one document use
 * {@link withPreviewRenderer} instead.
 */
export async function renderGuidelinePreview(
  bytes: Uint8Array,
  mimeType: string,
): Promise<GuidelinePreview | null> {
  return withPreviewRenderer((render) => render(bytes, mimeType));
}

/**
 * Render a run of pages at reading resolution, for the in-page document viewer.
 *
 * Takes a LIST of page numbers so one browser launch can serve the page the reader
 * asked for plus its neighbours — the launch dominates the cost (~1s against ~150ms
 * per page after), so rendering the next page speculatively makes flipping feel
 * instant for what is effectively free.
 */
export async function renderGuidelinePages(
  bytes: Uint8Array,
  pageNumbers: number[],
): Promise<Map<number, RenderedPage>> {
  const out = new Map<number, RenderedPage>();
  if (pageNumbers.length === 0) return out;
  const held: { browser: Browser | null } = { browser: null };
  try {
    held.browser = await launchBrowser();
    for (const n of pageNumbers) {
      const rendered = await renderOn(held.browser, bytes, n, READ_LONG_EDGE, READ_QUALITY);
      // A page that fails is skipped rather than failing the batch — the reader
      // still gets the others, and a missing page reports itself in the UI.
      if (rendered) out.set(n, rendered);
    }
    return out;
  } catch (err) {
    console.warn('[guideline-preview] page render failed:', err instanceof Error ? err.message : err);
    return out;
  } finally {
    await held.browser?.close().catch(() => {});
  }
}

type Browser = Awaited<ReturnType<typeof launchBrowser>>;
type BrowserPage = Awaited<ReturnType<Browser['newPage']>>;

export interface RenderedPage {
  /** webp bytes. */
  buffer: Buffer;
  pageCount: number;
  width: number;
  height: number;
}

/**
 * Render one page of a PDF, against an already-open browser.
 *
 * `pageNumber` is 1-based and clamped to the document, so a stale bookmark asking
 * for page 900 of a 42-page manual gets the last page rather than an error.
 */
async function renderOn(
  browser: Browser,
  bytes: Uint8Array,
  pageNumber = 1,
  longEdge = THUMB_LONG_EDGE,
  quality = 72,
): Promise<RenderedPage | null> {
  let page: BrowserPage | null = null;
  try {
    const { lib: libSrc, worker: workerSrc } = await cachedSources();
    page = await browser.newPage();
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
    await page.setContent('<!doctype html><body style="margin:0"></body>');
    // The build is an ES module and exports onto `window.pdfjsLib` only when loaded
    // as one, so publish it explicitly rather than relying on a global side effect.
    await page.addScriptTag({
      content: `${libSrc}\nwindow.pdfjsLib = window.pdfjsLib || pdfjsLib;`,
      type: 'module',
    });

    // Hand the bytes over as base64. Passing a Uint8Array through evaluate()
    // serializes it into a plain object and pdf.js then rejects it.
    const b64 = Buffer.from(bytes).toString('base64');

    const result = (await page.evaluate(
      async (data: string, edge: number, worker: string, wanted: number) => {
        const w = window as unknown as {
          pdfjsLib?: { getDocument: (o: unknown) => { promise: Promise<unknown> }; GlobalWorkerOptions: { workerSrc: string } };
        };
        const lib = w.pdfjsLib;
        if (!lib) return null;
        // v4 will not parse without a workerSrc, and there's no server behind
        // setContent to serve one — so hand it the worker as a blob URL.
        lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
          new Blob([worker], { type: 'text/javascript' }),
        );

        const raw = atob(data);
        const buf = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);

        type Pg = {
          getViewport: (o: { scale: number }) => { width: number; height: number };
          render: (o: unknown) => { promise: Promise<void> };
        };
        const doc = (await lib.getDocument({ data: buf, disableFontFace: false, isEvalSupported: false })
          .promise) as { numPages: number; getPage: (n: number) => Promise<Pg> };
        // Clamp rather than throw: a stale link to page 900 of a 42-page document
        // should land on the last page, not error.
        const n = Math.min(Math.max(1, Math.round(wanted)), doc.numPages);
        const pg = await doc.getPage(n);

        const base = pg.getViewport({ scale: 1 });
        const scale = edge / Math.max(base.width, base.height);
        const vp = pg.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        // Guideline covers are designed on white; without this a transparent
        // background renders as black once flattened to webp.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await pg.render({ canvasContext: ctx, viewport: vp }).promise;

        return { png: canvas.toDataURL('image/png'), pageCount: doc.numPages };
      },
      b64,
      longEdge,
      workerSrc,
      pageNumber,
    )) as { png: string; pageCount: number } | null;

    if (!result?.png) return null;

    // Re-encode through sharp: webp is roughly a quarter of the PNG for this kind
    // of image, which is what keeps the data URI inside the row budget.
    const png = Buffer.from(result.png.split(',')[1] ?? '', 'base64');
    const webp = await sharp(png)
      .resize(longEdge, longEdge, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: webp.data,
      pageCount: result.pageCount,
      width: webp.info.width,
      height: webp.info.height,
    };
  } catch (err) {
    // A preview is cosmetic. Never let it fail an upload.
    console.warn('[guideline-preview] render failed:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    // Close the PAGE, not the browser — the caller may be rendering a batch.
    await page?.close().catch(() => {});
  }
}
