import { NextRequest, NextResponse } from 'next/server';
import { canAccessAccount, forbidden, getAccountScope } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import {
  AccountSnippetServiceError,
  createAccountSnippet,
  listAccountSnippets,
} from '@/lib/services/account-snippets';

export async function GET() {
  const { session, error } = await requirePermission('studio.blocks.view');
  if (error) return error;

  const snippets = await listAccountSnippets(getAccountScope(session!));
  return NextResponse.json({ snippets });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requirePermission('studio.blocks.edit');
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const accountKey = typeof body?.accountKey === 'string' ? body.accountKey.trim() : '';
  const kind = typeof body?.kind === 'string' ? body.kind : 'generic';

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }

  const scope = getAccountScope(session!);
  if (!canAccessAccount(scope, accountKey)) return forbidden();

  try {
    const snippet = await createAccountSnippet({
      accountKey,
      name,
      kind: kind === 'header' || kind === 'footer' || kind === 'disclaimer' ? kind : 'generic',
      createdByUserId: session!.user.id,
    });
    return NextResponse.json({ snippet }, { status: 201 });
  } catch (err) {
    if (err instanceof AccountSnippetServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
