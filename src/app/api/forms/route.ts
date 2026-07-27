import { NextRequest, NextResponse } from 'next/server';
import {
  canAccessAccount,
  canAccessOrg,
  forbidden,
  getAccountScope,
  requireRole,
} from '@/lib/api-auth';
import {
  createForm,
  FormServiceError,
  listForms,
} from '@/lib/services/forms';

export async function GET(req: NextRequest) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const scope = getAccountScope(session!);
  const accountKey = req.nextUrl.searchParams.get('accountKey');
  if (accountKey && !canAccessAccount(scope, accountKey)) return forbidden();

  const page = Number(req.nextUrl.searchParams.get('page') || 1);
  const pageSize = Number(req.nextUrl.searchParams.get('pageSize') || 25);
  const isTemplate = req.nextUrl.searchParams.get('isTemplate') === 'true';
  // ?scope=system → the global, account-less template library.
  const systemScope = req.nextUrl.searchParams.get('scope') === 'system';
  // ?organizationId=<id> → templates this org owns (org-authoring view).
  const organizationId = req.nextUrl.searchParams.get('organizationId')?.trim() || null;
  if (organizationId && !(await canAccessOrg(session!, organizationId))) return forbidden();

  const result = await listForms({
    accountKeys: accountKey ? null : scope,
    accountKey,
    page,
    pageSize,
    isTemplate,
    ...(organizationId ? { organizationId } : {}),
    ...(systemScope ? { scope: 'system' as const } : {}),
  });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const accountKey =
    typeof body?.accountKey === 'string' && body.accountKey.trim()
      ? body.accountKey.trim()
      : null;
  const isTemplate = body?.isTemplate === true;
  const organizationId =
    typeof body?.organizationId === 'string' && body.organizationId.trim()
      ? body.organizationId.trim()
      : null;
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  // Live forms and sub-account templates need an account. Only a system/library
  // or org-owned template may be account-less.
  if (!accountKey && !isTemplate) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }

  if (accountKey) {
    const scope = getAccountScope(session!);
    if (!canAccessAccount(scope, accountKey)) return forbidden();
  }
  // Org-owned template: verify the session may author for this org.
  const orgOwned = !accountKey && isTemplate && organizationId;
  if (orgOwned && !(await canAccessOrg(session!, organizationId))) return forbidden();

  try {
    const form = await createForm({
      accountKey,
      // Org-owned template: account-less, tagged to the org.
      organizationId: orgOwned ? organizationId : null,
      name,
      isTemplate,
      createdByUserId: session!.user.id,
    });
    return NextResponse.json({ form }, { status: 201 });
  } catch (err) {
    if (err instanceof FormServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
