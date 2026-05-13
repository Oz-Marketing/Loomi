import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { resolveAdapterAndCredentials, isResolveError } from '@/lib/esp/route-helpers';
import {
  getAccountFolders,
  getAccountAssignments,
  updateAccountFolder,
  deleteAccountFolder,
  folderExistsForAccount,
} from '@/lib/esp-template-folders-store';
import { prisma } from '@/lib/prisma';
import {
  updateTemplateFolder as updateGhlFolder,
  deleteTemplateFolder as deleteGhlFolder,
} from '@/lib/esp/adapters/ghl/templates';

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  try {
    const { id } = await params;
    const body = await req.json();
    const accountKey = typeof body?.accountKey === 'string' ? body.accountKey.trim() : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : undefined;
    const parentId =
      body?.parentId === null
        ? null
        : (typeof body?.parentId === 'string' && body.parentId.trim() ? body.parentId.trim() : undefined);

    if (!accountKey) {
      return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
    }
    if (!canAccessAccount(session!, accountKey)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    if (parentId === id) {
      return NextResponse.json({ error: 'Folder cannot be its own parent' }, { status: 400 });
    }
    if (parentId && !(await folderExistsForAccount(accountKey, parentId))) {
      return NextResponse.json({ error: 'Parent folder not found' }, { status: 404 });
    }

    // Look up the local folder to get its remoteId for the GHL sync
    const localFolder = await prisma.espTemplateFolder.findFirst({
      where: { id, accountKey },
      select: { remoteId: true },
    });

    // Update on GHL if this folder has a remoteId and the name is changing
    if (localFolder?.remoteId && name) {
      const resolved = await resolveAdapterAndCredentials(accountKey, {});
      if (!isResolveError(resolved) && resolved.adapter.provider === 'ghl') {
        try {
          await updateGhlFolder(
            resolved.credentials.token,
            resolved.credentials.locationId,
            localFolder.remoteId,
            name,
          );
        } catch (ghlErr) {
          console.error('[template-folders] Failed to update GHL folder:', ghlErr);
          // Non-fatal: still update locally
        }
      }
    }

    const updated = await updateAccountFolder(accountKey, id, {
      ...(name !== undefined ? { name } : {}),
      ...(parentId !== undefined ? { parentId } : {}),
    });
    if (!updated) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    }

    return NextResponse.json({ folder: updated });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const accountKey = req.nextUrl.searchParams.get('accountKey')?.trim();
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }
  if (!canAccessAccount(session!, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  try {
    // Look up the local folder to get its remoteId for the GHL delete
    const localFolder = await prisma.espTemplateFolder.findFirst({
      where: { id, accountKey },
      select: { remoteId: true },
    });

    if (localFolder?.remoteId) {
      const resolved = await resolveAdapterAndCredentials(accountKey, {});
      if (!isResolveError(resolved) && resolved.adapter.provider === 'ghl') {
        try {
          await deleteGhlFolder(
            resolved.credentials.token,
            resolved.credentials.locationId,
            localFolder.remoteId,
          );
        } catch (ghlErr) {
          console.error('[template-folders] Failed to delete GHL folder:', ghlErr);
          // Non-fatal: still delete locally
        }
      }
    }

    const { deletedIds } = await deleteAccountFolder(accountKey, id);
    if (deletedIds.length === 0) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    }

    const [folders, assignments] = await Promise.all([
      getAccountFolders(accountKey),
      getAccountAssignments(accountKey),
    ]);
    return NextResponse.json({ deletedIds, folders, assignments });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
