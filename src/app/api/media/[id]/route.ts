import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { s3PublicUrl, deleteFromS3 } from '@/lib/s3';

// ── Access helpers ──

/** Check access to an asset based on its accountKey. null = admin-level. */
function checkAccess(
  session: { user: { role: string; accountKeys?: string[] } },
  accountKey: string | null,
): boolean {
  const { role, accountKeys = [] } = session.user;
  if (role === 'developer' || role === 'super_admin') return true;
  if (role === 'admin' && accountKeys.length === 0) return true;
  // Admin-level assets: only accessible by devs/unrestricted admins (above)
  if (accountKey === null) return false;
  return accountKeys.includes(accountKey);
}

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
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const data: { filename?: string; altText?: string | null; folderId?: string | null; archivedAt?: Date | null } = {};

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

  if (!checkAccess(session!, asset.accountKey)) {
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

  return NextResponse.json({
    file: {
      id: updated.id,
      name: updated.filename,
      url: s3PublicUrl(updated.s3Key),
      type: updated.mimeType,
      size: updated.size,
      width: updated.width,
      height: updated.height,
      thumbnailUrl: updated.thumbnailKey ? s3PublicUrl(updated.thumbnailKey) : undefined,
      altText: updated.altText,
      category: updated.category,
      folderId: updated.folderId,
      archivedAt: updated.archivedAt ? updated.archivedAt.toISOString() : null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      source: 's3' as const,
    },
  });
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

  if (!checkAccess(session!, asset.accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  // Delete from S3 (original + thumbnail)
  await deleteFromS3(asset.s3Key);
  if (asset.thumbnailKey) {
    await deleteFromS3(asset.thumbnailKey);
  }

  // Delete from DB
  await prisma.mediaAsset.delete({ where: { id } });

  return NextResponse.json({ deleted: true });
}
