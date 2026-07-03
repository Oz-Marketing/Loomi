import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

/**
 * Media folder — /api/media/folders/[id]
 *
 * PATCH  rename ({ name }) and/or move ({ parentId }) within the same scope.
 * DELETE re-parents this folder's assets + subfolders up to its own parent,
 *        then removes the folder. It never deletes media.
 */

type SessionUser = { user: { id: string; role: string; accountKeys?: string[] } };

function canAccess(session: SessionUser, accountKey: string | null): boolean {
  const { role, accountKeys = [] } = session.user;
  if (role === 'developer' || role === 'super_admin') return true;
  if (role === 'admin' && accountKeys.length === 0) return true;
  if (accountKey === null) return false;
  return accountKeys.includes(accountKey);
}

/** True if `maybeAncestorId` is `folderId` or an ancestor of it — used to block
 *  moving a folder into its own subtree (which would orphan a cycle). */
async function wouldCycle(folderId: string, newParentId: string): Promise<boolean> {
  let cur: string | null = newParentId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === folderId) return true;
    if (seen.has(cur)) break; // defensive: pre-existing cycle
    seen.add(cur);
    const p: { parentId: string | null } | null = await prisma.mediaFolder.findUnique({ where: { id: cur }, select: { parentId: true } });
    cur = p?.parentId ?? null;
  }
  return false;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const folder = await prisma.mediaFolder.findUnique({ where: { id }, select: { accountKey: true } });
  if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
  if (!canAccess(session as SessionUser, folder.accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const data: { name?: string; parentId?: string | null } = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 });
    }
    data.name = body.name.trim();
  }

  if (body.parentId !== undefined) {
    const target = body.parentId && body.parentId !== 'root' ? String(body.parentId) : null;
    if (target) {
      if (target === id) return NextResponse.json({ error: "A folder can't be its own parent" }, { status: 400 });
      const parent = await prisma.mediaFolder.findUnique({ where: { id: target }, select: { accountKey: true } });
      if (!parent || (parent.accountKey ?? null) !== (folder.accountKey ?? null)) {
        return NextResponse.json({ error: 'Parent folder not found in this scope' }, { status: 400 });
      }
      if (await wouldCycle(id, target)) {
        return NextResponse.json({ error: "Can't move a folder into itself" }, { status: 400 });
      }
    }
    data.parentId = target;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No changes provided' }, { status: 400 });
  }

  const updated = await prisma.mediaFolder.update({ where: { id }, data, select: { id: true, name: true, parentId: true } });
  return NextResponse.json({ folder: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { id } = await params;

  const folder = await prisma.mediaFolder.findUnique({ where: { id }, select: { accountKey: true, parentId: true } });
  if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
  if (!canAccess(session as SessionUser, folder.accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  // Re-parent contents up to this folder's parent (never delete media), then drop it.
  await prisma.$transaction([
    prisma.mediaAsset.updateMany({ where: { folderId: id }, data: { folderId: folder.parentId } }),
    prisma.mediaFolder.updateMany({ where: { parentId: id }, data: { parentId: folder.parentId } }),
    prisma.mediaFolder.delete({ where: { id } }),
  ]);

  return NextResponse.json({ deleted: true, reparentedTo: folder.parentId });
}
