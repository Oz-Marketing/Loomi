import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import {
  canAccessPacer,
  getOrCreatePlan,
  getPeriodPlanView,
  getPriorOverUnder,
  isPeriodWritable,
  isValidPeriod,
  setCarryover,
} from '@/lib/meta-ads-pacer';
import { writeAudit } from '@/lib/meta-ads-audit';

interface Body {
  bucket?: 'base' | 'added';
  clear?: boolean;
}

/**
 * Apply (or clear) the prior month's over/under as a carryover into this
 * month's chosen bucket (Change 7). The amount is recomputed server-side from
 * the settled prior month, so the client only chooses the bucket. Returns the
 * refreshed plan view + the prior over/under so the UI can re-render.
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

  const body = (await req.json().catch(() => ({}))) as Body;
  const bucket = body.bucket === 'added' ? 'added' : 'base';
  const clear = body.clear === true;

  const plan = await getOrCreatePlan(accountKey);

  // Carryover lands on THIS (live) month; a frozen month can't take one.
  if (!(await isPeriodWritable(accountKey, plan.id, period))) {
    return NextResponse.json(
      { error: 'This month is frozen. Reopen it to change carryover.', code: 'month_frozen' },
      { status: 409 },
    );
  }

  const userId = session.user?.id ?? null;
  try {
    const { applied } = await setCarryover(accountKey, plan.id, period, bucket, clear, userId);
    const bucketLabel = bucket === 'base' ? 'Base' : 'Added';
    await writeAudit([
      {
        accountKey,
        planId: plan.id,
        period,
        action: 'carryover',
        authorUserId: userId,
        summary: clear
          ? `Carryover removed from ${bucketLabel}`
          : `Carryover applied: ${applied >= 0 ? '+' : '−'}$${Math.abs(applied).toFixed(2)} to ${bucketLabel}`,
      },
    ]);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not apply carryover.' },
      { status: 400 },
    );
  }

  const view = await getPeriodPlanView(accountKey, period, userId);
  const priorOverUnder = await getPriorOverUnder(accountKey, period, userId);
  return NextResponse.json({ accountKey, period, ...view, priorOverUnder });
}
