import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import {
  canAccessPacer,
  freezeMonth,
  getOrCreatePlan,
  getPeriodPlanView,
  isValidPeriod,
} from '@/lib/meta-ads-pacer';
import { writeAudit } from '@/lib/meta-ads-audit';

/**
 * Re-freeze a month after a reopen (or freeze one early): re-snapshots the
 * current data and clears the reopen flag. Returns the refreshed view.
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
  const userId = session.user?.id ?? null;
  await freezeMonth(plan.id, period, userId);
  await writeAudit([
    { accountKey, planId: plan.id, period, action: 'freeze', authorUserId: userId, summary: `Month ${period} frozen` },
  ]);
  const view = await getPeriodPlanView(accountKey, period, userId);
  return NextResponse.json({ accountKey, period, ...view });
}
