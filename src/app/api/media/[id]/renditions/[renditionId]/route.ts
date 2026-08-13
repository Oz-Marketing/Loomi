import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { canAccessAsset } from '@/lib/services/media';
import { deleteRendition } from '@/lib/services/media-renditions';

/**
 * DELETE /api/media/[id]/renditions/[renditionId]
 *
 * Renditions are disposable by design — the master is the source of truth, so
 * removing one is a low-stakes act that can always be undone by regenerating.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; renditionId: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id, renditionId } = await params;

  const rendition = await prisma.mediaRendition.findUnique({
    where: { id: renditionId },
    select: { assetId: true, asset: { select: { accountKey: true } } },
  });
  if (!rendition) return NextResponse.json({ error: 'Rendition not found' }, { status: 404 });

  // Guard against a rendition id from a different asset being passed through
  // this asset's route — the URL asserts a relationship, so verify it.
  if (rendition.assetId !== id) {
    return NextResponse.json({ error: 'Rendition not found' }, { status: 404 });
  }

  if (!canAccessAsset(session!, rendition.asset.accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  await deleteRendition(renditionId);
  return NextResponse.json({ deleted: true });
}
