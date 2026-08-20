import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { filterAccountKeysByAccess } from '@/lib/roles';
import { prisma } from '@/lib/prisma';
import { listContactsPaged, type PagedSortKey } from '@/lib/contacts/queries';

// GET /api/contacts/paged?accountKeys=&page=&pageSize=&search=
//
// One page of the group ("roll-up") Contacts view, already deduped across
// rooftops. Replaces the browser fanning out one `?all=true` request per
// account and merging ~200k records client-side to render 50 rows — which
// also pushed the single app process past pm2's restart ceiling and took
// the whole site down with it.
//
// `?all=true` on /api/contacts still exists for the single-account view and
// for exports; this route is specifically the paginated multi-account read.

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const { session, error } = await requirePermission('studio.contacts.view');
  if (error) return error;

  try {
    const params = req.nextUrl.searchParams;

    const page = Math.max(0, Number(params.get('page') ?? 0) || 0);
    const pageSizeRaw = Number(params.get('pageSize') ?? DEFAULT_PAGE_SIZE);
    const pageSize = Number.isFinite(pageSizeRaw)
      ? Math.min(MAX_PAGE_SIZE, Math.max(1, pageSizeRaw))
      : DEFAULT_PAGE_SIZE;
    const search = (params.get('search') ?? '').trim();
    // Validated against the whitelist inside listContactsPaged — anything
    // unrecognized falls back to the default sort rather than erroring.
    const sort = (params.get('sort') ?? undefined) as PagedSortKey | undefined;
    const dir = params.get('dir') === 'asc' ? 'asc' : params.get('dir') === 'desc' ? 'desc' : undefined;

    const requestedKeys = (params.get('accountKeys') || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);

    // Same shape as /api/contacts/aggregate: resolve the caller's allowed set
    // from the account table, then INTERSECT with what they asked for. Never
    // trust the requested keys on their own.
    //
    // The `\\_` escape is load-bearing — see the note in aggregate/route.ts.
    // `_` is the LIKE single-char wildcard, so a bare `startsWith: '_'` would
    // match every key and `not:` would exclude every account.
    const allAccounts = await prisma.account.findMany({
      where: { key: { not: { startsWith: '\\_' } } },
      select: { key: true },
    });
    const allowedKeys = filterAccountKeysByAccess(
      allAccounts.map((a) => a.key),
      session!.user.role,
      session!.user.accountKeys ?? [],
    );
    const allowed = new Set(allowedKeys);

    const selectedKeys =
      requestedKeys.length > 0 ? requestedKeys.filter((k) => allowed.has(k)) : allowedKeys;

    // Asked for accounts, none of them permitted. That is an authorization
    // outcome, not an empty result set — say so rather than rendering a
    // convincing "no contacts" page.
    if (requestedKeys.length > 0 && selectedKeys.length === 0) {
      return NextResponse.json(
        { error: 'None of the requested accounts are available to you' },
        { status: 403 },
      );
    }

    const result = await listContactsPaged({
      accountKeys: selectedKeys,
      page,
      pageSize,
      search,
      sort,
      dir,
    });

    return NextResponse.json({
      contacts: result.contacts,
      meta: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        pageCount: Math.ceil(result.total / result.pageSize),
        accountKeys: selectedKeys,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch contacts';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
