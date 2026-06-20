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
  resolvePlaceConfig,
  getPlaceDetails,
} from '@/lib/integrations/google-places';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { ctx, error } = await requireReportingAccess();
  if (error) return error;

  const accountKey = req.nextUrl.searchParams.get('accountKey');
  if (!accountKey) return NextResponse.json({ error: 'Missing accountKey' }, { status: 400 });
  if (!canAccessAccount(ctx.accountKeys, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  try {
    const apiKey = getPlacesApiKey();
    if (!apiKey) {
      throw new PlacesError(
        'Google Places is not configured on the server (set GOOGLE_MAPS_API_KEY).',
        'not_configured',
      );
    }
    const cfg = resolvePlaceConfig(accountKey);
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

    return NextResponse.json({
      accountKey,
      dealer: account?.dealer ?? accountKey,
      place,
      competitor,
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
