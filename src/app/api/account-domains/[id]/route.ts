import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import {
  AccountDomainServiceError,
  deleteAccountDomain,
  getAccountDomain,
  setAccountDomainHome,
} from '@/lib/services/account-domains';

function serviceError(err: unknown) {
  if (err instanceof AccountDomainServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  throw err;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requirePermission('studio.domains.view');
  if (error) return error;

  const { id } = await context.params;
  const domain = await getAccountDomain(id, getAccountScope(session!));
  if (!domain) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ domain });
}

/**
 * PATCH — currently supports only `homeLandingPageId`. Pass null to
 * clear the home setting; pass a string to designate an LP from the
 * same account.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requirePermission('studio.domains.manage');
  if (error) return error;

  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));

  try {
    if (body.homeLandingPageId !== undefined) {
      const next: string | null =
        body.homeLandingPageId === null
          ? null
          : typeof body.homeLandingPageId === 'string'
            ? body.homeLandingPageId
            : null;
      const domain = await setAccountDomainHome(id, getAccountScope(session!), next);
      return NextResponse.json({ domain });
    }
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  } catch (err) {
    return serviceError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requirePermission('studio.domains.manage');
  if (error) return error;

  const { id } = await context.params;
  try {
    await deleteAccountDomain(id, getAccountScope(session!));
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return serviceError(err);
  }
}
