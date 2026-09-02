/**
 * Ad Generator batch render — POST /api/ad-generator/render-zip
 *
 * Body: { templateId, sizeIds?, accountKey?, data, doc?, name? }. Renders the
 * template at every requested size (default: all of the template's sizes) in
 * one headless-Chromium session and returns a single ZIP — browsers block the
 * multi-download the old per-size loop triggered.
 *
 * ── The archive is streamed ──
 *
 * Sizes are rendered one at a time as the zip writer reaches them and each PNG's
 * bytes pass straight through to the client, so memory is flat no matter how many
 * sizes the ad has. The first version buffered: it held all 22 retina PNGs, then
 * JSZip assembled the whole archive in memory, then the response copied it AGAIN
 * (`new Uint8Array(buf)`) — measured at ~130 MB of growth for 34 MB of PNGs, and
 * far worse for photographic vehicle renders. On production that crossed pm2's
 * `max_memory_restart`, which killed the process mid-request; nginx logged
 * "upstream prematurely closed connection" and the browser got a bare 502 that
 * the route never had the chance to explain.
 *
 * Each size is captured straight to a temp file rather than returned as bytes:
 * `page.screenshot()` costs 60-80 MB of transient CDP buffers for one 17 MB
 * retina PNG and they accumulate faster than V8 collects them, which floated RSS
 * to ~530 MB even when the archive itself was streamed. See `renderToFile`.
 *
 * ── What streaming costs, and how it's paid ──
 *
 * Once the first byte is sent the status is committed to 200: a later failure
 * can't be turned into a JSON error. So the FIRST size is rendered eagerly,
 * before the response starts — that's where the failures that aren't specific to
 * one size live (missing Chromium, empty template HTML, a broken doc), so they
 * still come back as a clean 500. A genuine mid-stream failure yields a zip with
 * no central directory, which unzip reports as corrupt rather than silently
 * extracting a short archive.
 */
import { createReadStream } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { getAuthSession } from '@/lib/api-auth';
import { hasUnrestrictedAccountAccess } from '@/lib/roles';
import { usedFontFamilies } from '@/lib/ad-generator/fonts';
import { resolveTemplate, resolveTemplateDoc } from '@/lib/ad-generator/resolve-template';
import { stillRenderFor } from '@/lib/ad-generator/posterize';
import { adTemplateFromDoc } from '@/lib/ad-generator/doc-template';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import { openAdRenderSession } from '@/lib/ad-generator/render';
import { embedAccountFontCss, googleFontFaceCss } from '@/lib/ad-generator/render-fonts';
import { usedGoogleFontFamilies } from '@/lib/ad-generator/google-fonts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Safe cross-platform filename chunk (also used inside the archive). */
function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'ad'
  );
}

/**
 * Render this size only when the zip writer actually asks for it, then hand over
 * the file in chunks and delete it.
 *
 * `Readable.from` over an async generator does not run the body until the first
 * read, and JSZip pulls its inputs strictly in order — so exactly one render is
 * in flight, one temp file exists at a time, and no whole PNG is ever live in
 * this process. `render` is omitted for the size that was captured eagerly.
 */
function lazyEntry(file: `${string}.png`, render?: () => Promise<void>): Readable {
  return Readable.from(
    (async function* () {
      try {
        if (render) await render();
        for await (const chunk of createReadStream(file)) yield chunk as Buffer;
      } finally {
        await rm(file, { force: true }).catch(() => {});
      }
    })(),
  );
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { templateId?: string; sizeIds?: string[]; accountKey?: string; data?: Record<string, string>; doc?: TemplateDoc; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Prefer the ad's own snapshot doc when supplied (each ad is an independent
  // copy); otherwise resolve the template id live (code templates / older ads).
  const snapshot = body.doc;
  const template =
    snapshot && Array.isArray(snapshot.sizes) && Array.isArray(snapshot.elements) && snapshot.layouts
      ? adTemplateFromDoc(body.templateId || 'snapshot', snapshot)
      : await resolveTemplate(body.templateId ?? '');
  if (!template) return NextResponse.json({ error: 'Unknown template' }, { status: 400 });

  const sizes = body.sizeIds?.length ? template.sizes.filter((s) => body.sizeIds!.includes(s.id)) : template.sizes;
  if (sizes.length === 0) return NextResponse.json({ error: 'Unknown size' }, { status: 400 });

  // Re-build the font @font-face with base64-embedded files (preview sends URL-based).
  // Admins roll up every account's fonts so a picked brand font still embeds — but
  // scope to the families this ad uses so we embed a few KB, not the whole ~MB union.
  const unrestricted = hasUnrestrictedAccountAccess(session.user.role, session.user.accountKeys ?? []);
  const usedFams = usedFontFamilies(Array.isArray(snapshot?.elements) ? snapshot!.elements : [], [
    typeof body.data?.fontFamily === 'string' ? body.data.fontFamily : undefined,
  ]);
  const data = await embedAccountFontCss(body.accountKey, { ...(body.data ?? {}) }, { unrestricted, families: usedFams });
  // Embed any curated Google fonts the design uses (see the single-render route).
  const usedGoogle = usedGoogleFontFamilies(
    Array.isArray(snapshot?.elements) ? snapshot!.elements : [],
    typeof data.fontFamily === 'string' ? data.fontFamily : undefined,
  );
  const googleCss = await googleFontFaceCss(usedGoogle);
  if (googleCss) data.fontFaceCss = `${data.fontFaceCss ?? ''}\n${googleCss}`;
  // Clips become poster frames before Chromium sees them — see the single-render
  // route for why.
  const still = await stillRenderFor({
    template,
    doc: snapshot ?? (await resolveTemplateDoc(body.templateId ?? '')),
    data: { ...template.defaults, ...data },
  });

  const base = slug(body.name || template.id);
  const entryName = (size: (typeof sizes)[number]) =>
    `${base}-${slug(size.label || size.id)}-${size.width}x${size.height}.png`;
  const itemFor = (size: (typeof sizes)[number]) => ({
    html: still.template.render(still.data, size),
    width: size.width,
    height: size.height,
  });

  let renderer: Awaited<ReturnType<typeof openAdRenderSession>> | null = null;
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), 'loomi-ad-zip-'));
    const fileFor = (i: number): `${string}.png` => join(dir!, `${i}.png`) as `${string}.png`;
    renderer = await openAdRenderSession();
    // Eager first render — the last point at which a failure can still be an
    // honest JSON error rather than a truncated download (see the header note).
    await renderer.renderToFile(itemFor(sizes[0]), fileFor(0));

    const zip = new JSZip();
    zip.file(entryName(sizes[0]), lazyEntry(fileFor(0)), { compression: 'STORE' });
    sizes.slice(1).forEach((size, n) => {
      const file = fileFor(n + 1);
      zip.file(entryName(size), lazyEntry(file, () => renderer!.renderToFile(itemFor(size), file)), {
        compression: 'STORE',
      });
    });

    // streamFiles: true writes each entry's size in a trailing data descriptor,
    // which is what lets the writer emit bytes before the entry is complete.
    // Without it JSZip would buffer every file whole — the bug this route had.
    // PNGs are STORE'd: they don't recompress, so DEFLATE would spend real CPU
    // (on a 1-vCPU box) to save approximately nothing.
    const archive = zip.generateNodeStream({ streamFiles: true, compression: 'STORE' });
    // Chromium and the temp dir outlive this handler — both must go when the
    // archive ends, fails, OR the client walks away mid-download, or every
    // abandoned export leaks a browser and a few hundred MB of PNGs.
    const cleanup = () => {
      void renderer!.close();
      void rm(dir!, { recursive: true, force: true }).catch(() => {});
    };
    archive.on('end', cleanup);
    archive.on('error', cleanup);
    archive.on('close', cleanup);

    return new NextResponse(Readable.toWeb(archive) as ReadableStream<Uint8Array>, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${base}-all-sizes.zip"`,
        // No Content-Length: the archive's size isn't known until the last entry
        // is rendered. The browser shows an indeterminate progress bar, which is
        // the price of not holding every size in memory to count the bytes.
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    await renderer?.close();
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    // eslint-disable-next-line no-console
    console.error('[ad-generator/render-zip] failed', err);
    return NextResponse.json({ error: 'Render failed' }, { status: 500 });
  }
}
