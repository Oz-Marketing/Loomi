import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import {
  AccountSnippetServiceError,
  deleteAccountSnippet,
  getAccountSnippet,
  updateAccountSnippet,
} from '@/lib/services/account-snippets';

function serviceError(err: unknown) {
  if (err instanceof AccountSnippetServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  throw err;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requirePermission('studio.blocks.view');
  if (error) return error;

  const { id } = await context.params;
  const snippet = await getAccountSnippet(id, getAccountScope(session!));
  if (!snippet) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ snippet });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requirePermission('studio.blocks.edit');
  if (error) return error;

  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));

  try {
    const snippet = await updateAccountSnippet(id, getAccountScope(session!), {
      name: body?.name,
      kind: body?.kind,
      schema: body?.schema,
    });
    return NextResponse.json({ snippet });
  } catch (err) {
    return serviceError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requirePermission('studio.blocks.edit');
  if (error) return error;

  const { id } = await context.params;
  try {
    await deleteAccountSnippet(id, getAccountScope(session!));
    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    return serviceError(err);
  }
}
