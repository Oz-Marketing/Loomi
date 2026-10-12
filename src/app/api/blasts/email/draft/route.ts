import { NextRequest, NextResponse } from 'next/server';
import { parseBlastAccountKeys } from '@/lib/services/blast-account-keys';
import { requirePermission } from '@/lib/permissions/require';
import { createDraftEmailBlast } from '@/lib/services/email-blasts';

/**
 * POST /api/blasts/email/draft
 *
 * Creates an empty EmailBlast in 'draft' status. The campaign-builder
 * flow PATCHes this row through subsequent steps (recipients, template,
 * schedule). Drafts are ignored by the pg-boss worker.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requirePermission('studio.email.edit');
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name : '';
  const parsedKeys = parseBlastAccountKeys(body?.accountKeys);
  if (!parsedKeys.ok) {
    return NextResponse.json({ error: parsedKeys.error }, { status: 400 });
  }
  const accountKeysInput = parsedKeys.keys;

  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];

  // Admin scoped to a fixed set of accounts can only create campaigns
  // they can actually send for. If they specified accountKeys, validate
  // they're all allowed.
  if (userRole === 'admin' && userAccountKeys.length > 0) {
    const allowed = new Set(userAccountKeys);
    const disallowed = accountKeysInput.find((key) => !allowed.has(key));
    if (disallowed) {
      return NextResponse.json({ error: 'Forbidden account selection' }, { status: 403 });
    }
  }

  try {
    const campaign = await createDraftEmailBlast({
      name,
      accountKeys: accountKeysInput,
      createdByUserId: session!.user.id,
      createdByRole: session!.user.role,
    });
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create campaign draft';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
