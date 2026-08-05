import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as budget from '@/lib/services/budget';

/**
 * POST /api/budget/settle-period
 *   { accountKey, period, platform, force? }
 *
 * Settle a whole account/period/platform from the pacer's synced spend, on
 * demand. The daily scan does this automatically once a month closes; this is
 * the "don't make me wait for the cron" path, and the only way to settle a
 * month early (via `force`).
 *
 * `accountKey` here is the SPEND account — the pacer plan's account, which for
 * a co-op line is the rooftop the money spends out of, not the one billed.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const accountKey = typeof body.accountKey === 'string' ? body.accountKey : '';
  const period = typeof body.period === 'string' ? body.period : '';
  const platform = body.platform === 'google' ? 'google' : 'meta';

  if (!accountKey || !budget.isValidPeriod(period)) {
    return NextResponse.json(
      { error: 'accountKey and a valid period (YYYY-MM) are required' },
      { status: 400 },
    );
  }
  if (!budget.canAccess(getAccountScope(session!), accountKey)) return forbidden();

  try {
    const result = await budget.settlePlatformPeriod(
      accountKey,
      period,
      platform,
      session!.user.id,
      { force: body.force === true },
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to settle the period' },
      { status: 400 },
    );
  }
}
