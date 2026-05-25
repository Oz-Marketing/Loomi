import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { deployFlowToAccounts, getFlow } from '@/lib/services/loomi-flows';

// POST /api/flows/[id]/deploy — admin-only.
//
// Body: { accountKeys: string[] }
//
// Duplicates the source template once per target account, stamping a
// parentTemplateId into each instance's metadata. The source must be a
// template (accountKey: null); deploying an account-scoped flow is
// rejected by the service.
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await context.params;

  // Scope-check the source flow. Admins are constrained to the
  // accountKeys they're assigned to (matches the pattern in other
  // routes); developer/super_admin sees everything.
  const scope =
    session!.user.role === 'admin'
      ? (session!.user.accountKeys ?? [])
      : null;
  const existing = await getFlow(id, scope);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (existing.accountKey) {
    return NextResponse.json(
      { error: 'Only template flows (no sub-account) can be deployed.' },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const accountKeys = Array.isArray(body?.accountKeys)
    ? body.accountKeys.filter((k: unknown): k is string => typeof k === 'string' && k.length > 0)
    : [];

  if (accountKeys.length === 0) {
    return NextResponse.json(
      { error: 'accountKeys must be a non-empty array of strings.' },
      { status: 400 },
    );
  }

  // Admins may only deploy to accounts they have access to. Developer
  // and super_admin can target any account.
  if (session!.user.role === 'admin') {
    const allowed = new Set(session!.user.accountKeys ?? []);
    const blocked = accountKeys.filter((k: string) => !allowed.has(k));
    if (blocked.length > 0) {
      return NextResponse.json(
        {
          error: `Not authorised to deploy to: ${blocked.join(', ')}`,
        },
        { status: 403 },
      );
    }
  }

  // Reject any target that already has an instance of this template.
  // A template should live at most once per sub-account; updates go
  // through the /resync route instead. Surfaced as 409 with the list
  // so the modal (or any other caller) can present it.
  const duplicates = existing.instances
    .filter((i) => accountKeys.includes(i.accountKey))
    .map((i) => i.accountKey);
  if (duplicates.length > 0) {
    return NextResponse.json(
      {
        error:
          duplicates.length === accountKeys.length
            ? 'All selected sub-accounts already have an instance. Use Update from template to re-sync.'
            : `Already deployed to: ${duplicates.join(', ')}. Use Update from template to re-sync those, or pick different accounts.`,
        duplicates,
      },
      { status: 409 },
    );
  }

  const result = await deployFlowToAccounts(id, accountKeys, {
    createdByUserId: session!.user.id,
  });

  return NextResponse.json(result, { status: 201 });
}
