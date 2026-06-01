import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { canAccessPacer, getOrCreatePlan } from '@/lib/meta-ads-pacer';
import {
  MetaSyncError,
  fetchAccountMonthlySpend,
  getAdAccountConfig,
} from '@/lib/integrations/meta-ads';

/** All YYYY-MM from `${year}-01` through the current month (server-local). */
function monthsOfYearToDate(year: number): string[] {
  const now = new Date();
  const lastMonth =
    now.getFullYear() > year ? 12 : now.getFullYear() < year ? 0 : now.getMonth() + 1;
  const out: string[] = [];
  for (let m = 1; m <= lastMonth; m++) {
    out.push(`${year}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Backfill account-total actual spend (from Meta) for months THIS YEAR that the
 * pacer never tracked — i.e. the months before the tool existed. Only fills
 * months that have no pacer ad rows, and only sets `historicalActual` (the
 * client budget / target for those months is entered later, per month). This
 * gives the year-reconciliation view complete actual-spend data.
 *
 * Combined account total only (Meta doesn't know the Base/Added split for
 * pre-tool months). Re-runnable: re-pulls and overwrites historicalActual.
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

  const yearParam = Number(req.nextUrl.searchParams.get('year'));
  const year = Number.isInteger(yearParam) && yearParam > 2000 ? yearParam : new Date().getFullYear();

  const plan = await getOrCreatePlan(accountKey);

  try {
    const { cfg, adAccountId } = await getAdAccountConfig(accountKey);

    // Months that already have tracked ads — their actual comes from the ads,
    // so we never backfill (or overwrite) those.
    const trackedRows = await prisma.metaAdsPacerAd.findMany({
      where: { planId: plan.id, period: { startsWith: `${year}-` } },
      select: { period: true },
      distinct: ['period'],
    });
    const tracked = new Set(trackedRows.map((r) => r.period));

    const gapMonths = monthsOfYearToDate(year).filter((m) => !tracked.has(m));
    if (gapMonths.length === 0) {
      return NextResponse.json({ ok: true, year, backfilled: [], skipped: 'all months tracked' });
    }

    const monthlySpend = await fetchAccountMonthlySpend(
      cfg,
      adAccountId,
      `${year}-01-01`,
      // until = today (account-total to date); Meta clamps to available data.
      new Date().toISOString().slice(0, 10),
    );

    const backfilled: { period: string; actual: string }[] = [];
    for (const period of gapMonths) {
      const spend = monthlySpend.get(period);
      if (spend == null) continue; // no spend that month — leave it out
      const actual = spend.toFixed(2);
      await prisma.metaAdsPacerPeriodBudget.upsert({
        where: { planId_period: { planId: plan.id, period } },
        update: { historicalActual: actual },
        create: { planId: plan.id, period, historicalActual: actual },
      });
      backfilled.push({ period, actual });
    }

    return NextResponse.json({ ok: true, year, backfilled });
  } catch (err) {
    if (err instanceof MetaSyncError) {
      const status = err.code === 'graph_error' ? 502 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    // eslint-disable-next-line no-console
    console.error('[meta-ads-pacer] backfill-history failed', err);
    return NextResponse.json({ error: 'Failed to backfill history' }, { status: 500 });
  }
}
