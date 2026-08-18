import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { buildS3Key, getPresignedUploadUrl, isS3Configured } from '@/lib/s3';
import { DIRECT_UPLOAD_MAX_BYTES, checkAnyUploadSize, formatBytes } from '@/lib/media-limits';
import { canAccessAsset, isConsumerRole } from '@/lib/services/media';

/**
 * POST /api/media/upload-url
 *
 * Mint a pre-signed PUT so the browser can upload a large file straight to S3,
 * bypassing the app server entirely.
 *
 * Body: { filename, contentType, size, accountKey?, oem? }
 * Returns: { url, key, assetId, expiresIn }
 *
 * The client PUTs the bytes to `url`, then calls /api/media/finalize with the
 * same `key` to create the library row. Two steps because the app never sees the
 * bytes — there's nothing to create the row FROM until the object exists.
 *
 * ── Requires bucket CORS ──
 *
 * The browser's PUT is cross-origin, so the bucket must allow PUT from the app's
 * origin. Until that's configured the upload fails in the browser and no
 * server-side code can help. See docs/asset-management.md.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  // Clients browse and download; they never author.
  if (isConsumerRole(session!.user.role)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  if (!isS3Configured()) {
    return NextResponse.json(
      { error: 'Loomi storage is not configured on the server.' },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));

  const filename = typeof body?.filename === 'string' ? body.filename.trim() : '';
  const contentType = typeof body?.contentType === 'string' && body.contentType
    ? body.contentType
    : 'application/octet-stream';
  const size = Number(body?.size);

  if (!filename) {
    return NextResponse.json({ error: 'filename is required' }, { status: 400 });
  }
  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: 'size must be a positive number' }, { status: 400 });
  }

  // Checked before signing: a URL for a file we'd refuse to finalize is worse
  // than useless, because the bytes would already be in the bucket.
  const tooBig = checkAnyUploadSize(size);
  if (tooBig) return NextResponse.json({ error: tooBig }, { status: 413 });

  const accountKey = typeof body?.accountKey === 'string' && body.accountKey ? body.accountKey : null;
  if (!canAccessAsset(session!, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }
  if (accountKey) {
    const account = await prisma.account.findUnique({
      where: { key: accountKey },
      select: { key: true },
    });
    if (!account) {
      return NextResponse.json({ error: 'That account does not exist' }, { status: 400 });
    }
  }

  // The id is minted HERE and reused as the row id at finalize, so the S3 key and
  // the asset can't disagree about which upload they belong to.
  const assetId = randomUUID().replace(/-/g, '');
  const key = buildS3Key(accountKey, assetId, filename);

  const expiresIn = 900;
  const url = await getPresignedUploadUrl(key, contentType, expiresIn);

  return NextResponse.json({
    url,
    key,
    assetId,
    expiresIn,
    maxBytes: DIRECT_UPLOAD_MAX_BYTES,
    // Echoed so the client can't accidentally send a different Content-Type than
    // the one signed into the URL — S3 rejects the PUT if they differ.
    contentType,
    note: `Direct upload, up to ${formatBytes(DIRECT_UPLOAD_MAX_BYTES)}.`,
  });
}
