import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { accessibleAccountKeys, fetchYearSummary } from '@/lib/meta-ads-pacer';

/**
 * Cross-account roll-up of monthly budget vs. actual spend for a calendar
 * year. Sums every account the caller can see, so admins viewing the
 * "all accounts" mode get a single 12-month variance table.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const yearParam = req.nextUrl.searchParams.get('year');
  const parsedYear = Number(yearParam);
  const year =
    Number.isFinite(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100
      ? parsedYear
      : new Date().getFullYear();

  // Mirror the overview route's filter of `_`-prefixed system accounts.
  const allAccounts = await prisma.account.findMany({ select: { key: true } });
  const allKeys = allAccounts
    .filter((a) => !a.key.startsWith('_'))
    .map((a) => a.key);
  const allowed = accessibleAccountKeys(session, allKeys);

  const months = await fetchYearSummary(allowed, year);
  return NextResponse.json({ year, accountCount: allowed.length, months });
}
