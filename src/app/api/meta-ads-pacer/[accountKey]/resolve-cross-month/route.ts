import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  canAccessPacer,
  getOrCreatePlan,
  getPeriodPlanView,
  isPeriodWritable,
  isValidPeriod,
} from '@/lib/meta-ads-pacer';
import { writeAudit } from '@/lib/meta-ads-audit';

interface ResolveBody {
  adId?: string;
  action?: 'apply_full_run' | 'split' | 'clear';
  month?: string;
  splitMap?: Record<string, number>;
}

/**
 * §2 cross-month resolution. Server-authoritative (a dedicated endpoint, NOT
 * the autosave PUT) so a resolution can't be clobbered by a stale client
 * snapshot or a Meta re-sync — the two columns are deliberately omitted from
 * both the PUT `data` object and the sync update.
 *
 * - apply_full_run (§2a): count the ad's FULL run in its own month. v1 scope is
 *   own-month only (a single-month straddler is one row in its owning period);
 *   a `month` other than the ad's period is rejected.
 * - split (§2b): store a lifetime ad's editable per-month planned split
 *   (display-only — never books a variance; §3 owns the over/under).
 * - clear: drop either resolution.
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

  const body = (await req.json().catch(() => null)) as ResolveBody | null;
  const adId = typeof body?.adId === 'string' ? body.adId : '';
  const action = body?.action;
  if (!adId) {
    return NextResponse.json({ error: 'adId is required' }, { status: 400 });
  }
  if (action !== 'apply_full_run' && action !== 'split' && action !== 'clear') {
    return NextResponse.json(
      { error: "action must be 'apply_full_run', 'split', or 'clear'" },
      { status: 400 },
    );
  }

  const plan = await getOrCreatePlan(accountKey);
  if (!(await isPeriodWritable(accountKey, plan.id, period))) {
    return NextResponse.json(
      { error: 'This month is frozen. Reopen it to change resolution.', code: 'month_frozen' },
      { status: 409 },
    );
  }

  const ad = await prisma.metaAdsPacerAd.findFirst({
    where: { id: adId, planId: plan.id, period },
    select: { id: true, name: true },
  });
  if (!ad) {
    return NextResponse.json({ error: 'Ad not found in this period' }, { status: 404 });
  }

  let summary = '';
  if (action === 'apply_full_run') {
    // v1: own-month only. The full run is counted in the ad's own period; the
    // adjacent month has no row for this ad, so nothing to zero there.
    if (body?.month && body.month !== period) {
      return NextResponse.json(
        { error: "The full run can only be counted in the ad's own month." },
        { status: 400 },
      );
    }
    await prisma.metaAdsPacerAd.update({
      where: { id: ad.id },
      data: { fullRunAppliedToMonth: period, lifetimeMonthSplit: null },
    });
    summary = `Counted the full run in ${period} for "${ad.name}"`;
  } else if (action === 'split') {
    const raw = body?.splitMap;
    if (!raw || typeof raw !== 'object') {
      return NextResponse.json({ error: 'splitMap is required' }, { status: 400 });
    }
    // Keep only YYYY-MM keys with finite, non-negative amounts (forgiving — no
    // sum-equality enforced; the split is a planning hint, not a ledger entry).
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(k)) continue;
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) clean[k] = Math.round(n * 100) / 100;
    }
    await prisma.metaAdsPacerAd.update({
      where: { id: ad.id },
      data: { lifetimeMonthSplit: JSON.stringify(clean), fullRunAppliedToMonth: null },
    });
    summary = `Set a planned split across ${Object.keys(clean).length} month(s) for "${ad.name}"`;
  } else {
    await prisma.metaAdsPacerAd.update({
      where: { id: ad.id },
      data: { fullRunAppliedToMonth: null, lifetimeMonthSplit: null },
    });
    summary = `Cleared the cross-month resolution for "${ad.name}"`;
  }

  await writeAudit([
    {
      accountKey,
      planId: plan.id,
      period,
      action: 'resolve_cross_month',
      authorUserId: session.user?.id ?? null,
      summary,
    },
  ]);

  // Return the refreshed period view so the client drops it straight into state.
  const view = await getPeriodPlanView(accountKey, period, session.user?.id ?? null);
  return NextResponse.json({ accountKey, period, ...view });
}
