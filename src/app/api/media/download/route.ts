import JSZip from 'jszip';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { downloadFromS3 } from '@/lib/s3';

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
 * ── Why there's a ceiling ──
 *
 * JSZip builds the archive in memory, so the whole selection is resident at
 * once. The cap below is what the app server can survive, not what S3 can serve.
 * Lifting it means streaming the archive (or handing back presigned URLs and
 * letting the browser do the work), which is the same piece of infrastructure
 * that large uploads need — see lib/media-limits.ts. Refusing loudly beats an
 * out-of-memory crash that takes the process down for everyone.
 */

const MAX_ITEMS = 200;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;

/** Keep names unique inside the zip — two rooftops' `logo.png` must both survive. */
function uniqueName(used: Set<string>, name: string): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  let candidate = `${stem} (${n})${ext}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${stem} (${n})${ext}`;
  }
  used.add(candidate);
  return candidate;
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
        error: `Selection is ${Math.round(projected / (1024 * 1024))} MB — downloads are capped at ${
          MAX_TOTAL_BYTES / (1024 * 1024)
        } MB. Select fewer files.`,
      },
      { status: 413 },
    );
  }

  const zip = new JSZip();
  const used = new Set<string>();
  let added = 0;
  const skipped: string[] = [];

  for (const asset of readable) {
    try {
      const buffer = await downloadFromS3(asset.s3Key);
      zip.file(uniqueName(used, asset.filename), buffer);
      added += 1;
    } catch {
      // One unreachable object must not lose the other 199 files.
      skipped.push(asset.filename);
      continue;
    }

    if (!includeRenditions || !('renditions' in asset)) continue;
    const renditions = asset.renditions as { name: string; s3Key: string }[];
    if (renditions.length === 0) continue;

    // Renditions go in a folder named after the master, so a flat unzip doesn't
    // scatter nine variants of the same image across the directory.
    const dot = asset.filename.lastIndexOf('.');
    const stem = dot > 0 ? asset.filename.slice(0, dot) : asset.filename;
    for (const r of renditions) {
      try {
        const buf = await downloadFromS3(r.s3Key);
        zip.file(`${stem} — sizes/${r.name}.jpg`, buf);
      } catch {
        skipped.push(`${asset.filename} → ${r.name}`);
      }
    }
  }

  if (added === 0) {
    return NextResponse.json({ error: 'None of the selected files could be read' }, { status: 502 });
  }

  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(new Uint8Array(archive), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="loomi-media-${stamp}.zip"`,
      'Content-Length': String(archive.length),
      // Surfaced so the client can tell someone which files didn't make it,
      // rather than handing over a quietly short archive.
      ...(skipped.length > 0 ? { 'X-Skipped-Files': String(skipped.length) } : {}),
    },
  });
}
