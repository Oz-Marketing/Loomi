/**
 * Ad Generator video render — /api/ad-generator/render-motion
 *
 * GET  → `{ available }`: whether this server has ffmpeg, so the UI can offer
 *        (or explain the absence of) an MP4 export instead of failing one.
 * POST → body `{ templateId?, doc?, sizeIds?, accountKey?, data, name?,
 *        durationSec?, fps? }`. Renders every requested size that MOVES to an
 *        MP4 and returns it — one size as the .mp4 itself, several as a ZIP of
 *        MP4s plus their poster frames.
 *
 * The design is rasterised by the same renderer as the PNG export and composited
 * over the real clip (see lib/ad-generator/render-motion.ts), so the video is the
 * still export with the background moving.
 */
import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { getAuthSession } from '@/lib/api-auth';
import { hasUnrestrictedAccountAccess } from '@/lib/roles';
import { resolveTemplateDoc } from '@/lib/ad-generator/resolve-template';
import { motionExportAvailable, renderMotionSizes } from '@/lib/ad-generator/render-motion';
import { FfmpegUnavailableError } from '@/lib/render/ffmpeg';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Video is minutes, not seconds: several sizes, each decoding a clip and encoding
// h264. The renderer caps itself per-ffmpeg-call; this is the outer bound.
export const maxDuration = 600;

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'ad'
  );
}

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ available: await motionExportAvailable() });
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    templateId?: string;
    doc?: TemplateDoc;
    sizeIds?: string[];
    accountKey?: string;
    data?: Record<string, string>;
    name?: string;
    durationSec?: number;
    fps?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Prefer the ad's own snapshot doc (each ad is an independent copy), else the
  // saved template. Video needs the DOC, not the render function: the compositor
  // has to know which layers are clips and how they're stacked.
  const snapshot = body.doc;
  const doc =
    snapshot && Array.isArray(snapshot.sizes) && Array.isArray(snapshot.elements) && snapshot.layouts
      ? snapshot
      : await resolveTemplateDoc(body.templateId ?? '');
  if (!doc) return NextResponse.json({ error: 'Unknown template' }, { status: 400 });

  const unrestricted = hasUnrestrictedAccountAccess(session.user.role, session.user.accountKeys ?? []);

  try {
    const rendered = await renderMotionSizes({
      doc,
      data: body.data ?? {},
      accountKey: body.accountKey,
      sizeIds: body.sizeIds,
      unrestrictedFonts: unrestricted,
      settings: {
        ...(typeof body.durationSec === 'number' ? { durationSec: body.durationSec } : {}),
        ...(typeof body.fps === 'number' ? { fps: body.fps } : {}),
      },
    });

    const base = slug(body.name || doc.name || doc.id);
    // Warnings ride in a header: the response body is the file itself, and a
    // fidelity note is not worth failing an export over.
    const warnings = [...new Set(rendered.flatMap((r) => r.warnings))];
    const warnHeader: Record<string, string> = warnings.length
      ? { 'X-Loomi-Motion-Warnings': JSON.stringify(warnings) }
      : {};

    if (rendered.length === 1) {
      const r = rendered[0];
      return new NextResponse(new Uint8Array(r.mp4), {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${base}-${slug(r.label || r.sizeId)}-${r.width}x${r.height}.mp4"`,
          'Cache-Control': 'no-store',
          ...warnHeader,
        },
      });
    }

    // Several sizes: one archive, with each poster beside its clip so whoever
    // uploads by hand has the thumbnail Meta will ask for.
    const zip = new JSZip();
    for (const r of rendered) {
      const stem = `${base}-${slug(r.label || r.sizeId)}-${r.width}x${r.height}`;
      zip.file(`${stem}.mp4`, r.mp4);
      zip.file(`${stem}-poster.png`, r.poster);
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${base}-video-all-sizes.zip"`,
        'Cache-Control': 'no-store',
        ...warnHeader,
      },
    });
  } catch (err) {
    if (err instanceof FfmpegUnavailableError) {
      // 501, not 500: the request was fine, the server can't do it — and the
      // message is the operator's fix, so it's worth surfacing verbatim.
      return NextResponse.json({ error: err.message }, { status: 501 });
    }
    // eslint-disable-next-line no-console
    console.error('[ad-generator/render-motion] failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Video render failed' },
      { status: 500 },
    );
  }
}
