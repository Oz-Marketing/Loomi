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
} from '@/lib/s3';
import { generateThumbnail } from '@/lib/media-thumbnails';

/** Check access to an asset based on its accountKey. null = admin-level. */
function checkAccess(
  session: { user: { role: string; accountKeys?: string[] } },
  accountKey: string | null,
): boolean {
  const { role, accountKeys = [] } = session.user;
  if (role === 'developer' || role === 'super_admin') return true;
  if (role === 'admin' && accountKeys.length === 0) return true;
  if (accountKey === null) return false;
  return accountKeys.includes(accountKey);
}

function croppedName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return `${filename}-cropped`;
  return `${filename.slice(0, dot)}-cropped${filename.slice(dot)}`;
}

/**
 * POST /api/media/[id]/crop
 *
 * Crop an image server-side (sharp) and save the result as a NEW, independent
 * asset in the same scope/folder. Done on the server so it never depends on the
 * browser being able to fetch the cross-origin S3 image into a canvas (Spaces
 * doesn't send CORS headers → the old client-side crop failed with
 * "Failed to fetch" / tainted-canvas). Body: { x, y, width, height } in the
 * source image's natural pixels.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const x = Math.round(Number(body.x));
  const y = Math.round(Number(body.y));
  const width = Math.round(Number(body.width));
  const height = Math.round(Number(body.height));
  if (![x, y, width, height].every((n) => Number.isFinite(n)) || width < 1 || height < 1 || x < 0 || y < 0) {
    return NextResponse.json({ error: 'Invalid crop rectangle' }, { status: 400 });
  }

  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  if (!checkAccess(session!, asset.accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  try {
    const source = await downloadFromS3(asset.s3Key);
    // Clamp the crop to the actual image bounds so an out-of-range rect can't fail.
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
    const name = croppedName(asset.filename);
    const newKey = buildS3Key(asset.accountKey, newId, asset.filename);
    await uploadToS3(newKey, cropped, asset.mimeType);

    let thumbnailKey: string | null = null;
    const thumb = await generateThumbnail(cropped, asset.mimeType);
    if (thumb) {
      thumbnailKey = buildThumbnailKey(asset.accountKey, newId);
      await uploadToS3(thumbnailKey, thumb.buffer, 'image/webp');
    }

    const created = await prisma.mediaAsset.create({
      data: {
        id: newId,
        accountKey: asset.accountKey,
        s3Key: newKey,
        filename: name,
        mimeType: asset.mimeType,
        size: cropped.length,
        width: w,
        height: h,
        thumbnailKey,
        altText: asset.altText,
        category: asset.category,
        folderId: asset.folderId,
        uploadedBy: session!.user.id,
      },
    });

    return NextResponse.json(
      {
        file: {
          id: created.id,
          name: created.filename,
          url: s3PublicUrl(created.s3Key),
          type: created.mimeType,
          size: created.size,
          width: created.width,
          height: created.height,
          thumbnailUrl: created.thumbnailKey ? s3PublicUrl(created.thumbnailKey) : undefined,
          altText: created.altText,
          category: created.category,
          folderId: created.folderId,
          archivedAt: null,
          createdAt: created.createdAt.toISOString(),
          source: 's3' as const,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[api/media/[id]/crop] failed:', err);
    return NextResponse.json({ error: 'Could not crop this image' }, { status: 500 });
  }
}
