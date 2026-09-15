import { NextRequest, NextResponse } from 'next/server';
import { canAccessAccount, getAccountScope, requireAuth } from '@/lib/api-auth';
import { getEmailBlast } from '@/lib/services/email-blasts';
import { renderCampaignScreenshotFromHtml } from '@/lib/email/screenshot';
import {
  loadPreviewAccountData,
  resolvePreviewTokens,
} from '@/lib/email/preview-substitute';

/**
 * GET /api/blasts/loomi/screenshot?campaignId=xxx
 *
 * Render a PNG of a Loomi-native email campaign's stored htmlContent.
 * SMS campaigns have no HTML body, so this route only services email.
 * Used by the campaigns-list bulk-actions dock (Download PNG).
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const campaignId = req.nextUrl.searchParams.get('campaignId');
  if (!campaignId) {
    return NextResponse.json({ error: 'campaignId is required' }, { status: 400 });
  }

  const campaign = await getEmailBlast(campaignId);
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  // Clients can only screenshot campaigns scoped to one of their accounts.
  if (session!.user.role === 'client') {
    const allowed = new Set(session!.user.accountKeys ?? []);
    const visible =
      campaign.accountKeys.length === 0 ||
      campaign.accountKeys.some((key) => allowed.has(key));
    if (!visible) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
  }

  if (!campaign.htmlContent.trim()) {
    return NextResponse.json(
      { error: 'Campaign has no rendered HTML to screenshot.' },
      { status: 422 },
    );
  }

  try {
    // The stored htmlContent still carries its mergetags — substitution is a
    // per-recipient step that happens inside the send loop. One PNG can't be
    // per-recipient, so it resolves against the campaign's account the same
    // way the on-screen preview does. A campaign spanning several accounts
    // renders as the first one the viewer is scoped to see.
    const scope = getAccountScope(session!);
    const accountKey =
      campaign.accountKeys.find((key) => canAccessAccount(scope, key)) ??
      campaign.accountKeys[0];
    const accountData = accountKey ? await loadPreviewAccountData(accountKey) : null;

    const screenshot = await renderCampaignScreenshotFromHtml({
      html: resolvePreviewTokens(campaign.htmlContent, accountData),
      filename: `${campaign.name || 'campaign'}.png`,
    });

    return new NextResponse(screenshot.image as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': screenshot.contentType,
        'Content-Disposition': `attachment; filename="${screenshot.filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to render screenshot';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
