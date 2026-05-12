import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { canAccessPacer, fetchYearSummary } from '@/lib/meta-ads-pacer';

/**
 * Returns 12-month budget vs. actual-spend rows for a single account, used by
 * the Compare tab to render per-month over/under and an annual variance.
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

  const yearParam = req.nextUrl.searchParams.get('year');
  const parsedYear = Number(yearParam);
  const year =
    Number.isFinite(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100
      ? parsedYear
      : new Date().getFullYear();

  const months = await fetchYearSummary([accountKey], year);
  return NextResponse.json({ accountKey, year, months });
}
