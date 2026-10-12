import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import {
  getCampaignEngagement,
  getEngagementReport,
  type EngagementSource,
} from '@/lib/services/email-analytics';
import { clientErrorMessage } from '@/lib/api-errors';

/**
 * GET /api/blasts/loomi/engagement?accountKey=&start=&end=&source=&only=
 *
 * Returns aggregated engagement metrics for the requested account
 * over the given date range:
 *   - totals: KPIs across all campaigns in range
 *   - series: per-day time series for charting
 *   - topUrls: most-clicked URLs
 *   - campaigns: per-campaign table rows
 *
 * `totals` and `campaigns` come from one aggregate over the same recipients,
 * so the rows add up to the totals. `source` picks which sends count —
 * `blasts`, `flows`, or `all` (the default). The default stays `all` because
 * the Blasts list reads its per-row numbers from here for both its blasts view
 * and its "From flows" view; a caller that wants one-off blasts only passes
 * `source=blasts`, and gets totals AND rows without flow sends. See
 * lib/services/email-analytics.ts for what each number means.
 *
 * `only=campaigns` returns just `campaigns`. It is for the Blasts list, which
 * reads nothing else: with no range, the full response aggregates the
 * account's entire send history for totals, a chart and a link list nobody
 * looks at, where this aggregates only the list's own page of campaigns.
 *
 * Auth + visibility scoping mirrors the loomi list endpoint: clients
 * are constrained to their assigned account keys; admins to their
 * assigned set (when scoped). Developers + super_admins see everything.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const accountKey = req.nextUrl.searchParams.get('accountKey');
  const startParam = req.nextUrl.searchParams.get('start');
  const endParam = req.nextUrl.searchParams.get('end');
  const role = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];

  // Role-based account scoping.
  let visibilityScope: string[] | null = null;
  if (accountKey) {
    if (role === 'client' && !userAccountKeys.includes(accountKey)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (role === 'admin' && userAccountKeys.length > 0 && !userAccountKeys.includes(accountKey)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    visibilityScope = [accountKey];
  } else if (role === 'client' || (role === 'admin' && userAccountKeys.length > 0)) {
    // A client with no assigned accounts lands here with []. The service
    // reads an empty scope as "no accounts", never as "every account".
    visibilityScope = userAccountKeys;
  }

  const start = parseDate(startParam);
  const end = parseDate(endParam);
  const source = parseSource(req.nextUrl.searchParams.get('source'));
  const input = { accountKeys: visibilityScope, start, end, source };

  try {
    if (req.nextUrl.searchParams.get('only') === 'campaigns') {
      return NextResponse.json({ campaigns: await getCampaignEngagement(input) });
    }
    const report = await getEngagementReport(input);
    return NextResponse.json({
      totals: report.totals,
      series: report.series,
      topUrls: report.topUrls,
      campaigns: report.campaigns,
    });
  } catch (err) {
    // Aggregations are best-effort — if the DB shape has shifted or a
    // query is malformed, surface a 500 with the error message so the
    // UI can show something more useful than a generic 'HTTP 500'.
    const message = clientErrorMessage(err, 'Failed to load engagement metrics');
    console.error('[campaigns:engagement] aggregation failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseSource(value: string | null): EngagementSource {
  return value === 'blasts' || value === 'flows' ? value : 'all';
}
