import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  buildS3Key,
  buildThumbnailKey,
  uploadToS3,
  downloadFromS3,
} from '@/lib/s3';
import { canAccessAsset, serializeMediaAsset } from '@/lib/services/media';

/** Append " copy" before the file extension. */
function copyName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return `${filename} copy`;
  return `${filename.slice(0, dot)} copy${filename.slice(dot)}`;
}

/**
 * POST /api/media/[id]/duplicate
 *
 * Copy an existing media asset into a brand-new one (same scope + folder). The
 * S3 object (and thumbnail) are re-uploaded under fresh keys so the two rows are
 * fully independent — editing/deleting one never affects the other.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  if (!canAccessAsset(session!, asset.accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const newId = randomUUID().replace(/-/g, '');
  const newName = copyName(asset.filename);
  const newKey = buildS3Key(asset.accountKey, newId, asset.filename);

  try {
    // Copy the original object under a new key.
    const original = await downloadFromS3(asset.s3Key);
    await uploadToS3(newKey, original, asset.mimeType);

    // Copy the thumbnail too, if there is one.
    let newThumbKey: string | null = null;
    if (asset.thumbnailKey) {
      try {
        const thumb = await downloadFromS3(asset.thumbnailKey);
        newThumbKey = buildThumbnailKey(asset.accountKey, newId);
        await uploadToS3(newThumbKey, thumb, 'image/webp');
      } catch {
        newThumbKey = null; // A missing thumbnail shouldn't fail the duplicate.
      }
    }

    const created = await prisma.mediaAsset.create({
      data: {
        id: newId,
        accountKey: asset.accountKey,
        s3Key: newKey,
        filename: newName,
        mimeType: asset.mimeType,
        size: asset.size,
        width: asset.width,
        height: asset.height,
        thumbnailKey: newThumbKey,
        altText: asset.altText,
        category: asset.category,
        uploadedBy: session!.user.id,

        // The copy carries the original's classification — a duplicate of an
        // Audi OEM template is still an Audi OEM template, and re-tagging it by
        // hand is exactly the sort of chore that leaves metadata half-applied.
        oem: asset.oem,
        assetSource: asset.assetSource,
        assetCategory: asset.assetCategory,
        modelYear: asset.modelYear,
        vehicleModel: asset.vehicleModel,
        rightsHolder: asset.rightsHolder,
        tags: asset.tags,

        // Same bytes, so the same hash — which is what makes the copy findable
        // as a duplicate rather than pretending to be a distinct asset.
        contentHash: asset.contentHash,
        // Derivative lineage: point at the original's own master if it has one,
        // so a chain of copies stays one level deep and always resolves to the
        // real source rather than to another copy.
        parentAssetId: asset.parentAssetId ?? asset.id,
      },
    });

    return NextResponse.json({ file: serializeMediaAsset(created) }, { status: 201 });
  } catch (err) {
    console.error('[api/media/[id]/duplicate] failed:', err);
    return NextResponse.json({ error: 'Could not duplicate this file' }, { status: 500 });
  }
}
