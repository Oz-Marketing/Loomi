import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { duplicateFlow, getFlow } from '@/lib/services/loomi-flows';

// POST /api/flows/[id]/duplicate
//
// Body: { name?: string, accountKey?: string }
//
// - When `accountKey` is omitted, the clone inherits the source's
//   accountKey (existing behaviour — same-account duplicate).
// - When `accountKey` is provided, the clone is created under that
//   sub-account. If the source is itself a template (no accountKey),
//   parentTemplateId is set so the new instance shows up in the
//   template's adoption list — same shape as Deploy.
//
// Permission model:
// - developer / super_admin: anything goes.
// - admin: can clone any flow they can read, into any of their
//   assigned accountKeys.
// - client: can ONLY clone a *template* (source has no accountKey)
//   into one of their assigned accountKeys. This powers the
//   sub-account "Add Template" picker.
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole(
    'developer',
    'super_admin',
    'admin',
    'client',
  );
  if (error) return error;

  const { id } = await context.params;
  // Scope-check the source. For account-scoped roles (admin + client)
  // we restrict getFlow to their accountKeys, but the helper already
  // returns templates (NULL accountKey) regardless of scope — so
  // clients can still resolve a template they want to adopt.
  const isAccountScoped =
    session!.user.role === 'admin' || session!.user.role === 'client';
  const scope = isAccountScoped ? (session!.user.accountKeys ?? []) : null;
  const existing = await getFlow(id, scope);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name : undefined;
  const targetAccountKey =
    typeof body?.accountKey === 'string' && body.accountKey.length > 0
      ? body.accountKey
      : undefined;
  const sourceIsTemplate = !existing.accountKey;

  // Client role can only clone templates, and only into their own
  // assigned accountKeys. This stops a sub-account from cloning
  // another sub-account's flow even if they somehow learned the id.
  if (session!.user.role === 'client') {
    if (!sourceIsTemplate) {
      return NextResponse.json(
        { error: 'Only templates can be added to a sub-account.' },
        { status: 403 },
      );
    }
    if (!targetAccountKey) {
      return NextResponse.json(
        { error: 'accountKey is required for sub-account template adoption.' },
        { status: 400 },
      );
    }
  }

  // admin + client share the same per-account scope check on the
  // destination accountKey.
  if (targetAccountKey && isAccountScoped) {
    const allowed = new Set(session!.user.accountKeys ?? []);
    if (!allowed.has(targetAccountKey)) {
      return NextResponse.json(
        { error: `Not authorised to clone into: ${targetAccountKey}` },
        { status: 403 },
      );
    }
  }

  const flow = await duplicateFlow(id, {
    name,
    createdByUserId: session!.user.id,
    accountKeyOverride: targetAccountKey,
    // Template → instance clone gets lineage + settings inheritance.
    parentTemplateId: sourceIsTemplate && targetAccountKey ? id : undefined,
    preserveSettings: sourceIsTemplate && !!targetAccountKey,
  });
  return NextResponse.json({ flow }, { status: 201 });
}
