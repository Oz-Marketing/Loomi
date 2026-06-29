import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import {
  canAccessPacer,
  getOrCreatePlan,
  getPeriodPlanView,
  getPriorOverUnder,
  isPeriodWritable,
  isValidPeriod,
  reconcileCompletedRuns,
} from '@/lib/meta-ads-pacer';
import { GoogleAdsError, syncPeriodFromGoogle } from '@/lib/integrations/google-ads-pacer';
import { writeAudit } from '@/lib/meta-ads-audit';

/** yyyy-MM-dd in server-local time. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * §8 — pull spend (metrics.cost_micros) + campaign status/dates/budget from
 * Google Ads onto this account's LINKED Google pacer lines, then return the
 * refreshed plan. Mirrors the Meta sync route; gated by getGoogleCustomer
 * (404-equivalent 400s when Google isn't connected or no customer is linked).
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

  const plan = await getOrCreatePlan(accountKey);
  if (!(await isPeriodWritable(accountKey, plan.id, period))) {
    return NextResponse.json(
      { error: 'This month is frozen. Reopen it to re-sync.', code: 'month_frozen' },
      { status: 409 },
    );
  }

  try {
    const sync = await syncPeriodFromGoogle(accountKey, period, todayIso());
    const userId = session.user?.id ?? null;
    if (sync.matched > 0) {
      await writeAudit([
        {
          accountKey,
          planId: plan.id,
          period,
          platform: 'google',
          action: 'sync',
          authorUserId: userId,
          summary: `Synced from Google: ${sync.matched} of ${sync.total} campaign${sync.total === 1 ? '' : 's'} updated`,
        },
      ]);
    }
    await reconcileCompletedRuns(accountKey, plan.id, period, userId);
    const view = await getPeriodPlanView(accountKey, period, userId, 'google');
    const priorOverUnder = view.frozen
      ? null
      : await getPriorOverUnder(accountKey, period, userId);
    return NextResponse.json({ accountKey, period, sync, ...view, priorOverUnder });
  } catch (err) {
    if (err instanceof GoogleAdsError) {
      // NEVER 5xx here: nginx/Cloudflare intercept 5xx responses and swap the
      // JSON body for an HTML error page, so the real Google message would be
      // lost (client sees "Unexpected token '<'"). Return 422 so the body passes
      // through, and log it so prod has the message too.
      // eslint-disable-next-line no-console
      console.error('[google-ads-pacer] sync-google Google API error:', err.code, err.message);
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    }
    // eslint-disable-next-line no-console
    console.error('[google-ads-pacer] sync-google failed', err);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
