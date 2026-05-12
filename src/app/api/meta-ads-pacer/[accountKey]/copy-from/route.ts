import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  canAccessPacer,
  fetchPeriodPlan,
  getOrCreatePlan,
  isValidPeriod,
} from '@/lib/meta-ads-pacer';

interface CopyFromBody {
  from?: string;
  to?: string;
  /** When present, only copies these ad IDs from the source period. */
  adIds?: string[];
}

/**
 * Duplicate ads from one period into another.
 *
 * Per-field handling for the copy:
 *  - Preserved as-is: name, owner, designer, account rep, action needed,
 *    recurring, co-op, budget type, budget source, creative link, client name,
 *    digital details, design status, ad status, internal/client approval.
 *  - Reset to null: every date (flightStart, flightEnd, liveDate,
 *    creativeDueDate, dueDate, dateCompleted) and every budget/pacer field
 *    (allocation, pacerActual, pacerDailyBudget, pacerTodayDate, pacerEndDate).
 *  - Dropped: design notes, activity log.
 *
 * Optionally accepts `adIds` to restrict the copy to a subset of source ads;
 * if omitted, copies every ad in the source period.
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

  const body = (await req.json()) as CopyFromBody;
  const from = typeof body.from === 'string' ? body.from : '';
  const to = typeof body.to === 'string' ? body.to : '';
  const adIds = Array.isArray(body.adIds)
    ? body.adIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : null;
  if (!isValidPeriod(from) || !isValidPeriod(to)) {
    return NextResponse.json(
      { error: 'Both from and to must be YYYY-MM strings' },
      { status: 400 },
    );
  }
  if (from === to) {
    return NextResponse.json(
      { error: 'Source and target periods are the same' },
      { status: 400 },
    );
  }

  const plan = await getOrCreatePlan(accountKey);

  await prisma.$transaction(async (tx) => {
    const sourceAds = await tx.metaAdsPacerAd.findMany({
      where: {
        planId: plan.id,
        period: from,
        ...(adIds && adIds.length > 0 ? { id: { in: adIds } } : {}),
      },
      orderBy: { position: 'asc' },
    });
    if (sourceAds.length === 0) return;

    // Append to any existing ads in the target period
    const existing = await tx.metaAdsPacerAd.count({
      where: { planId: plan.id, period: to },
    });

    for (let i = 0; i < sourceAds.length; i++) {
      const src = sourceAds[i];
      await tx.metaAdsPacerAd.create({
        data: {
          planId: plan.id,
          position: existing + i,
          period: to,
          // Preserved (statuses + approvals carry over so the team doesn't
          // re-mark every row — only dates and money reset).
          name: src.name,
          ownerUserId: src.ownerUserId,
          designerUserId: src.designerUserId,
          accountRepUserId: src.accountRepUserId,
          actionNeeded: src.actionNeeded,
          recurring: src.recurring,
          coop: src.coop,
          budgetType: src.budgetType,
          budgetSource: src.budgetSource,
          creativeLink: src.creativeLink,
          clientName: src.clientName,
          digitalDetails: src.digitalDetails,
          designStatus: src.designStatus,
          adStatus: src.adStatus,
          internalApproval: src.internalApproval,
          clientApproval: src.clientApproval,
          // All dates blanked — copies start with no schedule
          flightStart: null,
          flightEnd: null,
          liveDate: null,
          creativeDueDate: null,
          dueDate: null,
          dateCompleted: null,
          // Budget + pacer fields blanked
          allocation: null,
          pacerActual: null,
          pacerDailyBudget: null,
          pacerTodayDate: null,
          pacerEndDate: null,
        },
      });
    }
  });

  const payload = await fetchPeriodPlan(plan.id, to);
  return NextResponse.json({ accountKey, period: to, ...payload });
}
