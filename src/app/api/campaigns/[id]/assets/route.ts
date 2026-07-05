import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, canAccessAccount } from '@/lib/api-auth';
import {
  createCampaignEmailTemplate,
  getCampaignRow,
  linkAssetToCampaign,
} from '@/lib/services/campaigns';
import {
  createDraftEmailBlast,
  updateEmailBlastDraft,
} from '@/lib/services/email-blasts';
import {
  createDraftSmsBlast,
  updateSmsBlastDraft,
} from '@/lib/services/sms-blasts';
import { SMS_MAX_CHARS } from '@/lib/campaigns/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Minimal, email-safe HTML shell for a manually-authored email draft. */
function wrapManualEmailHtml(subject: string, bodyText: string): string {
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1a1a1a;">${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`,
    )
    .join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;"><tr><td align="center" style="padding:24px;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;"><tr><td style="padding:40px;">${paragraphs || '<p style="margin:0;color:#9a9a9a;">Add your content…</p>'}</td></tr></table></td></tr></table></body></html>`;
}

/**
 * POST /api/campaigns/[id]/assets
 *
 * Manual-wizard helper: create a channel draft (email or SMS), populate it with
 * the wizard's quick-form content, and attach it to the campaign container. The
 * draft stays in 'draft' status — the user finishes targeting/sending in the
 * existing per-channel editor.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await params;
  const campaign = await getCampaignRow(id);
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  if (!campaign.accountKey) {
    return NextResponse.json({ error: 'Campaign has no account' }, { status: 400 });
  }

  const scope = getAccountScope(session!);
  if (!canAccessAccount(scope, campaign.accountKey)) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const kind = body?.kind;
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : undefined;
  const accountKeys = [campaign.accountKey];
  const metadata = JSON.stringify({ campaignSource: 'manual' });

  try {
    if (kind === 'email') {
      const subject = typeof body?.subject === 'string' ? body.subject.trim() : '';
      const previewText = typeof body?.previewText === 'string' ? body.previewText.trim() : '';
      const bodyText = typeof body?.bodyText === 'string' ? body.bodyText : '';
      const html = wrapManualEmailHtml(subject, bodyText);
      // Back the email with a real Template so it previews + opens in the
      // editor (the template step keys off metadata.templateSlug).
      const templateSlug = await createCampaignEmailTemplate({
        accountKey: accountKeys[0],
        title: name ?? subject ?? 'Email',
        previewText,
        content: html,
        createdByUserId: session!.user.id,
      });
      const draft = await createDraftEmailBlast({
        name: name ?? subject,
        accountKeys,
        createdByUserId: session!.user.id,
        createdByRole: session!.user.role,
      });
      await updateEmailBlastDraft(draft.id, {
        subject,
        previewText: previewText || null,
        htmlContent: html,
        textContent: bodyText || null,
        sourceType: 'template-library',
        metadata: JSON.stringify({ campaignSource: 'manual', templateSlug }),
      });
      await linkAssetToCampaign('email', draft.id, id);
      return NextResponse.json({ asset: { id: draft.id, kind: 'email', name: name ?? subject } }, { status: 201 });
    }

    if (kind === 'sms') {
      const message = (typeof body?.message === 'string' ? body.message : '').trim().slice(0, SMS_MAX_CHARS);
      const draft = await createDraftSmsBlast({
        name,
        accountKeys,
        createdByUserId: session!.user.id,
        createdByRole: session!.user.role,
      });
      await updateSmsBlastDraft(draft.id, { message, metadata });
      await linkAssetToCampaign('sms', draft.id, id);
      return NextResponse.json({ asset: { id: draft.id, kind: 'sms', name: name ?? 'SMS' } }, { status: 201 });
    }

    return NextResponse.json({ error: 'Unsupported asset kind' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create asset';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
