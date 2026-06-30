import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  accessibleAccountKeys,
  fetchOverview,
  isValidPeriod,
} from '@/lib/meta-ads-pacer';

export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const period = req.nextUrl.searchParams.get('period');
  if (!period || !isValidPeriod(period)) {
    return NextResponse.json(
      { error: 'Missing or invalid period (expected YYYY-MM)' },
      { status: 400 },
    );
  }

  // Filter `_`-prefixed system accounts in JS to match the existing pattern
  // used elsewhere (auth.ts getAllAccountKeys) and avoid any Prisma quoting
  // surprises with NOT + startsWith.
  const allAccounts = await prisma.account.findMany({ select: { key: true } });
  const allKeys = allAccounts.filter((a) => !a.key.startsWith('_')).map((a) => a.key);
  const allowed = accessibleAccountKeys(session, allKeys);

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log('[meta-ads-pacer/overview]', {
      role: session?.user?.role,
      sessionAccountKeys: session?.user?.accountKeys?.length ?? 0,
      totalAccounts: allKeys.length,
      allowedAccounts: allowed.length,
      period,
    });
  }

  if (allowed.length === 0) {
    return NextResponse.json({
      period,
      accounts: [],
      _debug:
        process.env.NODE_ENV !== 'production'
          ? {
              role: session?.user?.role ?? null,
              sessionAccountKeys: session?.user?.accountKeys ?? [],
              totalAccountsInDb: allKeys.length,
              firstFewKeys: allKeys.slice(0, 5),
            }
          : undefined,
    });
  }

  const platform = req.nextUrl.searchParams.get('platform') === 'google' ? 'google' : 'meta';
  const overview = await fetchOverview(allowed, period, platform);
  return NextResponse.json({ period, accounts: overview });
}
