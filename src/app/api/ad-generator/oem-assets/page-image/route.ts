/**
 * One rendered page of a guideline document — GET /api/ad-generator/oem-assets/page-image
 *
 *   ?docId=<id>&page=<1-based>   → image/webp
 *
 * Powers the in-page document reader, so the co-op team can read a manufacturer's
 * guidelines without leaving Loomi or downloading a 66 MB PDF.
 *
 * WHY SERVER-SIDE RENDERING rather than handing the PDF to the browser. The library
 * runs to 66 MB; shipping that to a client to read page 3 is absurd, and pdf.js in
 * the browser would additionally need S3 CORS configured for every environment.
 * Rendering here reuses the same Chromium + pdf.js path as the cover thumbnails and
 * sends a ~100 KB image.
 *
 * The bytes come from whichever source the document has: the stored media asset, or
 * its public URL. Both converge on "fetch bytes, render page N", which is also why
 * a URL-backed document is readable without ever being uploaded.
 *
 * Admin-only. Cached hard: the response is keyed on the document's content hash, so
 * a page can never go stale without the hash moving.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireRole } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { renderGuidelinePages, type RenderedPage } from '@/lib/ad-generator/guideline-preview';
import { downloadFromS3, isS3Configured, s3KeyFromPublicUrl } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Rendered pages, keyed `${contentHash}:${page}`.
 *
 * In-process and bounded. A browser launch dominates the cost of a render (~1s
 * against ~150ms per page after), so caching turns page-flipping from "a second per
 * page" into "instant" for anything already seen. Bounded because these are ~100 KB
 * each and an unbounded map on a long-lived worker is a leak.
 *
 * Deliberately not Redis or S3: the population is a handful of admins reading a
 * document occasionally, and the cost of a miss is one render, not a broken page.
 */
const CACHE_LIMIT = 120;
const cache = new Map<string, RenderedPage>();

function cacheGet(key: string): RenderedPage | undefined {
  const hit = cache.get(key);
  // Re-insert so the map's insertion order doubles as LRU order.
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, value: RenderedPage): void {
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * The most recently read document's bytes.
 *
 * Every cache miss used to re-download the whole PDF to render one page — and
 * the library runs to 66 MB, so reading ten pages of the Yamaha manual pulled
 * 660 MB out of S3. A reader works through one document at a time, so holding
 * just the last one turns page two onwards into a local render.
 *
 * ONE document, not an LRU: these are tens of megabytes each and the win is
 * almost entirely "the page I'm about to ask for is in the doc I'm reading".
 */
const bytesCache: { hash: string | null; bytes: Uint8Array | null } = { hash: null, bytes: null };

/**
 * Renders in flight, keyed `${hash}:${page}`.
 *
 * Two requests can want the same page at once — the reader's own request and a
 * neighbour warm, or simply a double click. Without this each one launched its
 * own Chromium and rendered the same page, doubling the cost of every page turn
 * and competing for memory on the droplet. Now the second request awaits the
 * first one's promise.
 */
const inflight = new Map<string, Promise<Map<number, RenderedPage>>>();

/** The document's bytes, from the media asset or its public URL. */
async function fetchDocBytes(doc: {
  sourceAssetId: string | null;
  sourceUrl: string | null;
}): Promise<{ bytes: Uint8Array } | { error: string; status: number }> {
  if (doc.sourceAssetId && isS3Configured()) {
    try {
      const asset = await prisma.mediaAsset.findUnique({
        where: { id: doc.sourceAssetId },
        select: { s3Key: true },
      });
      if (asset?.s3Key) return { bytes: new Uint8Array(await downloadFromS3(asset.s3Key)) };
    } catch (err) {
      console.warn('[oem-assets/page-image] S3 fetch failed, trying the URL:', err);
    }
  }

  if (doc.sourceUrl) {
    // A stored asset's public URL still resolves through S3 when we have keys, which
    // covers the case where the MediaAsset row is gone but the URL survives.
    const key = s3KeyFromPublicUrl(doc.sourceUrl);
    if (key && isS3Configured()) {
      try {
        return { bytes: new Uint8Array(await downloadFromS3(key)) };
      } catch {
        // fall through to a plain fetch
      }
    }
    try {
      const res = await fetch(doc.sourceUrl, { redirect: 'follow' });
      if (!res.ok) return { error: `The document host returned HTTP ${res.status}.`, status: 502 };
      return { bytes: new Uint8Array(await res.arrayBuffer()) };
    } catch {
      return { error: 'Could not fetch the document from its URL.', status: 502 };
    }
  }

  return {
    // The honest message: registration only ever needed the hash, so a document can
    // legitimately exist here with no readable copy behind it.
    error: 'No copy of this document is stored. Upload the file to read it here.',
    status: 409,
  };
}

export async function GET(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const docId = req.nextUrl.searchParams.get('docId') ?? '';
  const pageParam = Number(req.nextUrl.searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageParam) ? Math.max(1, Math.round(pageParam)) : 1;
  if (!docId) return NextResponse.json({ error: 'docId is required' }, { status: 400 });

  let doc: { contentHash: string | null; sourceAssetId: string | null; sourceUrl: string | null; pageCount: number | null } | null = null;
  try {
    doc = await prisma.adGuidelineDoc.findUnique({
      where: { id: docId },
      select: { contentHash: true, sourceAssetId: true, sourceUrl: true, pageCount: true },
    });
  } catch (err) {
    console.error('[oem-assets/page-image] lookup failed:', err);
    return NextResponse.json({ error: 'Could not load the document' }, { status: 500 });
  }
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

  // `?boxes=1` asks for the page's text geometry instead of its image. Same cache
  // entry, so highlighting a match never costs an extra render.
  const wantBoxes = req.nextUrl.searchParams.get('boxes') === '1';
  const key = `${doc.contentHash ?? docId}:${page}`;
  const cached = cacheGet(key);
  if (cached) return wantBoxes ? boxesResponse(cached) : imageResponse(cached, key);

  const hash = doc.contentHash ?? docId;

  // Join a render already in flight for this page rather than starting a second.
  const pending = inflight.get(key);
  if (pending) {
    const shared = await pending;
    const hit = shared.get(page) ?? cacheGet(key);
    if (hit) return wantBoxes ? boxesResponse(hit) : imageResponse(hit, key);
  }

  let bytes: Uint8Array;
  if (bytesCache.hash === hash && bytesCache.bytes) {
    bytes = bytesCache.bytes;
  } else {
    const got = await fetchDocBytes(doc);
    if ('error' in got) return NextResponse.json({ error: got.error }, { status: got.status });
    bytes = got.bytes;
    bytesCache.hash = hash;
    bytesCache.bytes = bytes;
  }

  // Render the requested page plus its neighbours. The browser is kept warm and a
  // page costs ~150ms, so widening the window makes both "next" and "back" instant
  // for the price of one page's render — and the reader turns pages far more often
  // than it opens documents. `page` is first so a failure part-way still serves it.
  const last = doc.pageCount ?? 0;
  const wanted = [page, page + 1, page - 1, page + 2].filter(
    (n) => n >= 1 && (last === 0 || n <= last) && !cache.has(`${hash}:${n}`),
  );

  const job = renderGuidelinePages(bytes, wanted);
  // Register BEFORE awaiting, so a concurrent request for any page in this batch
  // finds the promise instead of launching its own render.
  for (const n of wanted) inflight.set(`${hash}:${n}`, job);
  let rendered: Map<number, RenderedPage>;
  try {
    rendered = await job;
  } finally {
    for (const n of wanted) inflight.delete(`${hash}:${n}`);
  }
  for (const [n, r] of rendered) cacheSet(`${hash}:${n}`, r);

  const out = rendered.get(page) ?? cacheGet(key);
  if (!out) {
    return NextResponse.json(
      { error: 'Could not render this page. The document may be encrypted or not a PDF.' },
      { status: 422 },
    );
  }
  return wantBoxes ? boxesResponse(out) : imageResponse(out, key);
}

/** Text-run geometry for one page, in normalized 0..1 coordinates. */
function boxesResponse(page: RenderedPage): NextResponse {
  return NextResponse.json(
    { items: page.items ?? [], pageCount: page.pageCount },
    { headers: { 'Cache-Control': 'private, max-age=86400' } },
  );
}

function imageResponse(page: RenderedPage, etag: string): NextResponse {
  return new NextResponse(new Uint8Array(page.buffer), {
    headers: {
      'Content-Type': 'image/webp',
      // Immutable: the key contains the document's content hash, so this bytes-exact
      // page can never change identity without the URL changing too.
      'Cache-Control': 'private, max-age=86400, immutable',
      ETag: `"${etag}"`,
      'X-Page-Count': String(page.pageCount),
      'X-Page-Width': String(page.width),
      'X-Page-Height': String(page.height),
    },
  });
}
