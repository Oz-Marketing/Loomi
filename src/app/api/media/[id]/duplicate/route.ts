import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  s3PublicUrl,
  buildS3Key,
  buildThumbnailKey,
  uploadToS3,
  downloadFromS3,
} from '@/lib/s3';

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
  if (!checkAccess(session!, asset.accountKey)) {
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
    console.error('[api/media/[id]/duplicate] failed:', err);
    return NextResponse.json({ error: 'Could not duplicate this file' }, { status: 500 });
  }
}
