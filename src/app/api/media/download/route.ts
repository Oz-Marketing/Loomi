import { Readable } from 'stream';
import JSZip from 'jszip';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { getS3ObjectStream, headS3Object } from '@/lib/s3';
import { formatBytes } from '@/lib/media-limits';
import { archiveFilename, planZipEntries, type PlannedEntry } from '@/lib/media-zip';

/**
 * POST /api/media/download
 *
 * Zip a set of assets for download — the "grab the whole Audi campaign pack"
 * action the OEM-portal experience is really asking for, and the one thing a
 * shared library makes worse without it: finding twelve relevant assets is only
 * useful if you can take all twelve.
 *
 * Body: { ids: string[], includeRenditions?: boolean }
 *
 * ── The archive is streamed ──
 *
 * Objects are pulled from S3 one at a time as the zip writer reaches them and the
 * bytes pass straight through to the client, so memory is flat no matter how
 * large the selection. This replaced a version that buffered everything and
 * therefore had to cap downloads at 300 MB — a limit that came from the app
 * server's heap, not from anything about the files. Since a single direct upload
 * can now be 5 GB, that cap had become small enough to refuse one asset.
 *
 * ── What streaming costs, and how it's paid ──
 *
 * Once the first byte is sent the status is committed to 200: a later failure
 * can't be turned into a JSON error, it can only truncate the archive. So every
 * check that can fail happens BEFORE the response starts — including a HEAD of
 * every object, which is what preserves the rule that one unreachable file must
 * not cost you the other 199. A genuine mid-stream failure yields a zip with no
 * central directory, which unzip reports as corrupt rather than silently
 * extracting a short archive.
 */

const MAX_ITEMS = 200;

/**
 * The ceiling is now the BROWSER's memory, not the server's.
 *
 * The client fetches this endpoint and calls `res.blob()`, which holds the whole
 * archive in the tab before writing it to disk — so streaming the server side
 * moved the bottleneck rather than removing it. 2 GB is comfortably inside what
 * a browser tab survives, and roughly 7x the old 300 MB limit.
 *
 * Raising it further means giving up `fetch`: a native download (a form POST, or
 * a short-lived ticket fetched over GET) streams straight to disk with no blob at
 * all. That's the next move if anyone actually assembles a 2 GB selection.
 *
 * This cap applies to ZIPPING ONLY. A single asset — including a 5 GB direct
 * upload — downloads through a plain anchor pointed at its object URL, which
 * streams to disk with no server and no blob involved. So an asset too big to
 * include in a bulk zip is still individually downloadable.
 */
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

/** How many HEAD probes to run at once when verifying the selection exists. */
const HEAD_CONCURRENCY = 16;

/**
 * Open the object only when the zip writer actually asks for it.
 *
 * `Readable.from` over an async generator does not run the body until the first
 * read, and JSZip pulls its inputs strictly in order — so this holds exactly one
 * S3 connection open at a time rather than opening 200 up front.
 */
function lazyS3Stream(key: string): Readable {
  return Readable.from(
    (async function* () {
      const source = await getS3ObjectStream(key);
      for await (const chunk of source) yield chunk as Uint8Array;
    })(),
  );
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((v: unknown): v is string => typeof v === 'string')
    : [];
  const includeRenditions = body?.includeRenditions === true;

  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 });
  }
  if (ids.length > MAX_ITEMS) {
    return NextResponse.json(
      { error: `Too many files in one download (max ${MAX_ITEMS})` },
      { status: 400 },
    );
  }

  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: ids } },
    include: includeRenditions ? { renditions: true } : undefined,
  });

  // Filter to what this session may actually READ. Wider than write access:
  // inherited OEM and global assets are downloadable by every account that can
  // see them, which is the entire point of sharing them.
  const { role, accountKeys = [] } = session!.user;
  const unrestricted =
    role === 'developer' || role === 'super_admin' || (role === 'admin' && accountKeys.length === 0);
  const readable = assets.filter(
    (a) => unrestricted || a.accountKey === null || accountKeys.includes(a.accountKey),
  );

  if (readable.length === 0) {
    return NextResponse.json({ error: 'No downloadable files in selection' }, { status: 403 });
  }

  const projected = readable.reduce(
    (n, a) =>
      n + a.size + ('renditions' in a ? (a.renditions as { size: number }[]).reduce((m, r) => m + r.size, 0) : 0),
    0,
  );
  if (projected > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      {
        error: `Selection is ${formatBytes(projected)} — downloads are capped at ${formatBytes(
          MAX_TOTAL_BYTES,
        )}. Select fewer files.`,
      },
      { status: 413 },
    );
  }

  const planned = planZipEntries(
    readable.map((a) => ({
      filename: a.filename,
      s3Key: a.s3Key,
      mimeType: a.mimeType,
      renditions: 'renditions' in a ? (a.renditions as { name: string; s3Key: string }[]) : undefined,
    })),
    includeRenditions,
  );

  // Verify every object exists BEFORE committing to a 200. This is the streaming
  // equivalent of the old per-file try/catch: a missing object gets dropped from
  // the plan here, where we can still report it, instead of corrupting an archive
  // that is already half-sent.
  const present: PlannedEntry[] = [];
  let skipped = 0;
  for (let i = 0; i < planned.length; i += HEAD_CONCURRENCY) {
    const batch = planned.slice(i, i + HEAD_CONCURRENCY);
    const heads = await Promise.all(batch.map((e) => headS3Object(e.s3Key)));
    heads.forEach((head, n) => {
      if (head) present.push(batch[n]);
      else skipped += 1;
    });
  }

  if (present.length === 0) {
    return NextResponse.json({ error: 'None of the selected files could be read' }, { status: 502 });
  }

  const zip = new JSZip();
  for (const entry of present) {
    zip.file(entry.name, lazyS3Stream(entry.s3Key), { compression: entry.compression });
  }

  // streamFiles: true writes each entry's size in a trailing data descriptor,
  // which is what lets the writer emit bytes before it knows how big the entry
  // turned out to be. Without it JSZip would have to buffer each file whole.
  const archive = zip.generateNodeStream({ streamFiles: true, compression: 'DEFLATE' });

  return new NextResponse(Readable.toWeb(archive) as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${archiveFilename(new Date())}"`,
      // No Content-Length: the compressed size isn't known until the last byte is
      // written. The browser shows an indeterminate progress bar, which is the
      // price of not holding gigabytes in memory to count them.
      ...(skipped > 0 ? { 'X-Skipped-Files': String(skipped) } : {}),
    },
  });
}
