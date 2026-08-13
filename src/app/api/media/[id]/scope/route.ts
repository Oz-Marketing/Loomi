import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { normalizeOems } from '@/lib/oems';
import {
  checkScopeMove,
  findDuplicateAsset,
  serializeMediaAsset,
  type ScopeTarget,
} from '@/lib/services/media';

/**
 * POST /api/media/[id]/scope
 *
 * Move an asset between scopes — promote a rooftop's asset to its OEM library,
 * hand a shared asset to one account, or correct a brand.
 *
 * Body: { accountKey: string | null, oem: string | null }
 *
 * ── The S3 key does NOT move ──
 *
 * Keys encode the owning scope (`media/{accountKey|_admin}/{id}/{file}`), so
 * after a move the prefix is historical rather than descriptive. That is
 * deliberate and matches what PATCH already does for renames: the URL is
 * embedded in published landing pages, sent emails and rendered ads, and
 * re-keying the object would break every one of them to make a path look tidy.
 *
 * A separate endpoint from PATCH because this is the one media operation whose
 * blast radius exceeds its own row: it changes who can SEE the asset.
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
  if (rawAccountKey !== null && typeof rawAccountKey !== 'string') {
    return NextResponse.json({ error: 'accountKey must be a string or null' }, { status: 400 });
  }
  if (rawOem !== null && typeof rawOem !== 'string' && rawOem !== undefined) {
    return NextResponse.json({ error: 'oem must be a string or null' }, { status: 400 });
  }

  // Canonicalize the brand the same way upload does, so "audi" and "Audi" can't
  // create two libraries that look identical in the rail.
  const [normalizedOem] = rawOem ? normalizeOems(rawOem) : [];
  const target: ScopeTarget = {
    accountKey: rawAccountKey || null,
    oem: normalizedOem || null,
  };

  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });

  const check = checkScopeMove(session!, asset, target);
  if (check.error) {
    return NextResponse.json({ error: check.error }, { status: 403 });
  }

  // The destination account has to exist, or the asset lands somewhere nothing
  // resolves and simply disappears from every view.
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
  // consistent with upload, where a deliberate second copy is sometimes right.
  let duplicateOf: string | null = null;
  if (asset.contentHash) {
    const existing = await findDuplicateAsset(asset.contentHash, target);
    if (existing && existing.id !== id) duplicateOf = existing.filename;
  }

  const updated = await prisma.mediaAsset.update({
    where: { id },
    data: { accountKey: target.accountKey, oem: target.oem },
  });

  return NextResponse.json({ file: serializeMediaAsset(updated), duplicateOf });
}
