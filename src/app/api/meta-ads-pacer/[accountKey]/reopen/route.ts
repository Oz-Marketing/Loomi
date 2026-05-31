import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import {
  canAccessPacer,
  getOrCreatePlan,
  getPeriodPlanView,
  isValidPeriod,
  reopenMonth,
} from '@/lib/meta-ads-pacer';
import { writeAudit } from '@/lib/meta-ads-audit';

/**
 * Admin reopen of a frozen (closed) month so it can be corrected. Preserves
 * the original frozen snapshot as the historical record; the live rows are
 * served editable until the month is re-frozen. Returns the refreshed view.
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
  await reopenMonth(plan.id, period, userId);
  await writeAudit([
    { accountKey, planId: plan.id, period, action: 'reopen', authorUserId: userId, summary: `Month ${period} reopened for editing` },
  ]);
  const view = await getPeriodPlanView(accountKey, period, userId);
  return NextResponse.json({ accountKey, period, ...view });
}
