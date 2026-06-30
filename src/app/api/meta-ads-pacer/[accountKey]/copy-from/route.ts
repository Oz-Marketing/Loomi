import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  adPlatformWhere,
  canAccessPacer,
  getOrCreatePlan,
  getPeriodPlanView,
  isPeriodWritable,
  isValidPeriod,
} from '@/lib/meta-ads-pacer';

interface CopyFieldOptions {
  assignments?: boolean;
  statuses?: boolean;
  approvals?: boolean;
  dates?: boolean;
  budgets?: boolean;
  creative?: boolean;
}

interface CopyFromBody {
  from?: string;
  to?: string;
  /** When present, only copies these ad IDs from the source period. */
  adIds?: string[];
  /** Which field groups carry over (defaults match the old behavior). */
  fields?: CopyFieldOptions;
}

/**
 * Duplicate ads from one period into another.
 *
 * Ad identity always copies: name, budget type, budget source, recurring,
 * co-op, action needed. Everything else is opt-in via `fields` (assignments,
 * statuses, approvals, creative & notes, flight dates, budget amounts) — an
 * unchecked group resets to its default. Actual spend / pacer cursors and
 * design notes / activity log never copy. `adIds` restricts to a subset.
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

  // Platform-scoped: a Google copy must only read/write Google lines (and vice
  // versa) so it never duplicates the other channel's ads into this period.
  const platform = req.nextUrl.searchParams.get('platform') === 'google' ? 'google' : 'meta';
  const createPlatform = platform === 'google' ? 'google' : null;

  const body = (await req.json()) as CopyFromBody;
  const from = typeof body.from === 'string' ? body.from : '';
  const to = typeof body.to === 'string' ? body.to : '';
  const adIds = Array.isArray(body.adIds)
    ? body.adIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : null;
  // Which field groups to carry over — defaults preserve the prior behavior
  // (identity + assignments/statuses/approvals/creative on; dates/budgets off).
  const f = body.fields ?? {};
  const opt = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  const copy = {
    assignments: opt(f.assignments, true),
    statuses: opt(f.statuses, true),
    approvals: opt(f.approvals, true),
    dates: opt(f.dates, false),
    budgets: opt(f.budgets, false),
    creative: opt(f.creative, true),
  };
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

  // Can't copy into a frozen (closed) target month — it's read-only.
  if (!(await isPeriodWritable(accountKey, plan.id, to))) {
    return NextResponse.json(
      { error: 'The target month is frozen. Reopen it to copy ads in.', code: 'month_frozen' },
      { status: 409 },
    );
  }

  await prisma.$transaction(async (tx) => {
    const sourceAds = await tx.metaAdsPacerAd.findMany({
      where: {
        planId: plan.id,
        period: from,
        ...adPlatformWhere(platform),
        ...(adIds && adIds.length > 0 ? { id: { in: adIds } } : {}),
      },
      orderBy: { position: 'asc' },
    });
    if (sourceAds.length === 0) return;

    // Append to any existing ads in the target period (same platform).
    const existing = await tx.metaAdsPacerAd.count({
      where: { planId: plan.id, period: to, ...adPlatformWhere(platform) },
    });

    for (let i = 0; i < sourceAds.length; i++) {
      const src = sourceAds[i];
      await tx.metaAdsPacerAd.create({
        data: {
          planId: plan.id,
          position: existing + i,
          period: to,
          // Preserve the platform tag; for Google also carry the channel-type
          // label (planning identity). The live campaign LINK is intentionally
          // NOT copied (like Meta's metaObjectId) — the new month re-syncs.
          platform: createPlatform,
          googleChannelType: src.googleChannelType,
          // Identity — always copied.
          name: src.name,
          actionNeeded: src.actionNeeded,
          recurring: src.recurring,
          coop: src.coop,
          budgetType: src.budgetType,
          budgetSource: src.budgetSource,
          // Opt-in groups (unchecked → reset to default).
          ownerUserId: copy.assignments ? src.ownerUserId : null,
          designerUserId: copy.assignments ? src.designerUserId : null,
          accountRepUserId: copy.assignments ? src.accountRepUserId : null,
          adStatus: copy.statuses ? src.adStatus : 'In Draft',
          designStatus: copy.statuses ? src.designStatus : 'Not Started',
          internalApproval: copy.approvals ? src.internalApproval : 'Pending Approval',
          clientApproval: copy.approvals ? src.clientApproval : 'Pending Approval',
          creativeLink: copy.creative ? src.creativeLink : null,
          clientName: copy.creative ? src.clientName : null,
          digitalDetails: copy.creative ? src.digitalDetails : null,
          flightStart: copy.dates ? src.flightStart : null,
          flightEnd: copy.dates ? src.flightEnd : null,
          liveDate: copy.dates ? src.liveDate : null,
          creativeDueDate: copy.dates ? src.creativeDueDate : null,
          dueDate: copy.dates ? src.dueDate : null,
          dateCompleted: null,
          allocation: copy.budgets ? src.allocation : null,
          splitBaseAmount: copy.budgets ? src.splitBaseAmount : null,
          pacerDailyBudget: copy.budgets ? src.pacerDailyBudget : null,
          // Actual spend + pacer cursors never copy.
          pacerActual: null,
          pacerTodayDate: null,
          pacerEndDate: null,
        },
      });
    }
  });

  const view = await getPeriodPlanView(accountKey, to, session.user?.id ?? null, platform);
  return NextResponse.json({ accountKey, period: to, ...view });
}
