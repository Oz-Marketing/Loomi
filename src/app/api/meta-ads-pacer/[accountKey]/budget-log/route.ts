import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { adPlatformWhere, canAccessPacer } from '@/lib/meta-ads-pacer';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** ?platform=google → Google's budget log; else Meta's (incl. legacy null). */
function reqPlatform(req: NextRequest): 'meta' | 'google' {
  return req.nextUrl.searchParams.get('platform') === 'google' ? 'google' : 'meta';
}

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
      ...adPlatformWhere(reqPlatform(req)),
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
 *     adsSnapshot: AdSnapshot[],
 *     note?: string,
 *   }
 *
 * AdSnapshot mirrors the Summary tab columns — per-ad budgetType,
 * budget, projected, actual, target, recDaily. The full array is stored
 * as a JSON string so we preserve the exact view the rep was looking at
 * when they logged.
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
    adsSnapshot?: unknown;
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
  if (!Array.isArray(body.adsSnapshot)) {
    return NextResponse.json(
      { error: 'adsSnapshot must be an array' },
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
      platform: reqPlatform(req) === 'google' ? 'google' : null,
      adsSnapshot: JSON.stringify(body.adsSnapshot),
      note: optString(body.note),
      authorUserId: session!.user.id,
    },
  });
  return NextResponse.json(entry, { status: 201 });
}
