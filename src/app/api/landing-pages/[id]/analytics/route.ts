/**
 * Analytics summary for one landing page.
 *
 * Same auth shape as the other LP routes — admin/dev/super only, with
 * an account-scope check via `getLandingPage` so subaccount-restricted
 * admins can't peek at someone else's LP. Returns aggregated event
 * totals, daily series, scroll funnel, top sources/referrers/CTAs,
 * and the latest LP-attributed submissions.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import { getLandingPage } from '@/lib/services/landing-pages';
import {
  getLandingPageAnalytics,
  type AnalyticsRange,
} from '@/lib/services/lp-analytics';

const ALLOWED_RANGES: AnalyticsRange[] = ['7d', '28d', '90d'];

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requirePermission('studio.landing_pages.view');
  if (error) return error;

  const { id } = await context.params;
  const accountKeys = getAccountScope(session!);

  // Ownership + existence check. Returns null when the LP doesn't
  // exist OR when the caller's scope doesn't include this page's
  // account — collapse both into a 404 so missing/forbidden look
  // identical from the outside.
  const page = await getLandingPage(id, accountKeys);
  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rawRange = req.nextUrl.searchParams.get('range') ?? '28d';
  const range: AnalyticsRange = (ALLOWED_RANGES as string[]).includes(rawRange)
    ? (rawRange as AnalyticsRange)
    : '28d';

  const analytics = await getLandingPageAnalytics(page.id, range);
  return NextResponse.json({ analytics });
}
