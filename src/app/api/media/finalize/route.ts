import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { buildThumbnailKey, downloadFromS3, headS3Object, uploadToS3 } from '@/lib/s3';
import { checkAnyUploadSize } from '@/lib/media-limits';
import { generateThumbnail, shouldThumbnailOnFinalize } from '@/lib/media-thumbnails';
import { generateVideoThumbnail, isVideoMime } from '@/lib/media-video-thumbnail';
import {
  buildAssetMetadata,
  canAccessAsset,
  isConsumerRole,
  serializeMediaAsset,
} from '@/lib/services/media';

/**
 * POST /api/media/finalize
 *
 * Create the library row for a file the browser uploaded directly to S3.
 *
 * Body: { key, assetId, filename, contentType, accountKey?, oem?, ...metadata }
 *
 * Pairs with /api/media/upload-url. Separate because the app never handles the
 * bytes on this path, so there is nothing to build a row from until the object
 * is actually in the bucket.
 *
 * ── The object is verified, not trusted ──
 *
 * A HEAD confirms it landed and reports its REAL size. Taking the client's word
 * would allow a row pointing at nothing, which is worse than a failed upload:
 * the asset would appear in the library and break on first use.
 *
 * ── What direct upload gives up ──
 *
 * No contentHash. It needs the bytes server-side, and fetching a multi-gigabyte
 * object back just to hash it would reintroduce exactly the memory problem this
 * path exists to avoid. So: no duplicate detection for these, stated on the row
 * by leaving contentHash null rather than filling it with something unverified.
 *
 * A thumbnail IS generated, for images under THUMBNAIL_SOURCE_MAX. That memory
 * argument is sound for a video or a layered PSD and simply does not apply to a
 * logo: measured against production, 809 of the 940 images in the library had no
 * thumbnail, and the LARGEST of them was 5MB. Skipping the whole class to protect
 * against a case none of them are meant the grid rendered a megabyte-plus
 * original into a 140px tile, 809 times over. Above the cap it still skips, and
 * the grid falls back to an icon.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  if (isConsumerRole(session!.user.role)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  const key = typeof body?.key === 'string' ? body.key : '';
  const assetId = typeof body?.assetId === 'string' ? body.assetId : '';
  const filename = typeof body?.filename === 'string' ? body.filename.trim() : '';
  if (!key || !assetId || !filename) {
    return NextResponse.json(
      { error: 'key, assetId and filename are required' },
      { status: 400 },
    );
  }

  const accountKey = typeof body?.accountKey === 'string' && body.accountKey ? body.accountKey : null;
  if (!canAccessAsset(session!, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  // The key encodes its own scope (media/{accountKey|_admin}/{assetId}/…), so a
  // mismatch means the client is finalizing something it didn't mint — either a
  // bug or an attempt to attach an arbitrary object to its own account.
  const expectedPrefix = `media/${accountKey ?? '_admin'}/${assetId}/`;
  if (!key.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: 'key does not match that scope' }, { status: 400 });
  }

  const head = await headS3Object(key);
  if (!head) {
    return NextResponse.json(
      { error: 'That upload has not arrived — the file may still be transferring, or the PUT failed.' },
      { status: 409 },
    );
  }

  // Re-check against the REAL size. The pre-sign step checked a claim; this
  // checks the fact.
  const tooBig = checkAnyUploadSize(head.size);
  if (tooBig) return NextResponse.json({ error: tooBig }, { status: 413 });

  const metadataInput: Record<string, unknown> = {};
  for (const field of [
    'oem', 'assetSource', 'assetCategory', 'modelYear', 'vehicleModel', 'rightsHolder', 'tags',
    'licenseType', 'licenseRef', 'licenseStartsAt', 'licenseExpiresAt',
    'usageScope', 'territoryScope', 'derivativesPermitted', 'sublicensingPermitted', 'expiresAt',
  ]) {
    if (field in body) metadataInput[field] = body[field];
  }
  const metadata = buildAssetMetadata(metadataInput);
  if ('error' in metadata) {
    return NextResponse.json({ error: metadata.error }, { status: 400 });
  }

  // Thumbnail: images small enough that pulling the object back is cheap, plus
  // every video (whose frame is read in place, so its size is irrelevant).
  // Best-effort on purpose: a failure here must not fail an upload whose bytes
  // are already safely in the bucket — the row is still correct without it, and
  // the backfill script can pick it up later.
  let thumbnailKey: string | null = null;
  let thumbDims: { width: number; height: number } | null = null;
  const mimeType = head.contentType || body?.contentType || 'application/octet-stream';
  if (shouldThumbnailOnFinalize(mimeType, head.size) || isVideoMime(mimeType)) {
    try {
      // A video is never pulled back: ffmpeg reads the frame it wants in place,
      // through a presigned URL, so a 200MB clip costs the same as a 2MB one and
      // the size cap that guards the image path doesn't apply.
      const thumb = isVideoMime(mimeType)
        ? await generateVideoThumbnail({ s3Key: key }, mimeType)
        : await generateThumbnail(await downloadFromS3(key), mimeType);
      if (thumb) {
        thumbnailKey = buildThumbnailKey(accountKey, assetId);
        await uploadToS3(thumbnailKey, thumb.buffer, 'image/webp');
        thumbDims = { width: thumb.originalWidth, height: thumb.originalHeight };
      }
    } catch (err) {
      thumbnailKey = null;
      console.warn(`[media/finalize] thumbnail failed for ${key}:`, err);
    }
  }

  // Idempotent: a client that retries finalize after a timeout must not create a
  // second row for one object. The s3Key is unique, so the upsert settles it.
  const asset = await prisma.mediaAsset.upsert({
    where: { s3Key: key },
    create: {
      id: assetId,
      accountKey,
      s3Key: key,
      filename,
      mimeType,
      size: head.size,
      thumbnailKey,
      ...(thumbDims ?? {}),
      category: typeof body?.category === 'string' ? body.category : 'general',
      uploadedBy: session!.user.id,
      altText: typeof body?.altText === 'string' && body.altText.trim() ? body.altText.trim() : null,
      ...metadata.data,
    },
    update: {
      size: head.size,
      // A retry can supply what a previous attempt failed to produce; never
      // clear one that already exists.
      ...(thumbnailKey ? { thumbnailKey, ...(thumbDims ?? {}) } : {}),
    },
  });

  return NextResponse.json({ file: serializeMediaAsset(asset) }, { status: 201 });
}
