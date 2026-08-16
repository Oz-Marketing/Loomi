import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { FormServiceError, deployFormTemplateToAccounts } from '@/lib/services/forms';

/**
 * POST /api/forms/[id]/deploy — admin-only.
 *
 * Body: { accountKeys: string[] }
 *
 * Clones the source form template into each target sub-account as a live
 * draft form (a detached copy — no parent link, schema deep-copied). The
 * source must be a template; deploying a live form is rejected by the
 * service. Per-account failures are returned alongside successes rather
 * than failing the whole batch.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requirePermission('studio.forms.deploy');
  if (error) return error;

  const { id } = await context.params;

  // Admins are constrained to their assigned accountKeys; developer/
  // super_admin can target any account (scope = null → no restriction).
  const scope = session!.user.role === 'admin' ? (session!.user.accountKeys ?? []) : null;

  const body = await req.json().catch(() => ({}));
  const accountKeys = Array.isArray(body?.accountKeys)
    ? body.accountKeys.filter(
        (k: unknown): k is string => typeof k === 'string' && k.length > 0,
      )
    : [];

  if (accountKeys.length === 0) {
    return NextResponse.json(
      { error: 'accountKeys must be a non-empty array of strings.' },
      { status: 400 },
    );
  }

  // Admins may only deploy to accounts they have access to.
  if (scope) {
    const allowed = new Set(scope);
    const blocked = accountKeys.filter((k: string) => !allowed.has(k));
    if (blocked.length > 0) {
      return NextResponse.json(
        { error: `Not authorised to deploy to: ${blocked.join(', ')}` },
        { status: 403 },
      );
    }
  }

  try {
    const result = await deployFormTemplateToAccounts({
      sourceId: id,
      targetAccountKeys: accountKeys,
      accountKeys: scope,
      createdByUserId: session!.user.id,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof FormServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
