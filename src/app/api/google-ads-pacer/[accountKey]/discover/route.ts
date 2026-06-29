import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { canAccessPacer, isValidPeriod } from '@/lib/meta-ads-pacer';
import { GoogleAdsError, discoverGoogleCampaigns } from '@/lib/integrations/google-ads-pacer';

/** yyyy-MM-dd in server-local time. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * §8 — lists every non-removed Google campaign for this account, enriched with
 * budget + period spend, for the "Import campaigns" modal. Campaigns already
 * linked to a pacer row in this period are flagged (`alreadyLinked`) so they're
 * never double-imported. Read-only. Mirrors the Meta discover route.
 */
export async function GET(
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
    const result = await discoverGoogleCampaigns(accountKey, period, todayIso());
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof GoogleAdsError) {
      // Never 5xx — the gateway swaps 5xx bodies for HTML, hiding the real
      // message. 422 passes the JSON through; log for prod too.
      // eslint-disable-next-line no-console
      console.error('[google-ads-pacer] discover Google API error:', err.code, err.message);
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    }
    // eslint-disable-next-line no-console
    console.error('[google-ads-pacer] discover failed', err);
    return NextResponse.json({ error: 'Failed to load campaigns' }, { status: 500 });
  }
}
