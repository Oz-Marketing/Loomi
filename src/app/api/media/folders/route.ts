import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

/**
 * Media folders — /api/media/folders
 *
 * Folders organize media within a scope (an account, or the admin library when
 * accountKey is null). They nest via parentId; the client builds the tree +
 * breadcrumb from the flat list. See /api/media/folders/[id] for rename / move /
 * delete, and /api/media (folder param) for a folder's assets.
 */

type SessionUser = { user: { id: string; role: string; accountKeys?: string[] } };

function canAccess(session: SessionUser, accountKey: string | null): boolean {
  const { role, accountKeys = [] } = session.user;
  if (role === 'developer' || role === 'super_admin') return true;
  if (role === 'admin' && accountKeys.length === 0) return true;
  if (accountKey === null) return false; // admin library needs an unrestricted admin
  return accountKeys.includes(accountKey);
}

/** GET /api/media/folders?accountKey= → all folders in the scope (flat). */
export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const accountKey = req.nextUrl.searchParams.get('accountKey') || null;
  if (!canAccess(session as SessionUser, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  try {
    const folders = await prisma.mediaFolder.findMany({
      where: { accountKey: accountKey === null ? { equals: null as string | null } : accountKey },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, parentId: true },
    });
    return NextResponse.json({ folders });
  } catch (err) {
    console.warn('[api/media/folders] falling back to []:', err);
    return NextResponse.json({ folders: [] });
  }
}

/** POST /api/media/folders → create { name, parentId?, accountKey? }. */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const accountKey = (body.accountKey as string | null) || null;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!canAccess(session as SessionUser, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  // A parent, if given, must be in the same scope.
  const parentId = body.parentId ? String(body.parentId) : null;
  if (parentId) {
    const parent = await prisma.mediaFolder.findUnique({ where: { id: parentId }, select: { accountKey: true } });
    if (!parent || (parent.accountKey ?? null) !== accountKey) {
      return NextResponse.json({ error: 'Parent folder not found in this scope' }, { status: 400 });
    }
  }

  const folder = await prisma.mediaFolder.create({
    data: { accountKey, name, parentId, createdBy: session!.user.id },
    select: { id: true, name: true, parentId: true },
  });
  return NextResponse.json({ folder }, { status: 201 });
}
