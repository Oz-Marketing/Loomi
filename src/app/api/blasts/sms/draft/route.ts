import { NextRequest, NextResponse } from 'next/server';
import { parseBlastAccountKeys } from '@/lib/services/blast-account-keys';
import { requirePermission } from '@/lib/permissions/require';
import { createDraftSmsBlast } from '@/lib/services/sms-blasts';
import { clientErrorMessage } from '@/lib/api-errors';

/**
 * POST /api/blasts/sms/draft
 *
 * Creates an empty SmsBlast in 'draft' status. The campaign-builder
 * flow PATCHes this row through subsequent steps. The pg-boss worker
 * ignores drafts.
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
  if (userRole === 'admin' && userAccountKeys.length > 0) {
    const allowed = new Set(userAccountKeys);
    const disallowed = accountKeysInput.find((k) => !allowed.has(k));
    if (disallowed) {
      return NextResponse.json({ error: 'Forbidden account selection' }, { status: 403 });
    }
  }

  try {
    const campaign = await createDraftSmsBlast({
      name,
      accountKeys: accountKeysInput,
      createdByUserId: session!.user.id,
      createdByRole: session!.user.role,
    });
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (err) {
    const message = clientErrorMessage(err, 'Failed to create SMS draft');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
