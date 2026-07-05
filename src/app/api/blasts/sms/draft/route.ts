import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { createDraftSmsBlast } from '@/lib/services/sms-blasts';

/**
 * POST /api/blasts/sms/draft
 *
 * Creates an empty SmsBlast in 'draft' status. The campaign-builder
 * flow PATCHes this row through subsequent steps. The pg-boss worker
 * ignores drafts.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name : '';
  const accountKeysInput = Array.isArray(body?.accountKeys)
    ? (body.accountKeys as unknown[]).filter(
        (k): k is string => typeof k === 'string' && k.length > 0,
      )
    : [];

  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  if (userRole === 'admin' && userAccountKeys.length > 0 && accountKeysInput.length > 0) {
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
    const message = err instanceof Error ? err.message : 'Failed to create SMS draft';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
