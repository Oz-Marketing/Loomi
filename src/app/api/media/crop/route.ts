import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  s3PublicUrl,
  buildS3Key,
  buildThumbnailKey,
  uploadToS3,
  downloadFromS3,
  s3KeyFromPublicUrl,
} from '@/lib/s3';
import { generateThumbnail } from '@/lib/media-thumbnails';

function canAccessAccount(
  session: { user: { role: string; accountKeys?: string[] } },
  accountKey: string | null,
): boolean {
  const { role, accountKeys = [] } = session.user;
  if (role === 'developer' || role === 'super_admin') return true;
  if (role === 'admin' && accountKeys.length === 0) return true;
  if (accountKey === null) return false;
  return accountKeys.includes(accountKey);
}

/** Resolve source image bytes from a public URL — S3 (ours) first, else fetch. */
async function fetchImageBytes(url: string): Promise<Buffer | null> {
  const key = s3KeyFromPublicUrl(url);
  if (key) {
    try {
      return await downloadFromS3(key);
    } catch {
      /* fall through to a direct fetch */
    }
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function mimeFromUrl(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/png';
}

/**
 * POST /api/media/crop
 *
 * Crop an image given by URL (not a media-asset id) and save it as a new asset —
 * used by the ad builder, where an element's image can be any URL (media library,
 * EVOX jellybean, etc.). Server-side (sharp) so it never depends on browser CORS.
 * Body: { url, accountKey?, x, y, width, height } in the source's natural pixels.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const url = typeof body.url === 'string' ? body.url : '';
  const accountKey = typeof body.accountKey === 'string' && body.accountKey.trim() ? body.accountKey.trim() : null;
  const x = Math.round(Number(body.x));
  const y = Math.round(Number(body.y));
  const width = Math.round(Number(body.width));
  const height = Math.round(Number(body.height));
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 });
  if (![x, y, width, height].every((n) => Number.isFinite(n)) || width < 1 || height < 1 || x < 0 || y < 0) {
    return NextResponse.json({ error: 'Invalid crop rectangle' }, { status: 400 });
  }
  if (!canAccessAccount(session!, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  try {
    const source = await fetchImageBytes(url);
    if (!source) return NextResponse.json({ error: 'Could not load the source image' }, { status: 400 });

    const mimeType = mimeFromUrl(url);
    const meta = await sharp(source).metadata();
    const iw = meta.width ?? 0;
    const ih = meta.height ?? 0;
    if (!iw || !ih) return NextResponse.json({ error: 'Unsupported image' }, { status: 400 });
    const left = Math.min(x, iw - 1);
    const top = Math.min(y, ih - 1);
    const w = Math.min(width, iw - left);
    const h = Math.min(height, ih - top);

    const cropped = await sharp(source).extract({ left, top, width: w, height: h }).toBuffer();

    const newId = randomUUID().replace(/-/g, '');
    const filename = `cropped-${newId.slice(0, 8)}.${mimeType.split('/')[1] || 'png'}`;
    const newKey = buildS3Key(accountKey, newId, filename);
    await uploadToS3(newKey, cropped, mimeType);

    let thumbnailKey: string | null = null;
    const thumb = await generateThumbnail(cropped, mimeType);
    if (thumb) {
      thumbnailKey = buildThumbnailKey(accountKey, newId);
      await uploadToS3(thumbnailKey, thumb.buffer, 'image/webp');
    }

    const created = await prisma.mediaAsset.create({
      data: {
        id: newId,
        accountKey,
        s3Key: newKey,
        filename,
        mimeType,
        size: cropped.length,
        width: w,
        height: h,
        thumbnailKey,
        category: 'ad-creative',
        folderId: null,
        uploadedBy: session!.user.id,
      },
    });

    return NextResponse.json({ file: { id: created.id, url: s3PublicUrl(created.s3Key), width: w, height: h } }, { status: 201 });
  } catch (err) {
    console.error('[api/media/crop] failed:', err);
    return NextResponse.json({ error: 'Could not crop this image' }, { status: 500 });
  }
}
