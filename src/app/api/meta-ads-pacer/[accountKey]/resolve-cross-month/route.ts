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
import { groupFlightRuns } from '@/lib/ad-pacer/pacer-calc';

/**
 * Every row of the same physical flight, this one included — a synced flight
 * chains by Meta ad-set id, a manual one by the `linkedPrevAdId` pointers. The
 * SAME grouping the ledger and the split-run settlement use, so the three can
 * never disagree about what one flight is.
 */
async function flightRowIds(planId: string, adId: string): Promise<string[]> {
  const rows = await prisma.metaAdsPacerAd.findMany({
    where: { planId },
    select: { id: true, metaObjectId: true, linkedPrevAdId: true },
  });
  for (const members of groupFlightRuns(rows).values()) {
    if (members.some((m) => m.id === adId)) return members.map((m) => m.id);
  }
  return [adId];
}

interface ResolveBody {
  adId?: string;
  action?: 'apply_full_run' | 'split' | 'clear' | 'link';
  month?: string;
  splitMap?: Record<string, number>;
  /** For action 'link': the prior-month ad this instance continues. */
  linkedPrevAdId?: string;
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
  if (
    action !== 'apply_full_run' &&
    action !== 'split' &&
    action !== 'clear' &&
    action !== 'link'
  ) {
    return NextResponse.json(
      { error: "action must be 'apply_full_run', 'split', 'clear', or 'link'" },
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
    // Flight end bounds which month the run may be billed in.
    select: { id: true, name: true, metaEndDate: true, flightEnd: true },
  });
  if (!ad) {
    return NextResponse.json({ error: 'Ad not found in this period' }, { status: 404 });
  }

  let summary = '';
  if (action === 'apply_full_run') {
    // The month the full run BILLS in. Defaults to the ad's own period (the
    // original single-month straddler resolution). A LATER month is now allowed:
    // that is the cross-month case the spend spec is built on — a flight running
    // Jun 26 – Jul 3 that invoices entirely in July posts an Out against June and
    // an In against July, so the run is counted once, in the month it bills.
    // The ledger derives those postings from this one field; nothing else stores
    // the movement (see cross-month-ledger.ts).
    const billedMonth = typeof body?.month === 'string' && body.month ? body.month : period;
    if (!isValidPeriod(billedMonth)) {
      return NextResponse.json(
        { error: 'month must be YYYY-MM' },
        { status: 400 },
      );
    }
    if (billedMonth < period) {
      return NextResponse.json(
        {
          error:
            "A flight can't bill before the month it ran in. Pick the ad's own month or a later one.",
        },
        { status: 400 },
      );
    }
    // Billing must land no later than the month the run actually finishes in —
    // otherwise the dollars would sit in limbo past the invoice they belong to.
    const runEndMonth = (ad.metaEndDate ?? ad.flightEnd)?.slice(0, 7) ?? null;
    if (runEndMonth && billedMonth > runEndMonth) {
      return NextResponse.json(
        {
          error: `This flight ends in ${runEndMonth}, so it can't bill in ${billedMonth}. Bill it in ${runEndMonth} or earlier.`,
        },
        { status: 400 },
      );
    }
    // Mark EVERY row of the flight, not just the one clicked. The mark is what
    // `effectiveActual` reads to place the run: an origin row contributes 0 and
    // the billed row contributes the full run. Marking only the origin row (the
    // usual click, since that's the month you notice the straddle in) left the
    // billed row unmarked, so it kept counting its own slice and the rest of the
    // run was counted in no month at all — invisible before the Raw-vs-Counted
    // tie-out existed to catch it.
    const flightIds = await flightRowIds(plan.id, ad.id);
    await prisma.metaAdsPacerAd.updateMany({
      where: { id: { in: flightIds } },
      data: { fullRunAppliedToMonth: billedMonth, lifetimeMonthSplit: null },
    });
    summary =
      billedMonth === period
        ? `Counted the full run in ${period} for "${ad.name}"`
        : `Billed the full run in ${billedMonth} for "${ad.name}" (ran from ${period})`;
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
  } else if (action === 'link') {
    // Link this month-instance to the prior-month ad it continues, forming one
    // logical split run that settles once at flight end. Linking IS the split
    // mark for a manual run, so seed lifetimeMonthSplit ("{}" = marked, no
    // planned figures) when absent and clear any bill-this-month resolution
    // (split and bill are mutually exclusive).
    const prevId = typeof body?.linkedPrevAdId === 'string' ? body.linkedPrevAdId : '';
    if (!prevId) {
      return NextResponse.json(
        { error: 'linkedPrevAdId is required to link a run' },
        { status: 400 },
      );
    }
    const prev = await prisma.metaAdsPacerAd.findFirst({
      where: { id: prevId, planId: plan.id },
      select: { id: true, period: true },
    });
    if (!prev) {
      return NextResponse.json(
        { error: 'The linked ad was not found in this account.' },
        { status: 404 },
      );
    }
    if (prev.id === ad.id || prev.period >= period) {
      return NextResponse.json(
        { error: 'Link to an ad from an earlier month.' },
        { status: 400 },
      );
    }
    const existing = await prisma.metaAdsPacerAd.findUnique({
      where: { id: ad.id },
      select: { lifetimeMonthSplit: true },
    });
    await prisma.metaAdsPacerAd.update({
      where: { id: ad.id },
      data: {
        linkedPrevAdId: prev.id,
        lifetimeMonthSplit: existing?.lifetimeMonthSplit ?? '{}',
        fullRunAppliedToMonth: null,
      },
    });
    summary = `Linked "${ad.name}" to its prior-month run (settles at flight end)`;
  } else {
    // The billing mark spans the whole flight, so clearing it must too — leaving
    // a sibling row marked would strand the run in a month nothing counts. The
    // split/link fields stay per-row: unlinking a chain is a different intent
    // from dropping a billing choice.
    const flightIds = await flightRowIds(plan.id, ad.id);
    await prisma.metaAdsPacerAd.updateMany({
      where: { id: { in: flightIds } },
      data: { fullRunAppliedToMonth: null },
    });
    await prisma.metaAdsPacerAd.update({
      where: { id: ad.id },
      data: { fullRunAppliedToMonth: null, lifetimeMonthSplit: null, linkedPrevAdId: null },
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
