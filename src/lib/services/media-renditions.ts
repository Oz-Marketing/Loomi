import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { deleteFromS3, downloadFromS3, s3PublicUrl, uploadToS3 } from '@/lib/s3';
import { isImageMime } from '@/lib/media-thumbnails';
import { findSizeByName } from '@/lib/ad-generator/size-library-store';
import type { LibrarySize } from '@/lib/ad-generator/ad-size-library';

/**
 * Rendition generation — Phase 4 of docs/asset-management.md (§8).
 *
 * "Upload a master once, get every platform size" is the COPE principle in its
 * most literal form, and the manual version of it — a designer re-cropping the
 * same photo into eight frames — is the specific chore the design note says the
 * Creative module exists to remove.
 *
 * Sizes come from the ad size library (`AdSizePreset`), not a new list. The
 * builder already designs against that library, so a rendition and the ad it
 * will sit in are the same dimensions by construction rather than by
 * coincidence — including for sizes a team added themselves.
 *
 * Server-only: pulls bytes from S3 and runs sharp.
 */

/** Where a rendition lives. Kept beside the master, under a `renditions/` prefix. */
function buildRenditionKey(
  accountKey: string | null,
  assetId: string,
  renditionId: string,
  ext: string,
): string {
  const prefix = accountKey ?? '_admin';
  return `media/${prefix}/${assetId}/renditions/${renditionId}.${ext}`;
}

export type RenditionFit = 'cover' | 'contain';

export interface RenditionRequest {
  /** Library size name, e.g. "Instagram Square". */
  name: string;
  fit?: RenditionFit;
}

export interface GeneratedRendition {
  id: string;
  name: string;
  platform: string;
  width: number;
  height: number;
  url: string;
  size: number;
  fit: string;
}

export function findLibrarySize(name: string): Promise<LibrarySize | undefined> {
  return findSizeByName(name);
}

/**
 * Can this asset produce renditions at all?
 *
 * Raster images only. A PDF, a zip of GWD template files or a video needs a
 * different pipeline entirely, and silently producing a broken derivative from
 * one would be worse than refusing — the Audi packages in §11 are exactly the
 * case that would otherwise generate eight unusable JPEGs.
 */
export function canGenerateRenditions(mimeType: string): boolean {
  // SVG is an image but not a raster one; sharp can rasterize it, though the
  // result is rarely what someone wants from a logo, so it stays out.
  return isImageMime(mimeType) && mimeType.toLowerCase() !== 'image/svg+xml';
}

/**
 * Generate (or regenerate) renditions for an asset.
 *
 * Each size is independent: one failure doesn't abandon the rest, because a
 * partial set is more useful than none and the caller is told what failed.
 */
export async function generateRenditions(
  assetId: string,
  requests: RenditionRequest[],
  userId?: string,
): Promise<{ created: GeneratedRendition[]; failed: { name: string; error: string }[] }> {
  const created: GeneratedRendition[] = [];
  const failed: { name: string; error: string }[] = [];

  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error('Asset not found');
  if (!canGenerateRenditions(asset.mimeType)) {
    throw new Error('Renditions can only be generated from raster images');
  }

  // One download, reused for every size — the master is the expensive fetch.
  const master = await downloadFromS3(asset.s3Key);

  for (const req of requests) {
    const size = await findLibrarySize(req.name);
    if (!size) {
      failed.push({ name: req.name, error: 'Unknown size' });
      continue;
    }

    const fit: RenditionFit = req.fit === 'contain' ? 'contain' : 'cover';

    try {
      const pipeline = sharp(master).resize(size.width, size.height, {
        fit,
        // `contain` letterboxes; white rather than transparent because these are
        // delivered as JPEG and transparent would flatten to black.
        ...(fit === 'contain'
          ? { background: { r: 255, g: 255, b: 255, alpha: 1 } }
          : { position: 'centre' }),
        // Upscaling a small master to a billboard produces a soft, unusable
        // image, but refusing outright would block the common case of a master
        // that's merely a little short on one axis. Allowed, and the dimensions
        // on the record make it obvious what happened.
        withoutEnlargement: false,
      });

      const buffer = await pipeline.jpeg({ quality: 88 }).toBuffer();

      // Replace rather than accumulate: regenerating a size must not leave the
      // previous object orphaned in the bucket.
      const existing = await prisma.mediaRendition.findUnique({
        where: { assetId_name: { assetId, name: size.name } },
      });
      if (existing) {
        await deleteFromS3(existing.s3Key).catch(() => {
          // A missing object shouldn't block the replacement.
        });
      }

      const renditionId = existing?.id ?? randomUUID().replace(/-/g, '');
      const key = buildRenditionKey(asset.accountKey, assetId, renditionId, 'jpg');
      await uploadToS3(key, buffer, 'image/jpeg');

      const row = await prisma.mediaRendition.upsert({
        where: { assetId_name: { assetId, name: size.name } },
        create: {
          id: renditionId,
          assetId,
          name: size.name,
          platform: size.tags[0] ?? '',
          width: size.width,
          height: size.height,
          s3Key: key,
          mimeType: 'image/jpeg',
          size: buffer.length,
          fit,
          createdBy: userId ?? null,
        },
        update: {
          s3Key: key,
          size: buffer.length,
          fit,
          width: size.width,
          height: size.height,
          platform: size.tags[0] ?? '',
          createdBy: userId ?? null,
        },
      });

      created.push(serializeRendition(row));
    } catch (err) {
      failed.push({ name: req.name, error: err instanceof Error ? err.message : 'Failed' });
    }
  }

  return { created, failed };
}

export function serializeRendition(r: {
  id: string;
  name: string;
  platform: string;
  width: number;
  height: number;
  s3Key: string;
  size: number;
  fit: string;
}): GeneratedRendition {
  return {
    id: r.id,
    name: r.name,
    platform: r.platform,
    width: r.width,
    height: r.height,
    url: s3PublicUrl(r.s3Key),
    size: r.size,
    fit: r.fit,
  };
}

export async function listRenditions(assetId: string): Promise<GeneratedRendition[]> {
  const rows = await prisma.mediaRendition.findMany({
    where: { assetId },
    orderBy: [{ platform: 'asc' }, { name: 'asc' }],
  });
  return rows.map(serializeRendition);
}

/** Delete one rendition, bucket object included. */
export async function deleteRendition(id: string): Promise<void> {
  const row = await prisma.mediaRendition.findUnique({ where: { id } });
  if (!row) return;
  await deleteFromS3(row.s3Key).catch(() => {
    // Losing the object but keeping the row would leave a broken download link;
    // dropping the row regardless is the safer of the two failure modes.
  });
  await prisma.mediaRendition.delete({ where: { id } });
}
