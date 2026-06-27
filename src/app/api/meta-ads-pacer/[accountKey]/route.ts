import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  adPlatformWhere,
  canAccessPacer,
  fetchPeriodPlan,
  getOrCreatePlan,
  getPeriodPlanView,
  getPriorOverUnder,
  isPeriodWritable,
  isValidPeriod,
  reconcileCompletedRuns,
} from '@/lib/meta-ads-pacer';
import {
  notifyAssignment,
  notifyApprovalChange,
} from '@/lib/notifications/service';
import {
  type AuditInput,
  diffTrackedAdFields,
  newAuditGroupId,
  summarizeDiff,
  writeAudit,
} from '@/lib/meta-ads-audit';

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
  // Facebook link — settable from the client (campaign picker). The other
  // Meta fields (metaEffectiveStatus, pacerSyncedAt, metaStartDate/EndDate)
  // are sync-managed and deliberately omitted so autosave can't clobber them.
  metaObjectId?: string | null;
  metaObjectType?: string | null;
  // Per-ad alert mute (Change 9) — toggled from the pacer row.
  alertsMuted?: boolean;
  // Ad platform — set once on create ('google' from the Google tool; null/Meta
  // otherwise). Preserved on update.
  platform?: string | null;
  // Google line: the channel-type rollup tag (Search/Display/Video/Shopping/PMax).
  googleChannelType?: string | null;
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

  const userId = session.user?.id ?? null;
  // Which platform's lines this surface shows (Meta tool default; the Google
  // tool passes ?platform=google). Keeps the two pacers separate over the
  // shared plan.
  const platform = req.nextUrl.searchParams.get('platform') === 'google' ? 'google' : 'meta';
  // Status sync (Change 11): auto-complete ads whose flight has ended before
  // building the view. Skipped on frozen months (they're read-only).
  const planForReconcile = await getOrCreatePlan(accountKey);
  if (await isPeriodWritable(accountKey, planForReconcile.id, period)) {
    await reconcileCompletedRuns(accountKey, planForReconcile.id, period, userId);
  }

  // Live-vs-frozen: closed months serve their immutable snapshot (and freeze
  // lazily on first view); live months serve current data.
  const view = await getPeriodPlanView(accountKey, period, userId, platform);
  // Prior month's over/under for the carryover prompt — only on editable
  // months (a frozen month can't take a carryover; skip to avoid freezing
  // the month-before as a side effect of browsing history).
  const priorOverUnder = view.frozen
    ? null
    : await getPriorOverUnder(accountKey, period, session.user?.id ?? null);
  return NextResponse.json({ accountKey, period, ...view, priorOverUnder });
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

  // Scope the returned view to the caller's platform (Meta default; Google tool
  // passes ?platform=google) so autosave responses stay platform-separated.
  const postPlatform = req.nextUrl.searchParams.get('platform') === 'google' ? 'google' : 'meta';

  const plan = await getOrCreatePlan(accountKey);

  // A frozen (closed, not reopened) month is read-only — reject the save so
  // autosave can't mutate a settled month's record.
  if (!(await isPeriodWritable(accountKey, plan.id, period))) {
    return NextResponse.json(
      { error: 'This month is frozen. Reopen it to make changes.', code: 'month_frozen' },
      { status: 409 },
    );
  }

  const body = (await req.json()) as IncomingPeriodPayload;

  const incomingAds: IncomingAd[] = Array.isArray(body.ads) ? body.ads : [];
  const incomingIds = incomingAds.map((ad) => ad.id).filter(Boolean) as string[];

  // Snapshot the current state of ALL ads in this period before the upsert so
  // we can (a) detect assignment/approval changes for notifications and (b)
  // diff tracked fields for the automatic audit log (Change 10), including
  // ads that are about to be deleted.
  const existingAds = await prisma.metaAdsPacerAd.findMany({
    where: { planId: plan.id, period, ...adPlatformWhere(postPlatform) },
    select: {
      id: true,
      name: true,
      ownerUserId: true,
      designerUserId: true,
      accountRepUserId: true,
      internalApproval: true,
      clientApproval: true,
      pacerDailyBudget: true,
      pacerActual: true,
      allocation: true,
      budgetType: true,
      budgetSource: true,
      splitBaseAmount: true,
      adStatus: true,
      flightStart: true,
      flightEnd: true,
      liveDate: true,
    },
  });
  const existingById = new Map(existingAds.map((a) => [a.id, a]));
  const existingBudget = await prisma.metaAdsPacerPeriodBudget.findUnique({
    where: { planId_period: { planId: plan.id, period } },
    select: { baseBudgetGoal: true, addedBudgetGoal: true },
  });
  const accountDealer =
    (await prisma.account.findUnique({
      where: { key: accountKey },
      select: { dealer: true },
    }))?.dealer ?? accountKey;

  // The account budget goals live on a single per-plan+period row SHARED across
  // platforms, so only touch the fields the caller actually sent — a Google
  // autosave (which omits them) must never null Meta's budget, and vice-versa.
  // Per-platform budget columns: the Google tool writes the google* pair, Meta
  // the original pair.
  const baseCol = postPlatform === 'google' ? 'googleBaseBudgetGoal' : 'baseBudgetGoal';
  const addedCol = postPlatform === 'google' ? 'googleAddedBudgetGoal' : 'addedBudgetGoal';
  const budgetData: Record<string, string | null> = {};
  if ('baseBudgetGoal' in body) budgetData[baseCol] = nullable(body.baseBudgetGoal);
  if ('addedBudgetGoal' in body) budgetData[addedCol] = nullable(body.addedBudgetGoal);

  await prisma.$transaction(async (tx) => {
    // Period budget — upsert only when the caller manages budget goals.
    if (Object.keys(budgetData).length > 0) {
      await tx.metaAdsPacerPeriodBudget.upsert({
        where: { planId_period: { planId: plan.id, period } },
        create: { planId: plan.id, period, ...budgetData },
        update: budgetData,
      });
    }

    // Reconcile only ads in THIS period + platform — the other platform's rows
    // (and other periods) are left untouched, so a Google save never deletes
    // Meta lines and vice-versa.
    if (incomingIds.length > 0) {
      await tx.metaAdsPacerAd.deleteMany({
        where: { planId: plan.id, period, ...adPlatformWhere(postPlatform), NOT: { id: { in: incomingIds } } },
      });
    } else {
      await tx.metaAdsPacerAd.deleteMany({
        where: { planId: plan.id, period, ...adPlatformWhere(postPlatform) },
      });
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
        metaObjectId: nullable(ad.metaObjectId),
        metaObjectType: nullable(ad.metaObjectType),
        googleChannelType: nullable(ad.googleChannelType),
        alertsMuted: ad.alertsMuted === true,
      };

      // platform is set once on create (Google tool sends 'google'; Meta/legacy
      // = null) and preserved on update so a save never re-tags an existing row.
      const createPlatform = ad.platform === 'google' ? 'google' : null;
      if (ad.id) {
        await tx.metaAdsPacerAd.upsert({
          where: { id: ad.id },
          create: { id: ad.id, planId: plan.id, platform: createPlatform, ...data },
          update: data,
        });
      } else {
        await tx.metaAdsPacerAd.create({
          data: { planId: plan.id, platform: createPlatform, ...data },
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

  // ── Automatic audit log (Change 10) ──
  // Diff tracked fields per ad, plus creations/deletions and budget-goal
  // changes. One groupId ties this save together (so a bulk "Set all" reads as
  // a single grouped action). Best-effort; never blocks the save.
  {
    const authorUserId = session.user?.id ?? null;
    const groupId = newAuditGroupId();
    const entries: AuditInput[] = [];
    const base = { accountKey, planId: plan.id, period, groupId, authorUserId };

    const goalDiffs: Array<[string, string, string | null, string | null]> = [
      ['baseBudgetGoal', 'Base budget goal', existingBudget?.baseBudgetGoal ?? null, nullable(body.baseBudgetGoal)],
      ['addedBudgetGoal', 'Added budget goal', existingBudget?.addedBudgetGoal ?? null, nullable(body.addedBudgetGoal)],
    ];
    for (const [field, label, from, to] of goalDiffs) {
      if (from !== to) {
        const f = (v: string | null) => (v == null ? '—' : `$${Number(v).toFixed(2)}`);
        entries.push({ ...base, action: 'edit', field, fromValue: from, toValue: to, summary: `${label} ${f(from)} → ${f(to)}` });
      }
    }

    const incomingIdSet = new Set(incomingIds);
    for (const ad of incomingAds) {
      const before = ad.id ? existingById.get(ad.id) : undefined;
      const name = ad.name || before?.name || 'Untitled Ad';
      if (!before) {
        entries.push({ ...base, adId: ad.id ?? null, adName: name, action: 'created', summary: `Created "${name}"` });
        continue;
      }
      const beforeRec = before as unknown as Record<string, unknown>;
      const afterRec = ad as unknown as Record<string, unknown>;
      for (const d of diffTrackedAdFields(beforeRec, afterRec)) {
        entries.push({
          ...base,
          adId: ad.id ?? null,
          adName: name,
          action: 'edit',
          field: d.field,
          fromValue: d.from,
          toValue: d.to,
          summary: summarizeDiff(name, d),
        });
      }
    }
    for (const ex of existingAds) {
      if (!incomingIdSet.has(ex.id)) {
        entries.push({ ...base, adId: ex.id, adName: ex.name || 'Untitled Ad', action: 'deleted', summary: `Deleted "${ex.name || 'Untitled Ad'}"` });
      }
    }
    await writeAudit(entries);
  }

  const payload = await fetchPeriodPlan(plan.id, period, postPlatform);
  return NextResponse.json({ accountKey, period, ...payload });
}
