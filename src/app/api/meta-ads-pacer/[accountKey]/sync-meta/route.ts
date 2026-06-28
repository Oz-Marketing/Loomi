import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import {
  accountTimeZone,
  canAccessPacer,
  getOrCreatePlan,
  getPeriodPlanView,
  getPriorOverUnder,
  isPeriodWritable,
  isValidPeriod,
  reconcileCompletedRuns,
} from '@/lib/meta-ads-pacer';
import { MetaSyncError, syncPeriodFromMeta } from '@/lib/integrations/meta-ads';
import { writeAudit } from '@/lib/meta-ads-audit';
import { zonedTodayIso } from '@/lib/timezone';

/**
 * Pull spend (and any available budget/status) from Facebook onto this
 * account's pacer ads for the given period, then return the refreshed plan
 * so the client can drop it straight into state.
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
  // Don't re-pull spend into a frozen month — its figures are settled.
  if (!(await isPeriodWritable(accountKey, plan.id, period))) {
    return NextResponse.json(
      { error: 'This month is frozen. Reopen it to re-sync.', code: 'month_frozen' },
      { status: 409 },
    );
  }

  // Automatic background refresh (stale-while-revalidate on pacer load) passes
  // ?auto=1. Same sync, but we skip the audit entry so the change log only
  // records deliberate manual syncs — not one line per page view.
  const auto = req.nextUrl.searchParams.get('auto') === '1';

  try {
    // "Today" in the account's pacing timezone (Meta zone → stored zone →
    // default), matching the auto-refresh/alerts path — not the server's local
    // clock, which on a UTC host drifts a day from the account near midnight.
    const todayIso = zonedTodayIso(Date.now(), await accountTimeZone(accountKey));
    const sync = await syncPeriodFromMeta(accountKey, period, todayIso);
    const userId = session.user?.id ?? null;
    // One grouped audit entry per sync (per the team decision) — captures that
    // spend refreshed without flooding the log with per-ad spend deltas.
    if (!auto && sync.matched > 0) {
      await writeAudit([
        {
          accountKey,
          planId: plan.id,
          period,
          action: 'sync',
          authorUserId: userId,
          summary: `Synced from Meta: ${sync.matched} of ${sync.total} ad${sync.total === 1 ? '' : 's'} updated`,
        },
      ]);
    }
    // After refreshing Meta status/spend, auto-complete any ad past its
    // flight end (Change 11).
    await reconcileCompletedRuns(accountKey, plan.id, period, userId);
    const view = await getPeriodPlanView(accountKey, period, userId, 'meta');
    const priorOverUnder = view.frozen
      ? null
      : await getPriorOverUnder(accountKey, period, userId);
    return NextResponse.json({ accountKey, period, sync, ...view, priorOverUnder });
  } catch (err) {
    if (err instanceof MetaSyncError) {
      // Config / linking problems are the caller's to fix (400); upstream
      // Graph failures are surfaced as a bad gateway.
      const status = err.code === 'graph_error' ? 502 : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    // eslint-disable-next-line no-console
    console.error('[meta-ads-pacer] sync-meta failed', err);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
