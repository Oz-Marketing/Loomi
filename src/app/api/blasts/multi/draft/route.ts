import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import {
  createDraftEmailBlast,
  updateEmailBlastDraft,
} from '@/lib/services/email-blasts';
import {
  createDraftSmsBlast,
  updateSmsBlastDraft,
} from '@/lib/services/sms-blasts';

/**
 * POST /api/blasts/multi/draft
 *
 * Creates a linked pair of campaign drafts (one EmailBlast + one
 * SmsBlast) for a multi-channel send. They share an audience and
 * a send time but otherwise carry their own content.
 *
 * Linkage is via metadata.linkedEmailBlastId / linkedSmsBlastId
 * on each side. The builder URL uses the EmailBlast id as the
 * canonical group id.
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
    const emailDraft = await createDraftEmailBlast({
      name,
      accountKeys: accountKeysInput,
      createdByUserId: session!.user.id,
      createdByRole: session!.user.role,
    });
    const smsDraft = await createDraftSmsBlast({
      name,
      accountKeys: accountKeysInput,
      createdByUserId: session!.user.id,
      createdByRole: session!.user.role,
    });

    // Cross-link the two drafts via metadata so subsequent steps can
    // find the partner campaign without an extra DB lookup.
    const emailMeta = JSON.stringify({
      multiChannel: true,
      linkedSmsBlastId: smsDraft.id,
    });
    const smsMeta = JSON.stringify({
      channel: 'SMS',
      mediaUrls: [],
      sourceMetadata: '',
      multiChannel: true,
      linkedEmailBlastId: emailDraft.id,
    });

    const [linkedEmail, linkedSms] = await Promise.all([
      updateEmailBlastDraft(emailDraft.id, { metadata: emailMeta }),
      updateSmsBlastDraft(smsDraft.id, { metadata: smsMeta }),
    ]);

    return NextResponse.json(
      {
        groupId: linkedEmail.id,
        emailCampaign: linkedEmail,
        smsCampaign: linkedSms,
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create multi-channel draft';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
