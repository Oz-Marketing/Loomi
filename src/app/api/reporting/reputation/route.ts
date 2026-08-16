/**
 * Reputation report — GET /api/reporting/reputation
 *
 * Port of Oz Dealer Tools' ReputationReport (live-rating half). Resolves the
 * active account → its Google place id → returns live rating, review count,
 * status, and recent reviews; plus the same for a configured competitor. No
 * metrics DB — Google Places is the source of truth.
 *
 * Full review history/trends (every review over time, reply rates) come from
 * ODT's `ozrep` reviews pipeline and land with the dealer-DB import.
 *
 * Query params:
 *   accountKey — the sub-account to report on (required; scoped per caller)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../_lib/guard';
import { canAccessAccount } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  PlacesError,
  getPlacesApiKey,
  getPlaceDetails,
} from '@/lib/integrations/google-places';
import { resolvePlaceConfig } from '@/lib/integrations/account-mapping';
import { getReviewHistory, getHistoryCoverage } from '@/lib/reporting/review-history';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { ctx, error } = await requireReportingAccess({ report: 'reputation', req: req });
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const accountKey = sp.get('accountKey');
  if (!accountKey) return NextResponse.json({ error: 'Missing accountKey' }, { status: 400 });
  if (!canAccessAccount(ctx.accountKeys, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  // Dates scope the HISTORY only; the live Places rating has no range — it is
  // whatever the listing says right now. Defaults to the trailing year, which
  // is the window the trend chart draws anyway.
  const today = new Date();
  const yearAgo = new Date(today);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const startDate = sp.get('start_date') || iso(yearAgo);
  const endDate = sp.get('end_date') || iso(today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return NextResponse.json({ error: 'start_date / end_date must be YYYY-MM-DD' }, { status: 400 });
  }

  try {
    const apiKey = getPlacesApiKey();
    if (!apiKey) {
      throw new PlacesError(
        'Google Places is not configured on the server (set GOOGLE_MAPS_API_KEY).',
        'not_configured',
      );
    }
    const cfg = await resolvePlaceConfig(accountKey);
    if (!cfg) {
      throw new PlacesError('No Google place is mapped to this account yet.', 'no_place');
    }

    const account = await prisma.account.findUnique({
      where: { key: accountKey },
      select: { dealer: true },
    });

    // Primary place is fatal; the competitor is best-effort.
    const place = await getPlaceDetails(apiKey, cfg.placeId);
    const competitor = cfg.competitorPlaceId
      ? await getPlaceDetails(apiKey, cfg.competitorPlaceId).catch(() => null)
      : null;

    // History comes from ReviewEvent, not Places — Places has no concept of
    // "reviews in March", no distribution over a range, and no reply status.
    // It is best-effort for the same reason the competitor is: the live rating
    // is the headline, and an account that hasn't been swept yet should still
    // get its current rating rather than an error page.
    const [history, coverage] = await Promise.all([
      getReviewHistory(accountKey, startDate, endDate).catch(() => null),
      getHistoryCoverage(accountKey).catch(() => null),
    ]);

    return NextResponse.json({
      accountKey,
      dealer: account?.dealer ?? accountKey,
      startDate,
      endDate,
      place,
      competitor,
      history,
      coverage,
    });
  } catch (err) {
    if (err instanceof PlacesError) {
      const status = err.code === 'api_error' ? 502 : err.code === 'not_configured' ? 503 : 404;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    // eslint-disable-next-line no-console
    console.error('[reporting/reputation] failed', err);
    return NextResponse.json({ error: 'Report failed' }, { status: 500 });
  }
}
