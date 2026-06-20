import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import {
  canAccessPacer,
  getOrCreatePlan,
  getPeriodPlanView,
  getPriorOverUnder,
  isPeriodWritable,
  isValidPeriod,
  reconcileCompletedRuns,
} from '@/lib/meta-ads-pacer';
import {
  MetaSyncError,
  type ImportAssignments,
  importAdSets,
} from '@/lib/integrations/meta-ads';
import { newAuditGroupId, writeAudit } from '@/lib/meta-ads-audit';

/** yyyy-MM-dd in server-local time. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

interface ImportBody {
  adSetIds?: unknown;
  assignments?: {
    ownerUserId?: string | null;
    designerUserId?: string | null;
    accountRepUserId?: string | null;
  };
}

/**
 * Adopt the selected Meta ad sets as new pacer rows for `period`, born already
 * linked + synced (the inverse of the manual create-then-link flow). Returns
 * the refreshed plan so the client can drop the new rows straight into state.
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

  const body = (await req.json().catch(() => null)) as ImportBody | null;
  const adSetIds = Array.isArray(body?.adSetIds)
    ? (body!.adSetIds.filter((id): id is string => typeof id === 'string'))
    : [];
  if (adSetIds.length === 0) {
    return NextResponse.json(
      { error: 'Select at least one ad set to import.' },
      { status: 400 },
    );
  }
  const assignments: ImportAssignments = {
    ownerUserId: body?.assignments?.ownerUserId ?? null,
    designerUserId: body?.assignments?.designerUserId ?? null,
    accountRepUserId: body?.assignments?.accountRepUserId ?? null,
  };

  const plan = await getOrCreatePlan(accountKey);
  // A frozen month is read-only — don't seed new rows into a settled record.
  if (!(await isPeriodWritable(accountKey, plan.id, period))) {
    return NextResponse.json(
      { error: 'This month is frozen. Reopen it to import.', code: 'month_frozen' },
      { status: 409 },
    );
  }

  try {
    const userId = session.user?.id ?? null;
    const result = await importAdSets(
      accountKey,
      plan.id,
      period,
      todayIso(),
      adSetIds,
      assignments,
    );

    // One grouped audit entry per import (mirrors the sync convention) plus a
    // per-ad "created" line so the trail names what was adopted.
    if (result.imported.length > 0) {
      const groupId = newAuditGroupId();
      const base = { accountKey, planId: plan.id, period, groupId, authorUserId: userId };
      await writeAudit([
        {
          ...base,
          action: 'sync',
          summary: `Imported ${result.imported.length} ad${
            result.imported.length === 1 ? '' : 's'
          } from Meta`,
        },
        ...result.imported.map((ad) => ({
          ...base,
          adId: ad.adId,
          adName: ad.name,
          action: 'created' as const,
          summary: `Imported "${ad.name}" from Meta (${ad.status})`,
        })),
      ]);
    }

    // An imported ad whose flight already ended (possible when importing
    // non-active ad sets) auto-completes, same as after a sync.
    await reconcileCompletedRuns(accountKey, plan.id, period, userId);
    const view = await getPeriodPlanView(accountKey, period, userId);
    const priorOverUnder = view.frozen
      ? null
      : await getPriorOverUnder(accountKey, period, userId);
    return NextResponse.json({
      accountKey,
      period,
      import: {
        imported: result.imported.length,
        skipped: result.skipped.length,
      },
      ...view,
      priorOverUnder,
    });
  } catch (err) {
    if (err instanceof MetaSyncError) {
      const status = err.code === 'graph_error' ? 502 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    // eslint-disable-next-line no-console
    console.error('[meta-ads-pacer] import failed', err);
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}
