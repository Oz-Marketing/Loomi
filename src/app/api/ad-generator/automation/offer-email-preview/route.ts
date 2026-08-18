import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { canAccessAccount, forbidden, getAccountScope } from '@/lib/api-auth';
import { previewOfferEmail } from '@/lib/ad-generator/automation/preview-offer-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Render the companion offer email for review, without creating one.
 *
 * The shell and offer cap come from the QUERY, not the saved config, so the
 * settings form can preview an edit before committing it.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requirePermission('studio.adgen.view');
  if (error) return error;

  const accountKey = req.nextUrl.searchParams.get('accountKey');
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }
  if (!canAccessAccount(getAccountScope(session!), accountKey)) return forbidden();

  try {
    const preview = await previewOfferEmail(accountKey, {
      emailMaxOffers: Number(req.nextUrl.searchParams.get('maxOffers')) || 6,
    });
    if (!preview) return NextResponse.json({ error: 'Sub-account not found' }, { status: 404 });
    return NextResponse.json(preview);
  } catch (err) {
    console.error('[api/ad-generator/automation/offer-email-preview] GET failed:', err);
    return NextResponse.json({ error: 'Could not render the preview' }, { status: 500 });
  }
}
