import { createHash, randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { buildS3Key, buildThumbnailKey, uploadToS3 } from '@/lib/s3';
import { generateThumbnail } from '@/lib/media-thumbnails';
import { checkUploadSize } from '@/lib/media-limits';
import {
  buildAssetMetadata,
  findDuplicateAsset,
  getEffectiveMediaForAccount,
  resolveStatusFilter,
  mediaSearchWhere,
  serializeMediaAsset,
} from '@/lib/services/media';

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
 * With accountKey → returns that account's S3 media.
 *
 * `?scope=effective` (with an accountKey) returns the account's EFFECTIVE set
 * instead: global ∪ its OEMs' shared assets ∪ its ancestors' ∪ its own — the
 * union described in docs/asset-management.md §9.2.
 *
 * The default is unchanged (exact accountKey match) so every existing caller —
 * the picker, the builder, the library page — behaves exactly as before.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const accountKeyParam = req.nextUrl.searchParams.get('accountKey');
  /**
   * `accountKey=all` spans every scope — admin-level, OEM-shared and every
   * sub-account's own. It's what the unified admin library lands on, and it is a
   * third case: omitting the param means admin-level ONLY (accountKey null),
   * which is a different question.
   */
  const allScopes = accountKeyParam === 'all';
  const accountKey = allScopes ? null : accountKeyParam || null;
  const offset = Number(req.nextUrl.searchParams.get('cursor') || '0');
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || '50'), 100);
  const category = req.nextUrl.searchParams.get('category') || undefined;
  const assetCategory = req.nextUrl.searchParams.get('assetCategory') || undefined;
  const oem = req.nextUrl.searchParams.get('oem') || undefined;
  const assetSource = req.nextUrl.searchParams.get('assetSource') || undefined;
  const search = req.nextUrl.searchParams.get('search') || undefined;
  const statusParam = req.nextUrl.searchParams.get('status') || undefined;
  // Clients see cleared work only — the consumer tier. Forced rather than
  // trusted from the query string, so it can't be widened by editing the URL.
  const status = resolveStatusFilter(session!.user.role, statusParam);
  const countOnly = req.nextUrl.searchParams.get('countOnly') === 'true';
  const effectiveScope = req.nextUrl.searchParams.get('scope') === 'effective';
  // Archive scoping: default view hides archived assets; `archived=true` shows
  // ONLY the archived ones (the "Archived" view / restore surface).
  const archivedParam = req.nextUrl.searchParams.get('archived') === 'true';

  // Access check. Spanning every account needs the same unrestricted rights as
  // the admin library, since that's exactly what it reads across.
  if (accountKey === null) {
    if (!canAccessAdminMedia(session!)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
  } else {
    if (!canAccessAccount(session!, accountKey)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
  }

  // Effective (union) scope — inherited assets included. Needs a concrete
  // account to resolve brands and ancestors from, so it is ignored at admin
  // level, where everything is already visible.
  if (effectiveScope && accountKey !== null) {
    const { assets, total } = await getEffectiveMediaForAccount(accountKey, {
      category,
      assetCategory,
      oem,
      assetSource,
      status,
      search,
      archived: archivedParam,
      skip: countOnly ? 0 : offset,
      take: countOnly ? 0 : limit,
    });

    if (countOnly) return NextResponse.json({ total, source: 's3' });

    const files = assets.map((a) => serializeMediaAsset(a));
    const next = offset + files.length;
    return NextResponse.json({
      files,
      total,
      nextCursor: next < total ? String(next) : undefined,
      source: 's3',
      scope: 'effective',
    });
  }

  // Prisma where: null accountKey = admin, otherwise = account-scoped
  // Prisma requires { equals: null } for nullable field null checks
  const where = {
    AND: [
      ...(search ? [mediaSearchWhere(search)] : []),
      {
        // Omitted entirely for `all` — any constraint here would narrow it.
        ...(allScopes
          ? {}
          : { accountKey: accountKey === null ? { equals: null as string | null } : accountKey }),
        ...(category ? { category } : {}),
        ...(assetCategory ? { assetCategory } : {}),
        // `oem=none` asks for brand-AGNOSTIC assets specifically, which is a
        // different question from omitting the filter (any brand, or none). The
        // OEM library rail needs to distinguish them.
        ...(oem === 'none'
          ? { oem: { equals: null as string | null } }
          : oem
            ? { oem }
            : {}),
        ...(assetSource ? { assetSource } : {}),
        ...(status ? { status } : {}),
        archivedAt: archivedParam ? { not: null } : { equals: null as Date | null },
      },
    ],
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

  const files = assets.map((a) => serializeMediaAsset(a));

  const nextOffset = offset + files.length;

  return NextResponse.json({
    files,
    total,
    nextCursor: nextOffset < total ? String(nextOffset) : undefined,
    source: 's3',
  });
}

/** Read a form field as a trimmed string, or undefined when absent/blank. */
function formField(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * POST /api/media
 *
 * Upload a file to S3. Expects multipart/form-data with:
 *   - file (file)
 *   - category (optional text: "brand" | "ad-creative" | "oem" | "general")
 *   - accountKey (optional — omit for admin-level upload)
 *   - oem (optional — with no accountKey, makes this an OEM-shared asset)
 *   - assetSource, assetCategory, modelYear, vehicleModel, rightsHolder, tags
 *     (optional DAM metadata — see lib/media-metadata.ts)
 *   - allowDuplicate ("true" to upload anyway past the content-hash check)
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
  // Optional accessible alt text — caller (e.g. media library uploader)
  // can set it now, or it can be added later via PATCH.
  const altTextRaw = formData.get('altText');
  const altText =
    typeof altTextRaw === 'string' && altTextRaw.trim().length > 0
      ? altTextRaw.trim()
      : null;
  const allowDuplicate = formData.get('allowDuplicate') === 'true';

  // DAM metadata. Only keys actually sent are validated, so an uploader that
  // knows nothing about them (the picker, the builder) is unaffected.
  const metadataInput: Record<string, unknown> = {};
  for (const key of ['oem', 'assetSource', 'assetCategory', 'modelYear', 'vehicleModel', 'rightsHolder', 'tags']) {
    const value = formField(formData, key);
    if (value !== undefined) metadataInput[key] = value;
  }

  const metadataResult = buildAssetMetadata(metadataInput);
  if ('error' in metadataResult) {
    return NextResponse.json({ error: metadataResult.error }, { status: 400 });
  }
  const metadata = metadataResult.data;

  if (!file) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  // Per-family ceiling — a PSD master and a display banner have no business
  // sharing one limit. See lib/media-limits.ts for what the buffered upload
  // path can actually honour.
  const sizeError = checkUploadSize(file.size, file.type);
  if (sizeError) {
    return NextResponse.json({ error: sizeError }, { status: 413 });
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


  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || 'application/octet-stream';
  const assetId = randomUUID().replace(/-/g, '');

  // Content hash, computed before anything is written. An identical file already
  // in this scope is reported back rather than stored twice — the duplicate-upload
  // case docs/asset-management.md §11 opens with. It's a WARNING, not a block:
  // the caller decides, because "upload it anyway" is sometimes correct.
  const contentHash = createHash('sha256').update(buffer).digest('hex');

  if (!allowDuplicate) {
    const existing = await findDuplicateAsset(contentHash, {
      accountKey,
      oem: metadata.oem ?? null,
    });
    if (existing) {
      return NextResponse.json(
        {
          duplicate: true,
          file: serializeMediaAsset(existing),
          message: `"${existing.filename}" already exists here with identical contents.`,
        },
        { status: 409 },
      );
    }
  }

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
        uploadedBy: session!.user.id,
        contentHash,
        ...metadata,
      },
    });

    return NextResponse.json({ file: serializeMediaAsset(asset) }, { status: 201 });
  } catch (err) {
    console.error('[api/media] upload failed:', err);
    const { status, error } = describeMediaUploadError(err);
    return NextResponse.json({ error }, { status });
  }
}
