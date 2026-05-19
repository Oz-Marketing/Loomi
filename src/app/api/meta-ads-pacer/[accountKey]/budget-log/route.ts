import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { canAccessPacer } from '@/lib/meta-ads-pacer';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Budget log — point-in-time snapshots of the pacer's actual-spend +
 * client-budget numbers per account + period. Reps use this to track
 * when they checked or adjusted budgets during the month.
 *
 * GET supports optional ?period=YYYY-MM to scope to a single month;
 * omitted = all entries for the account, newest first.
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

  const periodParam = req.nextUrl.searchParams.get('period');
  if (periodParam && !PERIOD_RE.test(periodParam)) {
    return NextResponse.json({ error: 'Invalid period (expected YYYY-MM)' }, { status: 400 });
  }

  const entries = await prisma.metaAdsPacerBudgetLog.findMany({
    where: {
      accountKey,
      ...(periodParam ? { period: periodParam } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ entries });
}

/**
 * Create a new budget-log entry. Body shape:
 *   {
 *     period: "YYYY-MM",
 *     baseSpend?: string,
 *     baseClientBudget?: string,
 *     addedSpend?: string,
 *     addedClientBudget?: string,
 *     note?: string,
 *   }
 * All money fields are stored as strings to mirror the rest of the
 * pacer's money handling (preserves user formatting like "1,500.00").
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

  let body: {
    period?: unknown;
    baseSpend?: unknown;
    baseClientBudget?: unknown;
    addedSpend?: unknown;
    addedClientBudget?: unknown;
    note?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.period !== 'string' || !PERIOD_RE.test(body.period)) {
    return NextResponse.json(
      { error: 'period is required (format YYYY-MM)' },
      { status: 400 },
    );
  }

  const optString = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const trimmed = v.trim();
    return trimmed.length === 0 ? null : trimmed;
  };

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true },
  });
  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  const entry = await prisma.metaAdsPacerBudgetLog.create({
    data: {
      accountKey,
      period: body.period,
      baseSpend: optString(body.baseSpend),
      baseClientBudget: optString(body.baseClientBudget),
      addedSpend: optString(body.addedSpend),
      addedClientBudget: optString(body.addedClientBudget),
      note: optString(body.note),
      authorUserId: session!.user.id,
    },
  });
  return NextResponse.json(entry, { status: 201 });
}
