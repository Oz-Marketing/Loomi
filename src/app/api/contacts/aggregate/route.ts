import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import { filterAccountKeysByAccess } from '@/lib/roles';
import { prisma } from '@/lib/prisma';
import { listContactsForAccount } from '@/lib/contacts/queries';
import type { Contact as ApiContact } from '@/lib/contacts/types';

// GET /api/contacts/aggregate?accountKeys=&limitPerAccount=&includeMessaging=
//
// Admin multi-account sampling. Response mirrors
// /api/esp/contacts/aggregate so the existing admin contacts view
// can flip in Phase C with no shape change. The provider field is
// fixed at 'loomi' since we no longer differentiate per-account ESPs
// for contact reads.

const DEFAULT_LIMIT_PER_ACCOUNT = 120;
const MIN_LIMIT_PER_ACCOUNT = 25;
const MAX_LIMIT_PER_ACCOUNT = 250;
const FETCH_CONCURRENCY = 5;

interface PerAccountEntry {
  dealer: string;
  count: number;
  connected: boolean;
  provider: string;
}

export async function GET(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    const limitRaw = Number(req.nextUrl.searchParams.get('limitPerAccount') || DEFAULT_LIMIT_PER_ACCOUNT);
    const limitPerAccount = Number.isFinite(limitRaw)
      ? Math.max(MIN_LIMIT_PER_ACCOUNT, Math.min(MAX_LIMIT_PER_ACCOUNT, limitRaw))
      : DEFAULT_LIMIT_PER_ACCOUNT;

    const requestedKeys = (req.nextUrl.searchParams.get('accountKeys') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const includeMessaging = req.nextUrl.searchParams.get('includeMessaging') === 'true';

    const userRole = session!.user.role;
    const userAccountKeys: string[] = session!.user.accountKeys ?? [];

    // All non-system accounts (system accounts have keys prefixed
    // with `_`). Restricted-admin users get further filtered to their
    // assigned account keys below.
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

    const allContacts: (ApiContact & { _accountKey: string; _dealer: string })[] = [];
    const perAccount: Record<string, PerAccountEntry> = {};
    const errors: Record<string, string> = {};

    await runWithConcurrency(selectedKeys, FETCH_CONCURRENCY, async (accountKey) => {
      const account = accountMap.get(accountKey);
      const dealer = account?.dealer || accountKey;

      try {
        const result = await listContactsForAccount({
          accountKey,
          limit: limitPerAccount,
          includeMessagingSummary: includeMessaging,
        });
        for (const contact of result.contacts) {
          allContacts.push({ ...contact, _accountKey: accountKey, _dealer: dealer });
        }
        perAccount[accountKey] = {
          dealer,
          count: result.total,
          connected: true,
          provider: 'loomi',
        };
      } catch (err) {
        errors[accountKey] = err instanceof Error ? err.message : 'Failed to fetch';
        perAccount[accountKey] = {
          dealer,
          count: 0,
          connected: true,
          provider: 'loomi',
        };
      }
    });

    const errorCount = Object.keys(errors).length;

    return NextResponse.json({
      contacts: allContacts,
      perAccount,
      errors,
      meta: {
        accountsRequested: selectedKeys.length,
        accountsFetched: Object.keys(perAccount).length,
        totalContacts: Object.values(perAccount).reduce((sum, entry) => sum + entry.count, 0),
        sampledContacts: allContacts.length,
        sampled: true,
        limitPerAccount,
        // Adapter-skipping fields preserved for response-shape parity.
        // They're always zero for the local-DB path.
        skippedNoAdapter: 0,
        skippedNoCredentials: 0,
        errorCount,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch aggregate contacts';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Small worker-pool helper. Kept local instead of importing
// withConcurrencyLimit out of a shared utils module — that whole helper
// disappears in Phase D.
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}
