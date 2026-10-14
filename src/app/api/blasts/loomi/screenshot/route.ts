import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { renderCampaignScreenshotFromHtml } from '@/lib/email/screenshot';
import { loadBlastPreview } from '@/lib/email/blast-preview';
import { clientErrorMessage } from '@/lib/api-errors';

/**
 * GET /api/blasts/loomi/screenshot?campaignId=xxx
 *
 * Render a PNG of a Loomi-native email campaign's stored htmlContent, merge
 * tags resolved against its account (see loadBlastPreview). SMS campaigns
 * have no HTML body, so this route only services email. Used by the Blasts
 * list's Download Email and the bulk-actions dock.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const campaignId = req.nextUrl.searchParams.get('campaignId');
  if (!campaignId) {
    return NextResponse.json({ error: 'campaignId is required' }, { status: 400 });
  }

  try {
    const preview = await loadBlastPreview(session!, campaignId);
    if (!preview.ok) {
      return NextResponse.json({ error: preview.error }, { status: preview.status });
    }

    const screenshot = await renderCampaignScreenshotFromHtml({
      html: preview.html,
      filename: `${preview.name}.png`,
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
    const message = clientErrorMessage(err, 'Failed to render screenshot');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
