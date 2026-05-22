import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import { filterAccountKeysByAccess } from '@/lib/roles';
import { prisma } from '@/lib/prisma';

// GET /api/contacts/stats?accountKeys=
//
// Per-account contact counts. Response mirrors
// /api/esp/contacts/stats (`{ stats, errors, meta }`) so the
// dashboard widgets pick up the new endpoint without reshaping.
// The local-DB path is fast enough that we don't need the
// per-account caching the ESP route had — a single groupBy
// covers every account at once.

interface StatsEntry {
  dealer: string;
  count: number;
  connected: boolean;
  cached: boolean;
  provider: string;
}

export async function GET(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    const requestedKeys = (req.nextUrl.searchParams.get('accountKeys') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const userRole = session!.user.role;
    const userAccountKeys: string[] = session!.user.accountKeys ?? [];

    const allAccounts = await prisma.account.findMany({
      where: { key: { not: { startsWith: '_' } } },
      select: { key: true, dealer: true },
      orderBy: { dealer: 'asc' },
    });
    const accountMap = new Map(allAccounts.map((a) => [a.key, a]));
    const allKeys = allAccounts.map((a) => a.key);
    const allowedKeys = filterAccountKeysByAccess(allKeys, userRole, userAccountKeys);

    const selectedKeys = requestedKeys.length > 0
      ? requestedKeys.filter((key) => allowedKeys.includes(key))
      : allowedKeys;

    // One round-trip for every account count.
    const counts = await prisma.contact.groupBy({
      by: ['accountKey'],
      where: { accountKey: { in: selectedKeys } },
      _count: { _all: true },
    });
    const countByKey = new Map(counts.map((row) => [row.accountKey, row._count._all]));

    const stats: Record<string, StatsEntry> = {};
    for (const key of selectedKeys) {
      const dealer = accountMap.get(key)?.dealer || key;
      stats[key] = {
        dealer,
        count: countByKey.get(key) ?? 0,
        // "Connected" used to mean the GHL/Klaviyo auth was working.
        // The local-DB path is always available, so every selected
        // account reads connected=true.
        connected: true,
        cached: false,
        provider: 'loomi',
      };
    }

    const totalContacts = Object.values(stats).reduce((sum, entry) => sum + entry.count, 0);
    const connectedAccounts = Object.values(stats).filter((entry) => entry.connected).length;

    return NextResponse.json({
      stats,
      errors: {},
      meta: {
        totalContacts,
        connectedAccounts,
        accountsFetched: selectedKeys.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch contact stats';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
