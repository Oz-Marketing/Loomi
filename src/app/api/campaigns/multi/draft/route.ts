import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import {
  createDraftEmailCampaign,
  updateEmailCampaignDraft,
} from '@/lib/services/email-campaigns';
import {
  createDraftSmsCampaign,
  updateSmsCampaignDraft,
} from '@/lib/services/sms-campaigns';

/**
 * POST /api/campaigns/multi/draft
 *
 * Creates a linked pair of campaign drafts (one EmailCampaign + one
 * SmsCampaign) for a multi-channel send. They share an audience and
 * a send time but otherwise carry their own content.
 *
 * Linkage is via metadata.linkedEmailCampaignId / linkedSmsCampaignId
 * on each side. The builder URL uses the EmailCampaign id as the
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
    const emailDraft = await createDraftEmailCampaign({
      name,
      accountKeys: accountKeysInput,
      createdByUserId: session!.user.id,
      createdByRole: session!.user.role,
    });
    const smsDraft = await createDraftSmsCampaign({
      name,
      accountKeys: accountKeysInput,
      createdByUserId: session!.user.id,
      createdByRole: session!.user.role,
    });

    // Cross-link the two drafts via metadata so subsequent steps can
    // find the partner campaign without an extra DB lookup.
    const emailMeta = JSON.stringify({
      multiChannel: true,
      linkedSmsCampaignId: smsDraft.id,
    });
    const smsMeta = JSON.stringify({
      channel: 'SMS',
      mediaUrls: [],
      sourceMetadata: '',
      multiChannel: true,
      linkedEmailCampaignId: emailDraft.id,
    });

    const [linkedEmail, linkedSms] = await Promise.all([
      updateEmailCampaignDraft(emailDraft.id, { metadata: emailMeta }),
      updateSmsCampaignDraft(smsDraft.id, { metadata: smsMeta }),
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
