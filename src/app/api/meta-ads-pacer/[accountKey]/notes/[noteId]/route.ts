import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { canAccessPacer } from '@/lib/meta-ads-pacer';

/**
 * Delete a single account-level pacer note. Anyone with pacer access on
 * the parent account can remove notes; mirrors the per-ad note delete
 * route (no author-only restriction).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ accountKey: string; noteId: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { accountKey, noteId } = await params;
  if (!canAccessPacer(session, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const note = await prisma.metaAdsPacerAccountNote.findUnique({
    where: { id: noteId },
    select: { accountKey: true },
  });
  if (!note || note.accountKey !== accountKey) {
    return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  }

  await prisma.metaAdsPacerAccountNote.delete({ where: { id: noteId } });
  return NextResponse.json({ ok: true });
}
