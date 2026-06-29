import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import {
  applyAllUnapplied,
  applyCarryover,
  canAccessPacer,
  getCurrentPacerPeriod,
  getOrCreatePlan,
  getYearReconciliation,
  isPeriodWritable,
  isValidPeriod,
  setHistoricalTarget,
  unapplyCarryover,
} from '@/lib/meta-ads-pacer';
import { writeAudit } from '@/lib/meta-ads-audit';

function resolveYear(req: NextRequest): number {
  const raw = Number(req.nextUrl.searchParams.get('year'));
  return Number.isFinite(raw) && raw >= 2000 && raw <= 2100
    ? raw
    : new Date().getFullYear();
}

/**
 * Per-month over/under for a calendar year, plus the YTD net still to
 * reconcile and what's currently applied into the live month. Powers the
 * Reconciliation tab.
 */
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

  const year = resolveYear(req);
  const platform =
    req.nextUrl.searchParams.get('platform') === 'google' ? 'google' : 'meta';
  const data = await getYearReconciliation(
    accountKey,
    year,
    session.user?.id ?? null,
    platform,
  );
  return NextResponse.json({ accountKey, ...data });
}

interface Body {
  type?: 'apply' | 'apply-all' | 'unapply' | 'set-target';
  sourceMonth?: string;
  bucket?: 'base' | 'added';
  period?: string;
  clientBudget?: number | string | null;
}

const fmt$ = (n: number) => `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(2)}`;
const monthLabel = (p: string) => {
  const [y, m] = p.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
};

/**
 * Reconciliation actions: apply a single month's over/under into the live
 * month, apply all unapplied at once, undo an application, or set a pre-tool
 * month's client budget. Returns the refreshed year reconciliation.
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

  const body = (await req.json().catch(() => ({}))) as Body;
  const userId = session.user?.id ?? null;
  const plan = await getOrCreatePlan(accountKey);
  const bucket = body.bucket === 'added' ? 'added' : 'base';
  const bucketLabel = bucket === 'base' ? 'Base' : 'Added';
  const year = resolveYear(req);
  const platform =
    req.nextUrl.searchParams.get('platform') === 'google' ? 'google' : 'meta';
  const auditPlatform = platform === 'google' ? 'google' : null;

  try {
    // set-target writes a past month's client budget — no live-month needed.
    if (body.type === 'set-target') {
      const period = body.period;
      if (!period || !isValidPeriod(period)) {
        return NextResponse.json({ error: 'Invalid period' }, { status: 400 });
      }
      const raw = body.clientBudget;
      const value =
        raw == null || raw === '' ? null : Number(raw);
      if (value != null && !Number.isFinite(value)) {
        return NextResponse.json({ error: 'Invalid client budget' }, { status: 400 });
      }
      await setHistoricalTarget(plan.id, period, value, platform);
      await writeAudit([
        {
          accountKey,
          planId: plan.id,
          period,
          platform: auditPlatform,
          action: 'edit',
          authorUserId: userId,
          summary: `Reconciliation: set ${monthLabel(period)} client budget to ${
            value != null ? `$${value.toFixed(2)}` : '—'
          }`,
        },
      ]);
      const data = await getYearReconciliation(accountKey, year, userId, platform);
      return NextResponse.json({ accountKey, ...data });
    }

    // Apply/unapply land on the current live month — it must be writable.
    const targetPeriod = await getCurrentPacerPeriod(accountKey);
    if (!(await isPeriodWritable(accountKey, plan.id, targetPeriod))) {
      return NextResponse.json(
        {
          error: 'The current month is frozen — reopen it to reconcile.',
          code: 'month_frozen',
        },
        { status: 409 },
      );
    }

    if (body.type === 'apply') {
      const sourceMonth = body.sourceMonth;
      if (!sourceMonth || !isValidPeriod(sourceMonth)) {
        return NextResponse.json({ error: 'Invalid source month' }, { status: 400 });
      }
      if (sourceMonth >= targetPeriod) {
        return NextResponse.json(
          { error: 'Only settled prior months can be reconciled.' },
          { status: 400 },
        );
      }
      const { applied } = await applyCarryover(
        accountKey,
        plan.id,
        sourceMonth,
        targetPeriod,
        bucket,
        userId,
        platform,
      );
      await writeAudit([
        {
          accountKey,
          planId: plan.id,
          period: targetPeriod,
          platform: auditPlatform,
          action: 'carryover',
          authorUserId: userId,
          summary: `Reconciled ${monthLabel(sourceMonth)} → ${monthLabel(
            targetPeriod,
          )} (${fmt$(applied)} to ${bucketLabel})`,
        },
      ]);
    } else if (body.type === 'apply-all') {
      const { applied, count } = await applyAllUnapplied(
        accountKey,
        plan.id,
        targetPeriod,
        bucket,
        userId,
        platform,
      );
      await writeAudit([
        {
          accountKey,
          planId: plan.id,
          period: targetPeriod,
          platform: auditPlatform,
          action: 'carryover',
          authorUserId: userId,
          summary: `Reconciled all unapplied months → ${monthLabel(
            targetPeriod,
          )} (${count} month${count === 1 ? '' : 's'}, ${fmt$(applied)} to ${bucketLabel})`,
        },
      ]);
    } else if (body.type === 'unapply') {
      const sourceMonth =
        body.sourceMonth && isValidPeriod(body.sourceMonth)
          ? body.sourceMonth
          : null;
      await unapplyCarryover(plan.id, targetPeriod, sourceMonth, platform);
      await writeAudit([
        {
          accountKey,
          planId: plan.id,
          period: targetPeriod,
          platform: auditPlatform,
          action: 'carryover',
          authorUserId: userId,
          summary: sourceMonth
            ? `Removed ${monthLabel(sourceMonth)} reconciliation from ${monthLabel(targetPeriod)}`
            : `Cleared all reconciliations from ${monthLabel(targetPeriod)}`,
        },
      ]);
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Reconciliation failed.' },
      { status: 400 },
    );
  }

  const data = await getYearReconciliation(accountKey, year, userId, platform);
  return NextResponse.json({ accountKey, ...data });
}
