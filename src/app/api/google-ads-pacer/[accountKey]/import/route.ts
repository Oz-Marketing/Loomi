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
  GoogleAdsError,
  importGoogleCampaignsAsRows,
  type ImportGoogleAssignments,
} from '@/lib/integrations/google-ads-pacer';
import { newAuditGroupId, writeAudit } from '@/lib/meta-ads-audit';

/** yyyy-MM-dd in server-local time. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

interface ImportBody {
  campaignIds?: unknown;
  assignments?: {
    ownerUserId?: string | null;
    designerUserId?: string | null;
    accountRepUserId?: string | null;
  };
}

/**
 * §8 — adopt the selected Google campaigns as new pacer rows for `period`, born
 * already linked (googleCampaignId) + synced (period spend, status, budget,
 * channel). Mirrors the Meta import route. Returns the refreshed Google plan so
 * the client drops the new rows straight into state.
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
  const campaignIds = Array.isArray(body?.campaignIds)
    ? body!.campaignIds.filter((id): id is string => typeof id === 'string')
    : [];
  if (campaignIds.length === 0) {
    return NextResponse.json(
      { error: 'Select at least one campaign to import.' },
      { status: 400 },
    );
  }
  const assignments: ImportGoogleAssignments = {
    ownerUserId: body?.assignments?.ownerUserId ?? null,
    designerUserId: body?.assignments?.designerUserId ?? null,
    accountRepUserId: body?.assignments?.accountRepUserId ?? null,
  };

  const plan = await getOrCreatePlan(accountKey);
  if (!(await isPeriodWritable(accountKey, plan.id, period))) {
    return NextResponse.json(
      { error: 'This month is frozen. Reopen it to import.', code: 'month_frozen' },
      { status: 409 },
    );
  }

  try {
    const userId = session.user?.id ?? null;
    const result = await importGoogleCampaignsAsRows(
      accountKey,
      plan.id,
      period,
      todayIso(),
      campaignIds,
      assignments,
    );

    if (result.imported.length > 0) {
      const groupId = newAuditGroupId();
      const base = { accountKey, planId: plan.id, period, platform: 'google', groupId, authorUserId: userId };
      await writeAudit([
        {
          ...base,
          action: 'sync',
          summary: `Imported ${result.imported.length} campaign${
            result.imported.length === 1 ? '' : 's'
          } from Google`,
        },
        ...result.imported.map((ad) => ({
          ...base,
          adId: ad.adId,
          adName: ad.name,
          action: 'created' as const,
          summary: `Imported "${ad.name}" from Google (${ad.status})`,
        })),
      ]);
    }

    await reconcileCompletedRuns(accountKey, plan.id, period, userId);
    const view = await getPeriodPlanView(accountKey, period, userId, 'google');
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
    if (err instanceof GoogleAdsError) {
      // Never 5xx — gateways swap 5xx bodies for HTML. 422 passes the message.
      // eslint-disable-next-line no-console
      console.error('[google-ads-pacer] import Google API error:', err.code, err.message);
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    }
    // eslint-disable-next-line no-console
    console.error('[google-ads-pacer] import failed', err);
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}
