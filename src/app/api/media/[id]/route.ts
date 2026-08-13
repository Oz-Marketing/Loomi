import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { deleteFromS3 } from '@/lib/s3';
import {
  buildAssetMetadata,
  serializeMediaAsset,
  type AssetMetadataData,
  canAccessAsset,
} from '@/lib/services/media';

/** The DAM metadata keys PATCH accepts. */
const METADATA_KEYS = [
  'oem',
  'assetSource',
  'assetCategory',
  'modelYear',
  'vehicleModel',
  'rightsHolder',
  'tags',
  // Rights (Phase 3)
  'licenseType',
  'licenseRef',
  'licenseStartsAt',
  'licenseExpiresAt',
  'usageScope',
  'territoryScope',
  'exclusive',
  'talentReleaseOnFile',
  'derivativesPermitted',
  'sublicensingPermitted',
  'expiresAt',
] as const;

// ── Access helpers ──

/** Check access to an asset based on its accountKey. null = admin-level. */

/**
 * PATCH /api/media/[id]
 *
 * Update display metadata for a media asset. The S3 key stays
 * immutable so existing URLs (in published pages, sent emails, etc.)
 * keep working — only the user-facing fields change.
 *
 * Body (all optional, at least one required):
 *   - name: string — display filename
 *   - altText: string | null — accessible alt text; pass null/'' to clear
 *   - folderId: string | null — move to a folder ('root'/null = the scope root)
 *   - oem, assetSource, assetCategory, modelYear, vehicleModel, rightsHolder,
 *     tags — DAM metadata; null/'' clears, absent leaves untouched
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const data: {
    filename?: string;
    altText?: string | null;
    folderId?: string | null;
    archivedAt?: Date | null;
  } & AssetMetadataData = {};

  // DAM metadata — only keys actually present in the body are touched, which is
  // what keeps this a sparse PATCH.
  const metadataInput: Record<string, unknown> = {};
  for (const key of METADATA_KEYS) {
    if (key in body) metadataInput[key] = body[key];
  }
  if (Object.keys(metadataInput).length > 0) {
    const result = buildAssetMetadata(metadataInput);
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    Object.assign(data, result.data);
  }

  if (body.archived !== undefined) {
    if (typeof body.archived !== 'boolean') {
      return NextResponse.json({ error: 'archived must be a boolean' }, { status: 400 });
    }
    data.archivedAt = body.archived ? new Date() : null;
  }

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 });
    }
    data.filename = body.name.trim();
  }

  if (body.altText !== undefined) {
    if (body.altText === null) {
      data.altText = null;
    } else if (typeof body.altText !== 'string') {
      return NextResponse.json({ error: 'altText must be a string or null' }, { status: 400 });
    } else {
      const trimmed = body.altText.trim();
      // Empty string clears the field — distinguishes "I removed the
      // alt text" from "I didn't touch this field" (undefined).
      data.altText = trimmed.length === 0 ? null : trimmed;
    }
  }

  if (Object.keys(data).length === 0 && body.folderId === undefined) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }

  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  if (!canAccessAsset(session!, asset.accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  // Move to a folder — the target must be in the SAME scope as the asset.
  if (body.folderId !== undefined) {
    const target = body.folderId && body.folderId !== 'root' ? String(body.folderId) : null;
    if (target) {
      const folder = await prisma.mediaFolder.findUnique({ where: { id: target }, select: { accountKey: true } });
      if (!folder || (folder.accountKey ?? null) !== (asset.accountKey ?? null)) {
        return NextResponse.json({ error: 'Folder not found in this scope' }, { status: 400 });
      }
    }
    data.folderId = target;
  }

  const updated = await prisma.mediaAsset.update({ where: { id }, data });

  return NextResponse.json({ file: serializeMediaAsset(updated) });
}

/**
 * DELETE /api/media/[id]
 *
 * Delete a media asset from S3 and the database.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;

  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  if (!canAccessAsset(session!, asset.accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  // Delete from S3 (original + thumbnail)
  await deleteFromS3(asset.s3Key);
  if (asset.thumbnailKey) {
    await deleteFromS3(asset.thumbnailKey);
  }

  // Rendition ROWS cascade with the master, but their bucket objects don't —
  // Prisma's onDelete only reaches the database. Collected before the delete,
  // because afterwards there's nothing left to enumerate them from.
  const renditions = await prisma.mediaRendition.findMany({
    where: { assetId: id },
    select: { s3Key: true },
  });
  for (const r of renditions) {
    await deleteFromS3(r.s3Key).catch(() => {
      // Best-effort: a leaked derivative is untidy, a failed delete is worse.
    });
  }

  // Delete from DB
  await prisma.mediaAsset.delete({ where: { id } });

  return NextResponse.json({ deleted: true });
}
