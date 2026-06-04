import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope, requireRole } from '@/lib/api-auth';
import {
  deleteForm,
  FormServiceError,
  getForm,
  updateForm,
} from '@/lib/services/forms';

function serviceError(err: unknown) {
  if (err instanceof FormServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  throw err;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await context.params;
  const form = await getForm(id, getAccountScope(session!));
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ form });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  try {
    const form = await updateForm(id, getAccountScope(session!), {
      name: body?.name,
      slug: body?.slug,
      status: body?.status,
      schema: body?.schema,
      redirectUrl: body?.redirectUrl,
      successMessage: body?.successMessage,
      listId: body?.listId,
      forwardToCrm: body?.forwardToCrm,
    });
    return NextResponse.json({ form });
  } catch (err) {
    return serviceError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await context.params;
  try {
    await deleteForm(id, getAccountScope(session!));
    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    return serviceError(err);
  }
}
