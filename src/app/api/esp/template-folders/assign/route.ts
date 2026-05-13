import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import {
  assignTemplatesToFolder,
  folderExistsForAccount,
  getAccountAssignments,
} from '@/lib/esp-template-folders-store';

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

export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  try {
    const body = await req.json();
    const accountKey = typeof body?.accountKey === 'string' ? body.accountKey.trim() : '';
    const templateIds = Array.isArray(body?.templateIds)
      ? body.templateIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];
    const folderId =
      body?.folderId === null
        ? null
        : (typeof body?.folderId === 'string' && body.folderId.trim() ? body.folderId.trim() : null);

    if (!accountKey) {
      return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
    }
    if (!canAccessAccount(session!, accountKey)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    if (templateIds.length === 0) {
      return NextResponse.json({ error: 'templateIds are required' }, { status: 400 });
    }

    if (folderId && !(await folderExistsForAccount(accountKey, folderId))) {
      return NextResponse.json({ error: 'Target folder not found' }, { status: 404 });
    }

    const assignments = await assignTemplatesToFolder(accountKey, templateIds, folderId);
    return NextResponse.json({ assignments: assignments ?? (await getAccountAssignments(accountKey)) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
