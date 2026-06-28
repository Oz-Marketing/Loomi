import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { canAccessPacer, isValidPeriod } from '@/lib/meta-ads-pacer';
import { GoogleAdsError, previewGoogleImport } from '@/lib/integrations/google-ads-pacer';

/**
 * §8 — preview the Google campaign auto-import: returns adds / removes / changes
 * vs the account's existing Google cards for the user to confirm. Read-only — it
 * never creates or overwrites cards (a renamed/paused campaign can't wipe planner
 * work). Gated by getGoogleCustomer (400 when Google isn't connected / no customer).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ accountKey: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { accountKey } = await params;
  if (!canAccessPacer(session, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const period = req.nextUrl.searchParams.get('period');
  if (!period || !isValidPeriod(period)) {
    return NextResponse.json(
      { error: 'Missing or invalid period (expected YYYY-MM)' },
      { status: 400 },
    );
  }

  try {
    const preview = await previewGoogleImport(accountKey, period);
    return NextResponse.json({ accountKey, period, ...preview });
  } catch (err) {
    if (err instanceof GoogleAdsError) {
      // Never 5xx — the gateway swaps 5xx bodies for HTML, hiding the real
      // Google message. 422 passes the JSON through; log it for prod too.
      // eslint-disable-next-line no-console
      console.error('[google-ads-pacer] import Google API error:', err.code, err.message);
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    }
    // eslint-disable-next-line no-console
    console.error('[google-ads-pacer] import preview failed', err);
    return NextResponse.json({ error: 'Import preview failed' }, { status: 500 });
  }
}
