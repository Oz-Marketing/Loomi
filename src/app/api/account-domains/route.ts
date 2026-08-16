import { NextRequest, NextResponse } from 'next/server';
import { canAccessAccount, forbidden, getAccountScope } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import {
  AccountDomainServiceError,
  createAccountDomain,
  listAccountDomains,
} from '@/lib/services/account-domains';

function serviceError(err: unknown) {
  if (err instanceof AccountDomainServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  throw err;
}

export async function GET(req: NextRequest) {
  const { session, error } = await requirePermission('studio.domains.view');
  if (error) return error;

  const accountKey = req.nextUrl.searchParams.get('accountKey');
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }
  if (!canAccessAccount(getAccountScope(session!), accountKey)) return forbidden();

  const domains = await listAccountDomains(accountKey);
  return NextResponse.json({ domains });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requirePermission('studio.domains.manage');
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const accountKey = typeof body?.accountKey === 'string' ? body.accountKey.trim() : '';
  const hostname = typeof body?.hostname === 'string' ? body.hostname : '';
  if (!accountKey || !hostname) {
    return NextResponse.json(
      { error: 'accountKey and hostname are required' },
      { status: 400 },
    );
  }
  if (!canAccessAccount(getAccountScope(session!), accountKey)) return forbidden();

  try {
    const domain = await createAccountDomain({ accountKey, hostname });
    return NextResponse.json({ domain }, { status: 201 });
  } catch (err) {
    return serviceError(err);
  }
}
