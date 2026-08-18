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
import { isSharedBudget } from '@/lib/ad-pacer/google-pacer-calc';

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
      googleBudgetReferenceCount: true,
      pacerReserved: true,
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
  // The SAME structural skips the batched push applies (google-pacing-card §8),
  // enforced here too because the budget-report addendum §2.4 made this the path
  // a hand-typed daily takes. Several campaigns pointing at one budget resource
  // means per-campaign daily control does not exist: writing this campaign's
  // number onto a shared budget would silently change campaigns nobody touched,
  // and a typed number must not be able to do what the batch deliberately will
  // not.
  if (isSharedBudget(ad.googleBudgetReferenceCount)) {
    return NextResponse.json(
      {
        error:
          'This campaign shares its budget with others in Google, so its daily can’t be set on its own. Change it in Google Ads.',
        code: 'shared_budget',
      },
      { status: 400 },
    );
  }
  // A reserve is budget committed to a campaign that cannot spend yet — it is
  // out of every pacing figure by design, so a daily for it is a rate to push at
  // a campaign that is not meant to be running.
  if (ad.pacerReserved === true) {
    return NextResponse.json(
      { error: 'This campaign is reserved — un-reserve it before setting a daily budget.', code: 'reserved' },
      { status: 400 },
    );
  }

  try {
    const { cfg, customerId } = await getGoogleCustomer(accountKey);
    await pushCampaignDailyBudget(cfg, customerId, ad.googleBudgetResourceName, amount);

    // Keep our copy in lockstep with what Google now holds. `googleDailyPushedAt`
    // is stamped for the same reason the batched push stamps it: the card's
    // settling indicator reads it, and Google re-paces over 24–48 hours, so a
    // row whose numbers still describe the old rate has to be able to say so.
    await prisma.metaAdsPacerAd.update({
      where: { id: ad.id },
      data: { pacerDailyBudget: amount.toFixed(2), googleDailyPushedAt: new Date() },
    });

    await writeAudit([
      {
        accountKey,
        planId: plan.id,
        period,
        platform: 'google',
        adId: ad.id,
        adName: ad.name,
        action: 'budget_push',
        field: 'pacerDailyBudget',
        toValue: amount.toFixed(2),
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
