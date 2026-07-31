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
  /** Per-page plain text, when extraction was requested. Powers reader search. */
  pageText?: string[];
  /** Section headings with their start page, for labelling search results. */
  sections?: { page: number; title: string }[];
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

export interface RenderOptions {
  /** Also pull every page's plain text, for the reader's search. */
  withText?: boolean;
}

export type RenderPreview = (
  bytes: Uint8Array,
  mimeType: string,
  opts?: RenderOptions,
) => Promise<GuidelinePreview | null>;

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
    const render: RenderPreview = async (bytes, mimeType, opts) => {
      // Mime check BEFORE the lazy launch, so a batch of Word documents never
      // starts Chromium at all.
      if (!mimeType.includes('pdf')) return null;
      held.browser ??= await launchBrowser();
      const page = await renderOn(held.browser, bytes, 1, THUMB_LONG_EDGE, 72, opts?.withText);
      if (!page) return null;
      const dataUri = `data:image/webp;base64,${page.buffer.toString('base64')}`;
      // The cover is stored inline on the row, so it has to stay small. A cover
      // that won't fit is dropped rather than bloating the record — the register
      // works on the hash, and a missing thumbnail is cosmetic.
      if (dataUri.length > MAX_DATA_URI_BYTES) {
        console.warn(`[guideline-preview] cover too large (${dataUri.length}B) — skipping`);
        return null;
      }
      return {
        dataUri,
        pageCount: page.pageCount,
        width: page.width,
        height: page.height,
        pageText: page.pageText,
        sections: page.sections,
      };
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
  opts?: RenderOptions,
): Promise<GuidelinePreview | null> {
  return withPreviewRenderer((render) => render(bytes, mimeType, opts));
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
  /** Per-page plain text, when `withText` was set. */
  pageText?: string[];
  /**
   * Text-run geometry for THE RENDERED PAGE ONLY, in normalized 0..1 coordinates —
   * enough to draw search highlights over the page image. Per-page rather than
   * whole-document because the geometry is several times the size of the text and
   * the reader only ever highlights the page you're looking at.
   */
  items?: { s: number; n: number; x: number; y: number; w: number; h: number }[];
  /** Section headings with the page they start on, for search results. */
  sections?: { page: number; title: string }[];
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
  withText = false,
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

    // esbuild compiles this file with keepNames, which wraps every named function —
    // including helpers declared inside the evaluate callback below — in a `__name`
    // call. That helper only exists in the bundle, not in the page, so the callback
    // dies with "__name is not defined" the moment it declares a named function.
    // A no-op shim is the smallest fix that doesn't constrain how the callback is
    // written.
    await page.evaluate(() => {
      (window as unknown as { __name?: (f: unknown) => unknown }).__name ??= (f) => f;
    });

    // Hand the bytes over as base64. Passing a Uint8Array through evaluate()
    // serializes it into a plain object and pdf.js then rejects it.
    const b64 = Buffer.from(bytes).toString('base64');

    const result = (await page.evaluate(
      async (data: string, edge: number, worker: string, wanted: number, wantText: boolean) => {
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

        type TextRun = { str?: string; width?: number; height?: number; transform?: number[] };
        type Pg = {
          getViewport: (o: { scale: number }) => {
            width: number;
            height: number;
            transform: number[];
          };
          render: (o: unknown) => { promise: Promise<void> };
          getTextContent: () => Promise<{ items: TextRun[] }>;
        };
        const doc = (await lib.getDocument({ data: buf, disableFontFace: false, isEvalSupported: false })
          .promise) as {
          numPages: number;
          getPage: (n: number) => Promise<Pg>;
          getOutline?: () => Promise<unknown>;
          getDestination?: (id: string) => Promise<unknown>;
          getPageIndex?: (ref: unknown) => Promise<number>;
        };
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

        // ONE construction for both the page text and the run offsets.
        //
        // An earlier version joined the runs, then normalized whitespace over the
        // whole string. That shifts every character position, so the geometry
        // offsets no longer indexed the string the search runs against and
        // highlights landed in the wrong place. Normalize each run first, then
        // join, so text and offsets are produced by the same walk.
        const buildPage = (runs: TextRun[]) => {
          const parts: string[] = [];
          const spans: { s: number; n: number; run: TextRun }[] = [];
          let at = 0;
          for (const run of runs) {
            const str = (run.str ?? '').replace(/\s+/g, ' ').trim();
            if (!str) continue;
            if (parts.length) at += 1; // the ' ' this join will insert
            parts.push(str);
            spans.push({ s: at, n: str.length, run });
            at += str.length;
          }
          return { text: parts.join(' '), spans };
        };

        // Every page's text, while the document is already parsed — ~250ms for 60
        // pages, far less than opening the file a second time.
        let pageText: string[] | undefined;
        let sections: { page: number; title: string }[] | undefined;
        if (wantText) {
          pageText = [];
          for (let i = 1; i <= doc.numPages; i++) {
            const tc = await (await doc.getPage(i)).getTextContent();
            pageText.push(buildPage(tc.items).text);
          }

          // Section titles for the search results, so a hit reads "Section 8: SAF
          // Guidelines" rather than a bare page number.
          //
          // The PDF's own outline is authoritative where it exists. Most of these
          // documents ship without one, so the fallback reads the RUNNING HEADER off
          // each page: the largest text in the top band. That beats pattern-matching
          // the text, which failed two ways — it found nothing in documents that
          // don't say "Section N", and on Subaru it matched a cross-reference ("see
          // Section 8") on page 6 and reported Section 8 as starting 31 pages early.
          // Type size is what actually makes a header a header, in any document.
          sections = [];
          try {
            const outline = (await doc.getOutline?.()) as
              | { title?: string; dest?: unknown; items?: unknown[] }[]
              | null;
            const walk = async (nodes: { title?: string; dest?: unknown; items?: unknown[] }[]) => {
              for (const n of nodes) {
                try {
                  const dest = typeof n.dest === 'string' ? await doc.getDestination?.(n.dest) : n.dest;
                  if (Array.isArray(dest) && dest[0]) {
                    const idx = await doc.getPageIndex?.(dest[0]);
                    if (typeof idx === 'number' && n.title) {
                      sections!.push({ page: idx + 1, title: n.title.trim() });
                    }
                  }
                } catch {
                  // a malformed destination shouldn't lose the rest of the outline
                }
                if (Array.isArray(n.items) && n.items.length) {
                  await walk(n.items as { title?: string; dest?: unknown; items?: unknown[] }[]);
                }
              }
            };
            if (Array.isArray(outline)) await walk(outline);
          } catch {
            // no outline — the running-header pass below applies
          }

          if (sections.length === 0) {
            let last = '';
            for (let i = 1; i <= doc.numPages; i++) {
              const pg2 = await doc.getPage(i);
              const box = pg2.getViewport({ scale: 1 });
              const runs = (await pg2.getTextContent()).items.filter((r) => (r.str ?? '').trim());
              // Top fifth of the page. Wider than a header strictly needs, because
              // some of these print the section under a logo band.
              const band = runs.filter((r) => {
                const y = box.height - (r.transform?.[5] ?? 0);
                return y >= 0 && y <= box.height * 0.2;
              });
              if (!band.length) continue;

              const biggest = Math.max(...band.map((r) => r.height ?? 0));
              if (biggest <= 0) continue;
              // Everything within 10% of the largest size is candidate header text.
              const big = band.filter((r) => (r.height ?? 0) >= biggest * 0.9);

              // Then keep only the TOPMOST LINE of those. Taking all of them ran two
              // headers together — "Section 1: Introduction/Overview Section 2:
              // Program Eligibility…" — because a page can carry both the section it
              // ends and the one it starts at the same size. A header is one line.
              const topY = Math.min(...big.map((r) => box.height - (r.transform?.[5] ?? 0)));
              const title = big
                .filter((r) => Math.abs(box.height - (r.transform?.[5] ?? 0) - topY) <= biggest * 0.6)
                .sort((a, b) => (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0))
                .map((r) => (r.str ?? '').trim())
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 70);

              // A header repeats across its section, so only the first page counts.
              // Comparing against the previous page rather than a set lets a section
              // legitimately recur later in a long document.
              if (title.length >= 4 && title !== last) {
                sections.push({ page: i, title });
                last = title;
              }
            }
          }
          sections.sort((a, b) => a.page - b.page);
        }

        // Geometry for THE RENDERED PAGE, so a match can be boxed on the image.
        // Offsets index the same string buildPage produced above.
        const built = buildPage((await pg.getTextContent()).items);
        const items: { s: number; n: number; x: number; y: number; w: number; h: number }[] = [];
        const r3 = (v: number) => Math.round(v * 1000) / 1000;
        for (const { s: off, n, run } of built.spans) {
          const t = run.transform ?? [1, 0, 0, 1, 0, 0];
          // transform[4],[5] are the run's origin in PDF space (y counts up from the
          // bottom); the viewport is y-down, hence the flip.
          const hPx = (run.height ?? 0) * scale || 10;
          items.push({
            s: off,
            n,
            x: r3((t[4] * scale) / vp.width),
            y: r3((vp.height - t[5] * scale - hPx) / vp.height),
            w: r3(((run.width ?? 0) * scale) / vp.width),
            h: r3(hPx / vp.height),
          });
        }

        return { png: canvas.toDataURL('image/png'), pageCount: doc.numPages, pageText, items, sections };
      },
      b64,
      longEdge,
      workerSrc,
      pageNumber,
      withText,
    )) as
      | {
          png: string;
          pageCount: number;
          pageText?: string[];
          items?: { s: number; n: number; x: number; y: number; w: number; h: number }[];
          sections?: { page: number; title: string }[];
        }
      | null;

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
      pageText: result.pageText,
      items: result.items,
      sections: result.sections,
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
