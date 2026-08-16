import { NextRequest, NextResponse } from 'next/server';
import { canAccessAccount, forbidden, getAccountScope } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import { FormServiceError, copyFormTemplateToAccount } from '@/lib/services/forms';

/**
 * POST /api/forms/[id]/copy
 * Copy a (typically system/library) form template into a sub-account as
 * that account's own template. Body: { accountKey }.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requirePermission('studio.forms.edit');
  if (error) return error;

  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const accountKey = typeof body?.accountKey === 'string' ? body.accountKey.trim() : '';
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }
  if (!canAccessAccount(getAccountScope(session!), accountKey)) return forbidden();

  try {
    const template = await copyFormTemplateToAccount({
      sourceId: id,
      targetAccountKey: accountKey,
      accountKeys: getAccountScope(session!),
      createdByUserId: session!.user.id,
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    if (err instanceof FormServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
