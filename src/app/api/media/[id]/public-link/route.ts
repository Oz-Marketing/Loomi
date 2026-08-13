import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { canAccessAsset } from '@/lib/services/media';
import {
  createPublicLink,
  listPublicLinks,
  revokePublicLink,
} from '@/lib/services/media-public-links';

/** Load the asset and check the session may share it. */
async function authorize(id: string, session: { user: { role: string; accountKeys?: string[] } }) {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    select: { id: true, accountKey: true, archivedAt: true },
  });
  if (!asset) return { error: NextResponse.json({ error: 'Asset not found' }, { status: 404 }) };
  // Sharing outward is a write-level act, not a read: the same gate as editing.
  if (!canAccessAsset(session, asset.accountKey)) {
    return { error: NextResponse.json({ error: 'Access denied' }, { status: 403 }) };
  }
  return { asset };
}

/** GET — the links that exist for this asset, including revoked ones. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const auth = await authorize(id, session!);
  if ('error' in auth) return auth.error;

  return NextResponse.json({ links: await listPublicLinks(id) });
}

/**
 * POST — mint a link.
 *
 * Body: { label?: string, expiresAt?: ISO string }
 *
 * No expiry by default: the point is a link that keeps working, so a vendor
 * doesn't come back in March asking for a fresh one.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const auth = await authorize(id, session!);
  if ('error' in auth) return auth.error;

  // Sharing something already withdrawn from circulation is almost certainly a
  // mistake, and it's cheap to refuse here.
  if (auth.asset.archivedAt) {
    return NextResponse.json(
      { error: 'This asset is archived — restore it before sharing a link.' },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));

  let expiresAt: Date | null = null;
  if (body?.expiresAt) {
    const parsed = new Date(body.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'expiresAt must be a valid date' }, { status: 400 });
    }
    if (parsed.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: 'That expiry is already in the past — the link would be dead on arrival.' },
        { status: 400 },
      );
    }
    expiresAt = parsed;
  }

  const link = await createPublicLink({
    assetId: id,
    label: typeof body?.label === 'string' ? body.label : null,
    expiresAt,
    userId: session!.user.id,
    userName: session!.user.name || session!.user.email || null,
  });

  return NextResponse.json({ link }, { status: 201 });
}

/**
 * DELETE ?token=… — revoke one link.
 *
 * The row survives with a revokedAt stamp; see the service comment.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const auth = await authorize(id, session!);
  if ('error' in auth) return auth.error;

  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token is required' }, { status: 400 });

  // Verify the token belongs to THIS asset — the URL asserts that relationship,
  // so an id from another asset must not be revocable through this route.
  const link = await prisma.mediaPublicLink.findUnique({
    where: { id: token },
    select: { assetId: true },
  });
  if (!link || link.assetId !== id) {
    return NextResponse.json({ error: 'Link not found' }, { status: 404 });
  }

  await revokePublicLink(token);
  return NextResponse.json({ revoked: true });
}
