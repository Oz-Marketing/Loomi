import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as budget from '@/lib/services/budget';

/**
 * GET /api/budget/lines — list budget lines with the usual filters
 * (accountKey, year, period, channel, taskId, initiativeId, batchId, pool).
 * POST /api/budget/lines — create one line directly in the hub.
 *
 * Internal-staff only, account-scoped. Editing money is currently gated on
 * MANAGEMENT_ROLES like the rest of Projects; docs §8.5 leaves narrowing this
 * to a dedicated budget-admin role open, and it's a one-line change here.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const scope = getAccountScope(session!);
  const sp = req.nextUrl.searchParams;
  const accountKey = sp.get('accountKey');
  if (accountKey && !budget.canAccess(scope, accountKey)) return forbidden();

  const yearRaw = sp.get('year');
  const poolRaw = sp.get('pool');

  const lines = await budget.listLines({
    scope,
    accountKey,
    year: yearRaw ? Number(yearRaw) : null,
    period: sp.get('period'),
    channel: sp.get('channel'),
    taskId: sp.get('taskId'),
    initiativeId: sp.get('initiativeId'),
    batchId: sp.get('batchId'),
    poolOnly: poolRaw == null ? undefined : poolRaw === 'true',
    includeArchived: sp.get('includeArchived') === 'true',
  });
  return NextResponse.json({ lines });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const scope = getAccountScope(session!);
  const body = await req.json().catch(() => ({}));
  const accountKey = typeof body.accountKey === 'string' ? body.accountKey : '';
  const amount = Number(body.amount);

  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
  }
  if (!budget.canAccess(scope, accountKey)) return forbidden();
  // A cross-account line spends from someone else's ad account — the caller
  // needs access to BOTH sides, or they could push money into an account they
  // can't see.
  const spendAccountKey =
    typeof body.spendAccountKey === 'string' && body.spendAccountKey ? body.spendAccountKey : null;
  if (spendAccountKey && !budget.canAccess(scope, spendAccountKey)) return forbidden();

  try {
    const line = await budget.createLine(
      {
        accountKey,
        spendAccountKey,
        year: body.year == null ? undefined : Number(body.year),
        period: typeof body.period === 'string' ? body.period : null,
        channel: typeof body.channel === 'string' ? body.channel : null,
        amount,
        markup: body.markup == null ? null : Number(body.markup),
        source: typeof body.source === 'string' ? body.source : 'adhoc',
        status: typeof body.status === 'string' ? body.status : 'committed',
        bucket: typeof body.bucket === 'string' ? body.bucket : undefined,
        initiativeId: body.initiativeId ?? null,
        taskId: body.taskId ?? null,
        label: typeof body.label === 'string' ? body.label : null,
        notes: typeof body.notes === 'string' ? body.notes : null,
      },
      session!.user.id,
    );
    return NextResponse.json({ line }, { status: 201 });
  } catch (err) {
    // Validation failures from the service (bad period, unknown channel, year
    // disagreement) are the caller's fault, not a server fault.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create budget line' },
      { status: 400 },
    );
  }
}
