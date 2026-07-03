import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { s3PublicUrl, buildS3Key, buildThumbnailKey, uploadToS3 } from '@/lib/s3';
import { generateThumbnail } from '@/lib/media-thumbnails';

// ── Access helpers ──

/** Check if the session can access admin-level (Loomi) media. */
function canAccessAdminMedia(
  session: { user: { role: string; accountKeys?: string[] } },
): boolean {
  const { role, accountKeys = [] } = session.user;
  if (role === 'developer' || role === 'super_admin') return true;
  // Unrestricted admin (no assigned accounts) = full access
  if (role === 'admin' && accountKeys.length === 0) return true;
  return false;
}

/** Check if the session can access a specific sub-account's assets. */
function canAccessAccount(
  session: { user: { role: string; accountKeys?: string[] } },
  accountKey: string,
): boolean {
  const { role, accountKeys = [] } = session.user;
  if (role === 'developer' || role === 'super_admin') return true;
  if (role === 'admin' && accountKeys.length === 0) return true;
  return accountKeys.includes(accountKey);
}

function describeMediaUploadError(err: unknown): { status: number; error: string } {
  const message = err instanceof Error ? err.message : 'Failed to upload media';

  if (
    message.includes('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required')
    || message.includes('S3_BUCKET is required')
  ) {
    return {
      status: 503,
      error: 'Loomi storage is not configured on the server. Missing S3 credentials or bucket.',
    };
  }

  return { status: 500, error: 'Failed to upload media' };
}

/**
 * GET /api/media
 *
 * Without accountKey → returns admin-level (Loomi) media.
 * With accountKey → returns that account's S3 media (future use).
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const accountKey = req.nextUrl.searchParams.get('accountKey') || null;
  const offset = Number(req.nextUrl.searchParams.get('cursor') || '0');
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || '50'), 100);
  const category = req.nextUrl.searchParams.get('category') || undefined;
  const search = req.nextUrl.searchParams.get('search') || undefined;
  const countOnly = req.nextUrl.searchParams.get('countOnly') === 'true';
  // Folder scoping: absent = every asset (flat, back-compat for non-folder
  // consumers). "root" = only the scope's root (folderId null). Any other value
  // = that folder's direct assets.
  const folderParam = req.nextUrl.searchParams.get('folder');

  // Access check
  if (accountKey === null) {
    if (!canAccessAdminMedia(session!)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
  } else {
    if (!canAccessAccount(session!, accountKey)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
  }

  // Prisma where: null accountKey = admin, otherwise = account-scoped
  // Prisma requires { equals: null } for nullable field null checks
  const where = {
    accountKey: accountKey === null ? { equals: null as string | null } : accountKey,
    ...(category ? { category } : {}),
    ...(search ? { filename: { contains: search } } : {}),
    ...(folderParam === null ? {} : { folderId: folderParam === 'root' ? { equals: null as string | null } : folderParam }),
  };

  if (countOnly) {
    const total = await prisma.mediaAsset.count({ where });
    return NextResponse.json({ total, source: 's3' });
  }

  const [assets, total] = await Promise.all([
    prisma.mediaAsset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.mediaAsset.count({ where }),
  ]);

  const files = assets.map((a) => ({
    id: a.id,
    name: a.filename,
    url: s3PublicUrl(a.s3Key),
    type: a.mimeType,
    size: a.size,
    width: a.width,
    height: a.height,
    thumbnailUrl: a.thumbnailKey ? s3PublicUrl(a.thumbnailKey) : undefined,
    altText: a.altText,
    category: a.category,
    folderId: a.folderId,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    source: 's3' as const,
  }));

  const nextOffset = offset + files.length;

  return NextResponse.json({
    files,
    total,
    nextCursor: nextOffset < total ? String(nextOffset) : undefined,
    source: 's3',
  });
}

/**
 * POST /api/media
 *
 * Upload a file to S3. Expects multipart/form-data with:
 *   - file (file)
 *   - category (optional text: "brand" | "ad-creative" | "oem" | "general")
 *   - accountKey (optional — omit for admin-level upload)
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const accountKey = (formData.get('accountKey') as string | null) || null;
  const file = formData.get('file') as File | null;
  const category = (formData.get('category') as string | null) || 'general';
  const folderIdRaw = (formData.get('folderId') as string | null) || null;
  const folderId = folderIdRaw && folderIdRaw !== 'root' ? folderIdRaw : null;
  // Optional accessible alt text — caller (e.g. media library uploader)
  // can set it now, or it can be added later via PATCH.
  const altTextRaw = formData.get('altText');
  const altText =
    typeof altTextRaw === 'string' && altTextRaw.trim().length > 0
      ? altTextRaw.trim()
      : null;

  if (!file) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  const MAX_UPLOAD_SIZE = 25 * 1024 * 1024; // 25 MB
  if (file.size > MAX_UPLOAD_SIZE) {
    return NextResponse.json(
      { error: `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 25 MB limit` },
      { status: 413 },
    );
  }

  // Access check
  if (accountKey === null) {
    if (!canAccessAdminMedia(session!)) {
      return NextResponse.json({ error: 'Only admins can upload to Loomi media library' }, { status: 403 });
    }
  } else {
    if (!canAccessAccount(session!, accountKey)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
  }

  // A folder, if given, must exist in the SAME scope as the upload — else drop it
  // to root rather than leaking an asset into another account's folder.
  let validFolderId: string | null = null;
  if (folderId) {
    const folder = await prisma.mediaFolder.findUnique({ where: { id: folderId }, select: { accountKey: true } });
    if (folder && (folder.accountKey ?? null) === accountKey) validFolderId = folderId;
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || 'application/octet-stream';
  const assetId = randomUUID().replace(/-/g, '');

  const s3Key = buildS3Key(accountKey, assetId, file.name);

  try {
    // Upload original to S3
    await uploadToS3(s3Key, buffer, mimeType);

    // Generate thumbnail for images
    let thumbnailKey: string | null = null;
    let width: number | null = null;
    let height: number | null = null;

    const thumbResult = await generateThumbnail(buffer, mimeType);
    if (thumbResult) {
      thumbnailKey = buildThumbnailKey(accountKey, assetId);
      await uploadToS3(thumbnailKey, thumbResult.buffer, 'image/webp');
      width = thumbResult.originalWidth;
      height = thumbResult.originalHeight;
    }

    // Save metadata to DB
    const asset = await prisma.mediaAsset.create({
      data: {
        id: assetId,
        accountKey,
        s3Key,
        filename: file.name,
        mimeType,
        size: buffer.length,
        width,
        height,
        thumbnailKey,
        altText,
        category,
        folderId: validFolderId,
        uploadedBy: session!.user.id,
      },
    });

    return NextResponse.json(
      {
        file: {
          id: asset.id,
          name: asset.filename,
          url: s3PublicUrl(asset.s3Key),
          type: asset.mimeType,
          size: asset.size,
          width: asset.width,
          height: asset.height,
          thumbnailUrl: asset.thumbnailKey ? s3PublicUrl(asset.thumbnailKey) : undefined,
          altText: asset.altText,
          category: asset.category,
          folderId: asset.folderId,
          createdAt: asset.createdAt.toISOString(),
          source: 's3' as const,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[api/media] upload failed:', err);
    const { status, error } = describeMediaUploadError(err);
    return NextResponse.json({ error }, { status });
  }
}
