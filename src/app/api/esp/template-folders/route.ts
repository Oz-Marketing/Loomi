import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { resolveAdapterAndCredentials, isResolveError } from '@/lib/esp/route-helpers';
import {
  getAccountFolders,
  getAccountAssignments,
  createAccountFolder,
} from '@/lib/esp-template-folders-store';
import { prisma } from '@/lib/prisma';
import { createTemplateFolder as createGhlFolder } from '@/lib/esp/adapters/ghl/templates';

function canAccessAccount(
  session: { user: { role: string; accountKeys?: string[] } },
  accountKey: string,
): boolean {
  const role = session.user.role;
  const userAccountKeys = session.user.accountKeys ?? [];
  if (role === 'developer' || role === 'super_admin') return true;
  if (role === 'admin' && userAccountKeys.length === 0) return true;
  return userAccountKeys.includes(accountKey);
}

export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const accountKey = req.nextUrl.searchParams.get('accountKey')?.trim();
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }

  if (!canAccessAccount(session!, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const [folders, assignments] = await Promise.all([
    getAccountFolders(accountKey),
    getAccountAssignments(accountKey),
  ]);
  return NextResponse.json({ folders, assignments });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  try {
    const body = await req.json();
    const accountKey = typeof body?.accountKey === 'string' ? body.accountKey.trim() : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const parentId =
      typeof body?.parentId === 'string' && body.parentId.trim()
        ? body.parentId.trim()
        : null;

    if (!accountKey) {
      return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
    }
    if (!canAccessAccount(session!, accountKey)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    if (!name) {
      return NextResponse.json({ error: 'Folder name is required' }, { status: 400 });
    }

    // If parentId is a local folder ID, resolve its remoteId for GHL
    let remoteParentId: string | null = null;
    if (parentId) {
      const parentFolder = await prisma.espTemplateFolder.findFirst({
        where: { id: parentId, accountKey },
        select: { remoteId: true },
      });
      if (!parentFolder) {
        return NextResponse.json({ error: 'Parent folder not found' }, { status: 404 });
      }
      remoteParentId = parentFolder.remoteId;
    }

    // Try to create folder in GHL first
    let remoteId: string | null = null;
    const resolved = await resolveAdapterAndCredentials(accountKey, {});
    if (!isResolveError(resolved) && resolved.adapter.provider === 'ghl') {
      try {
        const ghlFolder = await createGhlFolder(
          resolved.credentials.token,
          resolved.credentials.locationId,
          name,
          remoteParentId,
        );
        remoteId = ghlFolder.id;
      } catch (ghlErr) {
        console.error('[template-folders] Failed to create GHL folder:', ghlErr);
        // Non-fatal: still create locally
      }
    }

    const folder = await createAccountFolder(accountKey, name, parentId, remoteId);
    return NextResponse.json({ folder }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
