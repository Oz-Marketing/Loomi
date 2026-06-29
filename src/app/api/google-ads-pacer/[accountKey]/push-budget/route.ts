import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  canAccessPacer,
  getOrCreatePlan,
  isPeriodWritable,
  isValidPeriod,
} from '@/lib/meta-ads-pacer';
import {
  GoogleAdsError,
  getGoogleCustomer,
  pushCampaignDailyBudget,
} from '@/lib/integrations/google-ads';
import { writeAudit } from '@/lib/meta-ads-audit';

interface PushBudgetBody {
  adId?: string;
  dailyBudget?: string | number;
}

/**
 * Write a Google pacer row's daily budget back to its linked campaign budget —
 * the one write path in the Google integration (everything else is read-only).
 * Requires the row to be linked (carry googleBudgetResourceName from import/
 * sync) and to be a Daily-budget ad. Mirrors the Meta push-budget route.
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

  const body = (await req.json().catch(() => null)) as PushBudgetBody | null;
  const adId = typeof body?.adId === 'string' ? body.adId : '';
  const amount = Number(body?.dailyBudget);
  if (!adId) {
    return NextResponse.json({ error: 'adId is required' }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: 'Daily budget must be a positive number' },
      { status: 400 },
    );
  }

  const plan = await getOrCreatePlan(accountKey);
  if (!(await isPeriodWritable(accountKey, plan.id, period))) {
    return NextResponse.json(
      { error: 'This month is frozen. Reopen it to push changes.', code: 'month_frozen' },
      { status: 409 },
    );
  }

  const ad = await prisma.metaAdsPacerAd.findFirst({
    where: { id: adId, planId: plan.id, period, platform: 'google' },
    select: {
      id: true,
      name: true,
      budgetType: true,
      googleCampaignId: true,
      googleBudgetResourceName: true,
    },
  });
  if (!ad) {
    return NextResponse.json({ error: 'Campaign not found in this period' }, { status: 404 });
  }
  if (!ad.googleCampaignId || !ad.googleBudgetResourceName) {
    return NextResponse.json(
      { error: 'Import this campaign from Google before pushing a budget.' },
      { status: 400 },
    );
  }
  if (ad.budgetType !== 'Daily') {
    return NextResponse.json(
      { error: 'Only Daily-budget campaigns have a daily budget to push.' },
      { status: 400 },
    );
  }

  try {
    const { cfg, customerId } = await getGoogleCustomer(accountKey);
    await pushCampaignDailyBudget(cfg, customerId, ad.googleBudgetResourceName, amount);

    // Keep our copy in lockstep with what Google now holds.
    await prisma.metaAdsPacerAd.update({
      where: { id: ad.id },
      data: { pacerDailyBudget: amount.toFixed(2) },
    });

    await writeAudit([
      {
        accountKey,
        planId: plan.id,
        period,
        platform: 'google',
        action: 'budget_push',
        authorUserId: session.user?.id ?? null,
        summary: `Pushed daily budget $${amount.toFixed(2)} to Google for "${ad.name}"`,
      },
    ]);

    return NextResponse.json({ ok: true, dailyBudget: amount.toFixed(2) });
  } catch (err) {
    if (err instanceof GoogleAdsError) {
      // Never 5xx — gateways swap 5xx bodies for HTML. 422 passes the message.
      // eslint-disable-next-line no-console
      console.error('[google-ads-pacer] push-budget API error:', err.code, err.message);
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    }
    // eslint-disable-next-line no-console
    console.error('[google-ads-pacer] push-budget failed', err);
    return NextResponse.json({ error: 'Failed to push budget' }, { status: 500 });
  }
}
