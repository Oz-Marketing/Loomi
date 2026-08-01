import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as budget from '@/lib/services/budget';

/**
 * GET  /api/budget/plan?accountKey=…&year=… — the declared annual commitment.
 * PUT  /api/budget/plan — upsert it (declared total, monthly retainer, markup).
 * POST /api/budget/plan/generate is handled here too via `?generate=true` on
 * PUT: stamping the 12 retainer lines is the natural follow-through from
 * setting a retainer, and splitting it into its own route just makes the client
 * fire two calls that must not half-fail.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const accountKey = sp.get('accountKey');
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }
  if (!budget.canAccess(getAccountScope(session!), accountKey)) return forbidden();

  const year = Number(sp.get('year') ?? new Date().getFullYear());
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
  }

  const plan = await budget.getPlan(accountKey, year);
  return NextResponse.json({
    plan: plan
      ? {
          accountKey: plan.accountKey,
          year: plan.year,
          declaredTotal: budget.toNumber(plan.declaredTotal),
          monthlyRetainer: budget.toNumber(plan.monthlyRetainer),
          defaultMarkup: plan.defaultMarkup,
          notes: plan.notes,
        }
      : null,
  });
}

export async function PUT(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const accountKey = typeof body.accountKey === 'string' ? body.accountKey : '';
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }
  if (!budget.canAccess(getAccountScope(session!), accountKey)) return forbidden();

  const year = Number(body.year ?? new Date().getFullYear());
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
  }

  try {
    const plan = await budget.upsertPlan({
      accountKey,
      year,
      declaredTotal: body.declaredTotal == null ? null : Number(body.declaredTotal),
      monthlyRetainer: body.monthlyRetainer == null ? null : Number(body.monthlyRetainer),
      defaultMarkup: body.defaultMarkup == null ? null : Number(body.defaultMarkup),
      notes: typeof body.notes === 'string' ? body.notes : null,
      userId: session!.user.id,
    });

    // Opt-in follow-through: stamp the year's retainer lines. Idempotent —
    // months that already carry a retainer line are skipped, so re-saving the
    // plan never doubles anyone's budget.
    let generated: Awaited<ReturnType<typeof budget.generateRetainerLines>> = [];
    if (req.nextUrl.searchParams.get('generate') === 'true') {
      generated = await budget.generateRetainerLines(
        accountKey,
        year,
        { channel: typeof body.retainerChannel === 'string' ? body.retainerChannel : null },
        session!.user.id,
      );
    }

    return NextResponse.json({
      plan: {
        accountKey: plan.accountKey,
        year: plan.year,
        declaredTotal: budget.toNumber(plan.declaredTotal),
        monthlyRetainer: budget.toNumber(plan.monthlyRetainer),
        defaultMarkup: plan.defaultMarkup,
        notes: plan.notes,
      },
      generated,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save budget plan' },
      { status: 400 },
    );
  }
}
