// POST /api/segments/contacts
//
// One page of the Contacts list, restricted to the members of a segment
// (saved, by id) or of an unsaved filter definition from the builder.
//
// Why a new route rather than a `?segment=` on /api/contacts/paged: the
// segment has to be RESOLVED first — per account, against that account's
// field catalogue, possibly by the scan strategy — and that resolution
// takes a definition in a body, not a query string. The paging, dedupe
// and sort afterwards are the same `listContactsPaged` the unfiltered
// list uses, so the two views can't drift apart.
//
// Before this existed, "View contacts" on a segment linked to
// /contacts?segment=<id> and the Contacts page ignored the parameter
// entirely — you got the whole roster with nothing saying the filter had
// been dropped.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { listContactsPaged, type PagedSortKey } from '@/lib/contacts/queries';
import { resolveRequestedAccountKeys } from '@/lib/segments/api-scope';
import {
  resolveSegmentMembership,
  resolveSegmentSource,
  SegmentLookupError,
} from '@/lib/segments/lookup';
import { SegmentRefError } from '@/lib/segments/refs';
import { SegmentScanOverflowError } from '@/lib/segments/resolve';

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

export async function POST(req: Request) {
  const { session, error } = await requirePermission('studio.contacts.view');
  if (error) return error;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }

  const requestedKeys: string[] = Array.isArray(body.accountKeys)
    ? body.accountKeys.map((v: unknown) => String(v))
    : [];

  const { selected, deniedAll } = await resolveRequestedAccountKeys(
    requestedKeys,
    session!.user.role,
    session!.user.accountKeys ?? [],
  );
  if (deniedAll) {
    return NextResponse.json(
      { error: 'None of the requested accounts are available to you' },
      { status: 403 },
    );
  }

  const page = Math.max(0, Number(body.page ?? 0) || 0);
  const pageSizeRaw = Number(body.pageSize ?? DEFAULT_PAGE_SIZE);
  const pageSize = Number.isFinite(pageSizeRaw)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, pageSizeRaw))
    : DEFAULT_PAGE_SIZE;
  const search = typeof body.search === 'string' ? body.search.trim() : '';
  const sort = (typeof body.sort === 'string' ? body.sort : undefined) as
    | PagedSortKey
    | undefined;
  const dir = body.dir === 'asc' ? 'asc' : body.dir === 'desc' ? 'desc' : undefined;

  try {
    const source = await resolveSegmentSource(
      { segmentId: body.segmentId, definition: body.definition },
      selected,
    );
    const membership = await resolveSegmentMembership(source.definition, selected);

    // `search` narrows WITHIN the segment rather than replacing it, and
    // it runs in the same query as the id restriction, so the reported
    // total is the count of people matching both.
    const result = await listContactsPaged({
      accountKeys: selected,
      restrictIds: membership.ids,
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
        accountKeys: selected,
        segment: source.segment,
        // Members of the segment before any text search, so the UI can
        // say "12 of 558 in this segment" rather than implying the
        // segment shrank.
        segmentTotal: membership.ids.length,
        byAccount: membership.byAccount,
        // Rooftops whose copy of the filter could not be resolved. Shown
        // rather than swallowed: a partial roll-up that looks complete is
        // worse than one that admits what it's missing.
        accountErrors: membership.errors,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: messageFor(err) }, { status: statusFor(err) });
  }
}

function statusFor(err: unknown): number {
  if (err instanceof SegmentLookupError) return err.status;
  if (err instanceof SegmentScanOverflowError) return 507;
  if (err instanceof SegmentRefError) return 400;
  return 500;
}

function messageFor(err: unknown): string {
  return err instanceof Error ? err.message : 'Failed to resolve segment';
}
