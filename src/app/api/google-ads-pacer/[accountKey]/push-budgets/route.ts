import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  accountTimeZone,
  canAccessPacer,
  fetchPeriodPlan,
  getOrCreatePlan,
  isPeriodWritable,
  isValidPeriod,
} from '@/lib/meta-ads-pacer';
import {
  GoogleAdsError,
  getGoogleCustomer,
  pushCampaignDailyBudgets,
  type CampaignBudgetUpdate,
} from '@/lib/integrations/google-ads';
import {
  buildAllocatorView,
  buildPushPlan,
  resolveClock,
  resolvePayable,
  type AllocationMode,
  type PushSkip,
} from '@/lib/ad-pacer/google-allocator';
import type { PacerAd } from '@/lib/ad-pacer/types';
import { writeAudit, newAuditGroupId, type AuditInput } from '@/lib/meta-ads-audit';
import { zonedTodayIso } from '@/lib/timezone';

interface PushBody {
  /** Preview only — compute the plan and return it without writing to Google. */
  dryRun?: boolean;
  /** Restrict the push to a label's campaigns (the filtered view). */
  label?: string | null;
}

/**
 * Apply the card's recommended dailies to Google (google-pacing-card spec §8).
 *
 * The plan is recomputed SERVER-SIDE from the stored allocations rather than
 * trusting numbers posted by the client: the client's figures are a rendering of
 * the same arithmetic, and a stale tab posting last hour's dailies onto live
 * campaigns is the one failure this endpoint must not have.
 *
 * Held back, each for its own reason (see buildPushPlan): unlinked rows, Total-
 * budget campaigns, SHARED budgets, and rows whose drift from the current daily is
 * under the threshold — rewriting a rate that's already right costs smart bidding
 * its learning for nothing.
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

  const body = ((await req.json().catch(() => null)) ?? {}) as PushBody;
  const dryRun = body.dryRun === true;

  const plan = await getOrCreatePlan(accountKey);
  if (!dryRun && !(await isPeriodWritable(accountKey, plan.id, period))) {
    return NextResponse.json(
      { error: 'This month is frozen. Reopen it to push changes.', code: 'month_frozen' },
      { status: 409 },
    );
  }

  // The same view the card renders — payable, clock and every line, rebuilt from
  // the database so the plan can't disagree with what's stored.
  const view = await buildServerView(plan.id, accountKey, period, body.label ?? null);
  if (view.lines.length === 0) {
    return NextResponse.json({ error: 'No Google campaigns in this period' }, { status: 400 });
  }

  const pushPlan = buildPushPlan(view.visible, view.budgetResourceByLine);

  // Defensive de-dupe: two rows pointing at ONE budget resource would be two
  // conflicting operations in a single mutate (and whichever landed last would
  // silently decide both campaigns' budget). referenceCount should have caught
  // this as a shared budget, but a stale sync can leave it at 1.
  const byResource = new Map<string, typeof pushPlan.candidates>();
  for (const c of pushPlan.candidates) {
    byResource.set(c.budgetResourceName, [...(byResource.get(c.budgetResourceName) ?? []), c]);
  }
  const updates: CampaignBudgetUpdate[] = [];
  const pushed: typeof pushPlan.candidates = [];
  const skipped: PushSkip[] = [...pushPlan.skipped];
  for (const [resourceName, group] of byResource) {
    if (group.length > 1) {
      for (const c of group) {
        skipped.push({
          id: c.id,
          name: c.name,
          reason: 'shared_budget',
          currentDaily: c.currentDaily,
          newDaily: c.newDaily,
        });
      }
      continue;
    }
    updates.push({ budgetResourceName: resourceName, amountUnits: group[0].newDaily });
    pushed.push(group[0]);
  }

  const summary = {
    period,
    label: body.label ?? null,
    accountDailyAfter: pushPlan.accountDailyAfter,
    pushed: pushed.map((c) => ({
      adId: c.id,
      name: c.name,
      from: c.currentDaily,
      to: c.newDaily,
      drift: c.drift,
    })),
    skipped: skipped.map((s) => ({
      adId: s.id,
      name: s.name,
      reason: s.reason,
      currentDaily: s.currentDaily,
      newDaily: s.newDaily,
    })),
  };

  if (dryRun) return NextResponse.json({ ok: true, dryRun: true, ...summary });
  if (updates.length === 0) {
    return NextResponse.json({ ok: true, pushedCount: 0, ...summary });
  }

  try {
    const { cfg, customerId } = await getGoogleCustomer(accountKey);
    // One request for the whole account (§8).
    await pushCampaignDailyBudgets(cfg, customerId, updates);

    // Keep our copy in lockstep with what Google now holds, so the card's drift
    // check doesn't immediately want to push the same numbers again.
    await prisma.$transaction(
      pushed.map((c) =>
        prisma.metaAdsPacerAd.update({
          where: { id: c.id },
          data: { pacerDailyBudget: c.newDaily.toFixed(2) },
        }),
      ),
    );

    const groupId = newAuditGroupId();
    const entries: AuditInput[] = pushed.map((c) => ({
      accountKey,
      planId: plan.id,
      period,
      platform: 'google',
      adId: c.id,
      adName: c.name,
      action: 'budget_push',
      field: 'pacerDailyBudget',
      fromValue: c.currentDaily.toFixed(2),
      toValue: c.newDaily.toFixed(2),
      groupId,
      authorUserId: session.user?.id ?? null,
      summary: `Pushed daily budget $${c.currentDaily.toFixed(2)} → $${c.newDaily.toFixed(2)} to Google for "${c.name}"`,
    }));
    await writeAudit(entries);

    return NextResponse.json({ ok: true, pushedCount: pushed.length, ...summary });
  } catch (err) {
    if (err instanceof GoogleAdsError) {
      // Never 5xx — gateways swap 5xx bodies for HTML. 422 passes the message.
      // eslint-disable-next-line no-console
      console.error('[google-ads-pacer] push-budgets API error:', err.code, err.message);
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    }
    // eslint-disable-next-line no-console
    console.error('[google-ads-pacer] push-budgets failed', err);
    return NextResponse.json({ error: 'Failed to push budgets' }, { status: 500 });
  }
}

/** Rebuild the card's allocator view from stored data, plus the budget resource
 *  each line would mutate. */
async function buildServerView(
  planId: string,
  accountKey: string,
  period: string,
  label: string | null,
) {
  const payload = await fetchPeriodPlan(planId, period, 'google');
  const ads = payload.ads as unknown as PacerAd[];
  const { payable } = resolvePayable({
    baseBudgetGoal: payload.baseBudgetGoal,
    addedBudgetGoal: payload.addedBudgetGoal,
    markup: payload.markup,
  });
  const tz = await accountTimeZone(accountKey);
  const dates = new Set<string>();
  for (const ad of ads) for (const p of ad.dailySpend ?? []) dates.add(p.date);
  const clock = resolveClock(period, zonedTodayIso(Date.now(), tz), [...dates]);

  const view = buildAllocatorView({
    ads,
    mode: (payload.allocationMode ?? 'pct') as AllocationMode,
    payable,
    clock,
    activeLabel: label,
    eventBudgets: payload.eventBudgets,
  });
  const budgetResourceByLine = new Map<string, string | null>(
    ads.map((ad) => [ad.id, ad.googleBudgetResourceName ?? null]),
  );
  return { ...view, budgetResourceByLine };
}
