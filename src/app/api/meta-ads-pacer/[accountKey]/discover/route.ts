import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { canAccessPacer, isValidPeriod } from '@/lib/meta-ads-pacer';
import { MetaSyncError, discoverAdSets } from '@/lib/integrations/meta-ads';

/** yyyy-MM-dd in server-local time. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Lists every ad set in this account's Facebook ad account — enriched with
 * budget, flight dates and spend — for the "Import from Meta" modal. Ad sets
 * already linked to a pacer row in this period are flagged (`alreadyLinked`)
 * so they can be hidden/disabled and never double-imported. Read-only.
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

  const period = req.nextUrl.searchParams.get('period');
  if (!period || !isValidPeriod(period)) {
    return NextResponse.json(
      { error: 'Missing or invalid period (expected YYYY-MM)' },
      { status: 400 },
    );
  }

  try {
    const result = await discoverAdSets(accountKey, period, todayIso());
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaSyncError) {
      const status = err.code === 'graph_error' ? 502 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    // eslint-disable-next-line no-console
    console.error('[meta-ads-pacer] discover failed', err);
    return NextResponse.json({ error: 'Failed to load ad sets' }, { status: 500 });
  }
}
