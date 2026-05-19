import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  canAccessPacer,
  fetchPeriodPlan,
  getOrCreatePlan,
  isValidPeriod,
} from '@/lib/meta-ads-pacer';
import {
  notifyAssignment,
  notifyApprovalChange,
} from '@/lib/notifications/service';

interface IncomingAd {
  id?: string;
  position?: number;
  name?: string;
  ownerUserId?: string | null;
  designerUserId?: string | null;
  accountRepUserId?: string | null;
  actionNeeded?: string | null;
  recurring?: string;
  coop?: string;
  budgetType?: string;
  budgetSource?: string;
  splitBaseAmount?: string | null;
  flightStart?: string | null;
  flightEnd?: string | null;
  liveDate?: string | null;
  creativeDueDate?: string | null;
  dueDate?: string | null;
  dateCompleted?: string | null;
  adStatus?: string;
  designStatus?: string;
  internalApproval?: string;
  clientApproval?: string;
  allocation?: string | null;
  pacerActual?: string | null;
  pacerDailyBudget?: string | null;
  pacerTodayDate?: string | null;
  pacerEndDate?: string | null;
  creativeLink?: string | null;
  clientName?: string | null;
  digitalDetails?: string | null;
}

interface IncomingPeriodPayload {
  baseBudgetGoal?: string | null;
  addedBudgetGoal?: string | null;
  ads?: IncomingAd[];
}

function nullable(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function GET(
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

  const plan = await getOrCreatePlan(accountKey);
  const payload = await fetchPeriodPlan(plan.id, period);
  return NextResponse.json({ accountKey, period, ...payload });
}

export async function PUT(
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

  const body = (await req.json()) as IncomingPeriodPayload;
  const plan = await getOrCreatePlan(accountKey);

  const incomingAds: IncomingAd[] = Array.isArray(body.ads) ? body.ads : [];
  const incomingIds = incomingAds.map((ad) => ad.id).filter(Boolean) as string[];

  // Snapshot the current state of the ads we're about to upsert so we can
  // detect assignment/approval changes after the transaction commits.
  const existingAds =
    incomingIds.length > 0
      ? await prisma.metaAdsPacerAd.findMany({
          where: { planId: plan.id, id: { in: incomingIds } },
          select: {
            id: true,
            ownerUserId: true,
            designerUserId: true,
            accountRepUserId: true,
            internalApproval: true,
            clientApproval: true,
          },
        })
      : [];
  const existingById = new Map(existingAds.map((a) => [a.id, a]));
  const accountDealer =
    (await prisma.account.findUnique({
      where: { key: accountKey },
      select: { dealer: true },
    }))?.dealer ?? accountKey;

  await prisma.$transaction(async (tx) => {
    // Period budget — upsert
    await tx.metaAdsPacerPeriodBudget.upsert({
      where: { planId_period: { planId: plan.id, period } },
      create: {
        planId: plan.id,
        period,
        baseBudgetGoal: nullable(body.baseBudgetGoal),
        addedBudgetGoal: nullable(body.addedBudgetGoal),
      },
      update: {
        baseBudgetGoal: nullable(body.baseBudgetGoal),
        addedBudgetGoal: nullable(body.addedBudgetGoal),
      },
    });

    // Reconcile only ads in THIS period — others are left alone.
    if (incomingIds.length > 0) {
      await tx.metaAdsPacerAd.deleteMany({
        where: { planId: plan.id, period, NOT: { id: { in: incomingIds } } },
      });
    } else {
      await tx.metaAdsPacerAd.deleteMany({ where: { planId: plan.id, period } });
    }

    for (let i = 0; i < incomingAds.length; i++) {
      const ad = incomingAds[i];
      const data = {
        position: typeof ad.position === 'number' ? ad.position : i,
        // Allow empty names so the UI can render a "New Ad" placeholder
        // instead of a pre-filled value the user has to delete.
        name: typeof ad.name === 'string' ? ad.name : '',
        period,
        ownerUserId: nullable(ad.ownerUserId),
        designerUserId: nullable(ad.designerUserId),
        accountRepUserId: nullable(ad.accountRepUserId),
        actionNeeded: nullable(ad.actionNeeded),
        recurring: ad.recurring || 'No',
        coop: ad.coop || 'No',
        budgetType: ad.budgetType || 'Daily',
        budgetSource: ad.budgetSource || 'base',
        splitBaseAmount: nullable(ad.splitBaseAmount),
        flightStart: nullable(ad.flightStart),
        flightEnd: nullable(ad.flightEnd),
        liveDate: nullable(ad.liveDate),
        creativeDueDate: nullable(ad.creativeDueDate),
        dueDate: nullable(ad.dueDate),
        dateCompleted: nullable(ad.dateCompleted),
        adStatus: ad.adStatus || 'In Draft',
        designStatus: ad.designStatus || 'Not Started',
        internalApproval: ad.internalApproval || 'Pending Approval',
        clientApproval: ad.clientApproval || 'Pending Approval',
        allocation: nullable(ad.allocation),
        pacerActual: nullable(ad.pacerActual),
        pacerDailyBudget: nullable(ad.pacerDailyBudget),
        pacerTodayDate: nullable(ad.pacerTodayDate),
        pacerEndDate: nullable(ad.pacerEndDate),
        creativeLink: nullable(ad.creativeLink),
        clientName: nullable(ad.clientName),
        digitalDetails: nullable(ad.digitalDetails),
      };

      if (ad.id) {
        await tx.metaAdsPacerAd.upsert({
          where: { id: ad.id },
          create: { id: ad.id, planId: plan.id, ...data },
          update: data,
        });
      } else {
        await tx.metaAdsPacerAd.create({
          data: { planId: plan.id, ...data },
        });
      }
    }
  });

  // After commit: detect assignment + approval changes and fire notifications.
  // Best-effort — failures here don't surface to the client.
  const triggeringUserId = session!.user.id;
  for (const ad of incomingAds) {
    if (!ad.id) continue;
    const before = existingById.get(ad.id);
    if (!before) continue;
    const adName = ad.name && ad.name.trim() ? ad.name : 'Untitled Ad';

    const assignmentChanges: Array<{
      role: 'owner' | 'designer' | 'account rep';
      next: string | null | undefined;
      prev: string | null;
    }> = [
      { role: 'owner', next: ad.ownerUserId, prev: before.ownerUserId },
      { role: 'designer', next: ad.designerUserId, prev: before.designerUserId },
      { role: 'account rep', next: ad.accountRepUserId, prev: before.accountRepUserId },
    ];
    for (const change of assignmentChanges) {
      // `undefined` means client didn't include the field — keep prior value
      const after = change.next === undefined ? change.prev : change.next;
      if (!after || after === change.prev) continue;
      notifyAssignment({
        newUserId: after,
        triggeringUserId,
        adId: ad.id,
        adName,
        accountDealer,
        role: change.role,
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[notifications] notifyAssignment failed', err);
      });
    }

    const newInternal = ad.internalApproval ?? before.internalApproval;
    if (newInternal && newInternal !== before.internalApproval) {
      const recipients = [
        ad.ownerUserId === undefined ? before.ownerUserId : ad.ownerUserId,
        ad.designerUserId === undefined ? before.designerUserId : ad.designerUserId,
      ].filter((id): id is string => Boolean(id) && id !== triggeringUserId);
      for (const userId of recipients) {
        notifyApprovalChange({
          recipientUserId: userId,
          adId: ad.id,
          adName,
          accountDealer,
          source: 'Internal',
          newStatus: newInternal,
        }).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[notifications] notifyApprovalChange failed', err);
        });
      }
    }
    const newClient = ad.clientApproval ?? before.clientApproval;
    if (newClient && newClient !== before.clientApproval) {
      const repId =
        ad.accountRepUserId === undefined ? before.accountRepUserId : ad.accountRepUserId;
      if (repId && repId !== triggeringUserId) {
        notifyApprovalChange({
          recipientUserId: repId,
          adId: ad.id,
          adName,
          accountDealer,
          source: 'Client',
          newStatus: newClient,
        }).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[notifications] notifyApprovalChange failed', err);
        });
      }
    }
  }

  const payload = await fetchPeriodPlan(plan.id, period);
  return NextResponse.json({ accountKey, period, ...payload });
}
