import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { loadBlastPreview } from '@/lib/email/blast-preview';
import { clientErrorMessage } from '@/lib/api-errors';

/**
 * GET /api/blasts/loomi/preview?campaignId=xxx → `{ html }`
 *
 * A Loomi email blast's HTML for the Blasts list's Preview modal, merge tags
 * resolved against its account — the same HTML Download Email renders to a
 * PNG (see loadBlastPreview). Works at any status: a draft, a scheduled
 * blast, or one already sent.
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
    return NextResponse.json({ html: preview.html }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json(
      { error: clientErrorMessage(err, 'Failed to load the preview') },
      { status: 500 },
    );
  }
}
