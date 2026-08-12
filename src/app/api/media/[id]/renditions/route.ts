import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { canAccessAsset } from '@/lib/services/media';
import {
  canGenerateRenditions,
  generateRenditions,
  listRenditions,
} from '@/lib/services/media-renditions';

/**
 * GET /api/media/[id]/renditions
 *
 * The platform sizes already generated from this master.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    select: { id: true, accountKey: true, mimeType: true },
  });
  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });

  // Read access is wider than write: an inherited OEM asset is READABLE by every
  // account carrying the brand, and its renditions are the whole point of that
  // sharing. Generation below still requires write access.
  const { role, accountKeys = [] } = session!.user;
  const readable =
    asset.accountKey === null
    || role === 'developer'
    || role === 'super_admin'
    || (role === 'admin' && accountKeys.length === 0)
    || accountKeys.includes(asset.accountKey);
  if (!readable) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  return NextResponse.json({
    renditions: await listRenditions(id),
    supported: canGenerateRenditions(asset.mimeType),
  });
}

/**
 * POST /api/media/[id]/renditions
 *
 * Generate one or more platform sizes from the master.
 *
 * Body: { sizes: [{ name: string, fit?: 'cover' | 'contain' }] }
 *
 * Regenerating a size replaces it — see the unique index on (assetId, name).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const sizes = Array.isArray(body?.sizes) ? body.sizes : [];
  if (sizes.length === 0) {
    return NextResponse.json({ error: 'sizes must be a non-empty array' }, { status: 400 });
  }
  // A bound, because each size is a full resize of the master and the request is
  // synchronous. The whole catalog is under this; a client asking for more is
  // asking for a timeout.
  if (sizes.length > 24) {
    return NextResponse.json({ error: 'Too many sizes in one request (max 24)' }, { status: 400 });
  }

  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    select: { accountKey: true, mimeType: true },
  });
  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });

  // Writing derivatives of a shared asset is a shared act — same gate as editing
  // the master itself.
  if (!canAccessAsset(session!, asset.accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  if (!canGenerateRenditions(asset.mimeType)) {
    return NextResponse.json(
      { error: 'Renditions can only be generated from raster images' },
      { status: 400 },
    );
  }

  const requests = sizes.map((s: unknown) =>
    typeof s === 'string'
      ? { name: s }
      : { name: String((s as { name?: unknown })?.name ?? ''), fit: (s as { fit?: 'cover' | 'contain' })?.fit },
  );

  try {
    const result = await generateRenditions(id, requests, session!.user.id);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate renditions';
    // Missing S3 config is the common local failure and deserves its own status —
    // it isn't a bad request and retrying won't help.
    const storage = message.includes('S3_BUCKET') || message.includes('S3_ACCESS_KEY_ID');
    console.error('[api/media/[id]/renditions] failed:', err);
    return NextResponse.json(
      { error: storage ? 'Loomi storage is not configured on the server.' : message },
      { status: storage ? 503 : 500 },
    );
  }
}
