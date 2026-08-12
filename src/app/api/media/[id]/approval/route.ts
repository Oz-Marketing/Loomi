import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { canAccessAsset, serializeMediaAsset } from '@/lib/services/media';
import { runPreflight } from '@/lib/media-preflight';

/**
 * GET /api/media/[id]/approval
 *
 * Run pre-flight WITHOUT changing anything — "what would happen if I approved
 * this". Read-only, so anyone who can see the asset can ask.
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
    include: { _count: { select: { renditions: true } } },
  });
  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });

  const { role, accountKeys = [] } = session!.user;
  const readable =
    asset.accountKey === null
    || role === 'developer'
    || role === 'super_admin'
    || (role === 'admin' && accountKeys.length === 0)
    || accountKeys.includes(asset.accountKey);
  if (!readable) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  return NextResponse.json({
    preflight: runPreflight(
      { ...asset, renditionCount: asset._count.renditions },
      new Date(),
    ),
  });
}

/**
 * POST /api/media/[id]/approval
 *
 * Body: { action: 'approve' | 'revoke', note?: string, acknowledgeWarnings?: boolean }
 *
 * `approve` clears the asset for use. Pre-flight runs here and a BLOCK refuses —
 * approving an out-of-licence asset would assert something false, and no amount
 * of reviewer intent makes it true. Warnings don't refuse; they're recorded on
 * the approval so the gap stays visible afterwards.
 *
 * `revoke` returns it to draft, carrying the reviewer's note. There is
 * deliberately no `rejected` state: it would differ from draft only in that
 * someone had looked, which the note already says.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action !== 'approve' && action !== 'revoke') {
    return NextResponse.json({ error: "action must be 'approve' or 'revoke'" }, { status: 400 });
  }

  const note = typeof body?.note === 'string' ? body.note.trim() || null : null;

  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    include: { _count: { select: { renditions: true } } },
  });
  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });

  // Approving a shared asset clears it for every account that can see it, so it
  // needs the same write gate as editing one.
  if (!canAccessAsset(session!, asset.accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  if (action === 'revoke') {
    const updated = await prisma.mediaAsset.update({
      where: { id },
      data: {
        status: 'draft',
        approvedAt: null,
        approvedById: null,
        approvedByName: null,
        reviewNote: note,
      },
    });
    return NextResponse.json({ file: serializeMediaAsset(updated) });
  }

  const preflight = runPreflight(
    { ...asset, renditionCount: asset._count.renditions },
    new Date(),
  );

  if (!preflight.canApprove) {
    // Stored even on refusal: the reviewer needs to see what stopped it, and
    // re-running preflight to find out would be a worse experience.
    await prisma.mediaAsset.update({
      where: { id },
      data: { preflightResult: JSON.stringify(preflight) },
    });
    return NextResponse.json(
      { error: 'Pre-flight blocked this approval', preflight },
      { status: 422 },
    );
  }

  const updated = await prisma.mediaAsset.update({
    where: { id },
    data: {
      status: 'approved',
      approvedAt: new Date(),
      approvedById: session!.user.id,
      approvedByName: session!.user.name || session!.user.email || null,
      reviewNote: note,
      preflightResult: JSON.stringify(preflight),
    },
  });

  return NextResponse.json({ file: serializeMediaAsset(updated), preflight });
}
