/**
 * Business Profile report — GET /api/reporting/gbp
 *
 * Port of Oz Dealer Tools' GBPReport. Live pull from the Business Profile
 * Performance API — no metrics DB, same as the other platform reports.
 *
 * Unlike them, the credential is PER ACCOUNT (see lib/integrations/gbp.ts), so
 * this route can fail in ways the agency-credential reports cannot: not
 * connected, connected but no location picked, or a grant that has been revoked
 * at Google. Each returns a distinct `code` so the UI can offer the right next
 * step instead of a generic error.
 *
 * Reading is client-visible. CONNECTING IS NOT — that lives on the sibling
 * routes behind MANAGEMENT_ROLES.
 *
 * Query params:
 *   accountKey  — the sub-account to report on (required; scoped per caller)
 *   start_date  — YYYY-MM-DD, defaults to 30 days ago
 *   end_date    — YYYY-MM-DD, defaults to today
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../_lib/guard';
import { canAccessAccount } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  GbpError,
  getGbpConfig,
  fetchDailyMetrics,
  fetchSearchKeywords,
  parseMetrics,
} from '@/lib/integrations/gbp';
import { getConnectionStatus, withAccessToken } from '@/lib/integrations/gbp-connection';

export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fail(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(req: NextRequest) {
  const { ctx, error } = await requireReportingAccess({ report: 'business_profile', req: req });
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const accountKey = sp.get('accountKey');
  if (!accountKey) return NextResponse.json({ error: 'Missing accountKey' }, { status: 400 });
  if (!canAccessAccount(ctx.accountKeys, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const today = new Date();
  const thirtyAgo = new Date(today);
  thirtyAgo.setDate(thirtyAgo.getDate() - 30);

  const startDate = sp.get('start_date') || iso(thirtyAgo);
  const endDate = sp.get('end_date') || iso(today);
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
    return NextResponse.json({ error: 'start_date / end_date must be YYYY-MM-DD' }, { status: 400 });
  }
  if (startDate > endDate) {
    return NextResponse.json({ error: 'start_date must not be after end_date' }, { status: 400 });
  }

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true, dealer: true },
  });
  if (!account) return NextResponse.json({ error: 'Unknown account' }, { status: 404 });

  if (!getGbpConfig()) {
    return fail(
      'Google Business Profile is not configured on the server yet.',
      'not_configured',
      503,
    );
  }

  const status = await getConnectionStatus(accountKey);
  if (!status.connected) {
    return fail('This account is not connected to Google Business Profile.', 'not_connected', 409);
  }
  if (!status.locationId) {
    return fail('No Business Profile location has been chosen yet.', 'no_location', 409);
  }

  try {
    const result = await withAccessToken(accountKey, async (accessToken) => {
      const raw = await fetchDailyMetrics(accessToken, status.locationId!, startDate, endDate);
      const parsed = parseMetrics(raw);

      // Keywords are monthly-only and unavailable for some locations, so a
      // failure here must not take the whole report down — it is a section,
      // not the report. Same call ODT makes, same tolerance.
      const kwMonth = new Date(`${endDate}T00:00:00Z`);
      let keywords: Awaited<ReturnType<typeof fetchSearchKeywords>> = [];
      let keywordsError: string | null = null;
      try {
        keywords = await fetchSearchKeywords(
          accessToken,
          status.locationId!,
          kwMonth.getUTCFullYear(),
          kwMonth.getUTCMonth() + 1,
        );
      } catch (err) {
        keywordsError = err instanceof Error ? err.message : 'Unavailable';
      }

      return {
        ...parsed,
        keywords,
        keywordsError,
        keywordsMonth: `${kwMonth.getUTCFullYear()}-${String(kwMonth.getUTCMonth() + 1).padStart(2, '0')}`,
      };
    });

    return NextResponse.json({
      dealer: account.dealer,
      startDate,
      endDate,
      location: {
        id: status.locationId,
        name: status.locationName,
        address: status.locationAddress,
      },
      ...result,
    });
  } catch (err) {
    if (err instanceof GbpError) {
      return fail(err.message, err.code, err.code === 'auth_expired' ? 409 : 502);
    }
    console.error('[reporting/gbp]', err);
    return NextResponse.json({ error: 'Failed to load Business Profile' }, { status: 500 });
  }
}
