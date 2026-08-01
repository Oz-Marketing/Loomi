import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { canAccessPacer, isValidPeriod } from '@/lib/meta-ads-pacer';
import { getPeriodManagement, setPeriodManaged } from '@/lib/services/budget';

/**
 * GET  /api/meta-ads-pacer/[accountKey]/budget-managed?period=YYYY-MM
 *      → { meta, google } — is each platform's goal pair owned by the ledger?
 * POST … { platform, managed } — hand the month's budget goals to the ledger,
 *      or take them back.
 *
 * Managing syncs the goals immediately, so the fields never sit locked showing
 * a stale hand-typed figure. Unmanaging leaves the last synced value in place
 * for the specialist to edit from (docs/budget-module.md §4).
 *
 * Lives under the pacer's route tree rather than /api/budget because it's the
 * pacer's own surface that consumes it — the budget hub links here.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ accountKey: string }> }) {
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

  return NextResponse.json(await getPeriodManagement(accountKey, period));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ accountKey: string }> }) {
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

  const body = (await req.json().catch(() => null)) as
    | { platform?: string; managed?: boolean }
    | null;
  const platform = body?.platform === 'google' ? 'google' : 'meta';
  if (typeof body?.managed !== 'boolean') {
    return NextResponse.json({ error: 'managed must be true or false' }, { status: 400 });
  }

  try {
    const result = await setPeriodManaged(
      accountKey,
      period,
      platform,
      body.managed,
      session.user?.id ?? null,
    );
    return NextResponse.json({ ok: true, managed: body.managed, ...result });
  } catch (err) {
    // A frozen month / missing pacer plan is the caller's situation to fix, not
    // a server fault.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to change budget management' },
      { status: 400 },
    );
  }
}
