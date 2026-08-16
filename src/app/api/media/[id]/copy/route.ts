import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { normalizeOems } from '@/lib/oems';
import { buildS3Key, buildThumbnailKey, copyS3Object, isS3Configured } from '@/lib/s3';
import {
  checkAssetCopy,
  findDuplicateAsset,
  serializeMediaAsset,
  type ScopeTarget,
} from '@/lib/services/media';

/**
 * POST /api/media/[id]/copy
 *
 * Copy an asset into another scope — usually another sub-account. The original
 * stays exactly where it is.
 *
 * Body: { accountKey: string | null, oem: string | null }
 *
 * ── Why a copy and not a share ──
 *
 * Sharing already has an answer: an asset with no accountKey (optionally with
 * an `oem`) resolves into every account it covers, so "publish once, everyone
 * gets it" is a scope, not a copy. This endpoint is the other case — one
 * rooftop wants the photo another rooftop happens to own, as its own asset,
 * free to be renamed, re-approved, archived or deleted without touching the
 * original. That independence is the entire point, so the copy gets its own S3
 * object rather than pointing at the source's.
 *
 * The copy records `parentAssetId`, which is what makes "where did this come
 * from?" answerable later. Renditions, collection memberships and public links
 * are deliberately NOT carried over: they belong to the asset they were made
 * for.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const rawAccountKey = body?.accountKey;
  const rawOem = body?.oem;
  if (rawAccountKey !== null && typeof rawAccountKey !== 'string' && rawAccountKey !== undefined) {
    return NextResponse.json({ error: 'accountKey must be a string or null' }, { status: 400 });
  }
  if (rawOem !== null && typeof rawOem !== 'string' && rawOem !== undefined) {
    return NextResponse.json({ error: 'oem must be a string or null' }, { status: 400 });
  }

  // Canonicalize the brand exactly as upload and scope-move do, so "audi" and
  // "Audi" can't produce two libraries that look identical in the rail.
  const [normalizedOem] = rawOem ? normalizeOems(rawOem) : [];
  const target: ScopeTarget = {
    accountKey: rawAccountKey || null,
    oem: normalizedOem || null,
  };

  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });

  const check = checkAssetCopy(session!, asset, target);
  if (check.error) {
    return NextResponse.json({ error: check.error }, { status: 403 });
  }

  if (target.accountKey) {
    const account = await prisma.account.findUnique({
      where: { key: target.accountKey },
      select: { key: true },
    });
    if (!account) {
      return NextResponse.json({ error: 'That sub-account does not exist' }, { status: 400 });
    }
  }

  // Same bytes may already sit in the destination. Reported, not blocked —
  // consistent with upload and scope-move, where a deliberate second copy is
  // sometimes right.
  let duplicateOf: string | null = null;
  if (asset.contentHash) {
    const existing = await findDuplicateAsset(asset.contentHash, target);
    if (existing && existing.id !== id) duplicateOf = existing.filename;
  }

  // The id is generated here rather than by the database default because the
  // S3 key contains it, and `s3Key` is unique — inserting with any placeholder
  // (the source's key included) collides with the row that already holds it.
  const newId = randomUUID().replace(/-/g, '');
  const newS3Key = buildS3Key(target.accountKey, newId, asset.filename);
  const newThumbnailKey = asset.thumbnailKey ? buildThumbnailKey(target.accountKey, newId) : null;

  // Create the row before copying the bytes: a row with no object is
  // recoverable (copy again), where an orphaned object is not findable.
  //
  // Approval state travels with the copy. It is the same file, cleared by the
  // same agency — dropping it back to draft would make every copy invisible to
  // the client whose account it was copied into, which is the opposite of what
  // copying it was for. `parentAssetId` records where it came from.
  const created = await prisma.mediaAsset.create({
    data: {
      id: newId,
      accountKey: target.accountKey,
      oem: target.oem,
      s3Key: newS3Key,
      ...(newThumbnailKey ? { thumbnailKey: newThumbnailKey } : {}),
      filename: asset.filename,
      mimeType: asset.mimeType,
      size: asset.size,
      width: asset.width,
      height: asset.height,
      altText: asset.altText,
      category: asset.category,
      tags: asset.tags,
      uploadedBy: session!.user.id,
      assetSource: asset.assetSource,
      assetCategory: asset.assetCategory,
      modelYear: asset.modelYear,
      vehicleModel: asset.vehicleModel,
      rightsHolder: asset.rightsHolder,
      contentHash: asset.contentHash,
      parentAssetId: asset.id,
      licenseType: asset.licenseType,
      licenseRef: asset.licenseRef,
      licenseStartsAt: asset.licenseStartsAt,
      licenseExpiresAt: asset.licenseExpiresAt,
      usageScope: asset.usageScope,
      territoryScope: asset.territoryScope,
      exclusive: asset.exclusive,
      talentReleaseOnFile: asset.talentReleaseOnFile,
      derivativesPermitted: asset.derivativesPermitted,
      sublicensingPermitted: asset.sublicensingPermitted,
      expiresAt: asset.expiresAt,
      status: asset.status,
      approvedAt: asset.approvedAt,
      approvedById: asset.approvedById,
      approvedByName: asset.approvedByName,
    },
  });

  try {
    if (isS3Configured()) {
      await copyS3Object(asset.s3Key, newS3Key);
      if (asset.thumbnailKey && newThumbnailKey) {
        // A missing thumbnail is cosmetic — the grid falls back to the full
        // image — so it must not fail the copy of the asset itself.
        try {
          await copyS3Object(asset.thumbnailKey, newThumbnailKey);
        } catch {
          /* keep the copy, drop the thumbnail */
        }
      }
    }
  } catch (err) {
    // No bytes at the destination means the row points at nothing, so take the
    // row back out rather than leaving a broken asset in someone's library.
    await prisma.mediaAsset.delete({ where: { id: created.id } }).catch(() => {});
    const message = err instanceof Error ? err.message : 'Copy failed';
    return NextResponse.json({ error: `Could not copy the file: ${message}` }, { status: 502 });
  }

  return NextResponse.json({ file: serializeMediaAsset(created), duplicateOf });
}
