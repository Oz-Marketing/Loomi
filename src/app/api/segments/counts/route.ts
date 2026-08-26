// POST /api/segments/counts
//
// Exact member counts for a batch of saved segments in one round trip —
// what the segments list renders. Batched because the list shows every
// segment at once, and a request per card would be a request storm on an
// account with a couple of dozen segments.
//
// Each entry resolves independently: one segment that can't be counted
// (a deleted custom field, say) reports its own error instead of
// blanking the whole page.

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import * as audienceService from '@/lib/services/audiences';
import { resolveRequestedAccountKeys } from '@/lib/segments/api-scope';
import { countSegmentForAccounts } from '@/lib/segments/lookup';
import { type SegmentStrategy } from '@/lib/segments/resolve';
import type { FilterDefinition } from '@/lib/smart-list-types';

// Counting is one indexed query for the SQL strategy but a full scan for
// the fallback, so cap how many a single request can ask for.
const MAX_IDS = 100;

interface CountEntry {
  id: string;
  count: number | null;
  strategy: SegmentStrategy | null;
  error?: string;
}

export async function POST(req: Request) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((v: unknown): v is string => typeof v === 'string').slice(0, MAX_IDS)
    : [];
  // The accounts the counts are FOR. A segment is a filter, not a member
  // list — an org-wide segment has a different size in every account, so
  // the caller has to say which ones it's asking about. A group sends its
  // whole subtree, because the group itself owns no contacts.
  const requestedKeys: string[] = Array.isArray(body?.accountKeys)
    ? body.accountKeys.map((v: unknown) => String(v))
    : typeof body?.accountKey === 'string' && body.accountKey.trim()
      ? [body.accountKey.trim()]
      : [];

  if (ids.length === 0 || requestedKeys.length === 0) {
    return NextResponse.json(
      { error: 'ids and accountKeys are required' },
      { status: 400 },
    );
  }

  const { selected, deniedAll } = await resolveRequestedAccountKeys(
    requestedKeys,
    session!.user.role,
    session!.user.accountKeys ?? [],
  );
  if (deniedAll) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const inScope = new Set(selected);

  const counts: CountEntry[] = [];
  for (const id of ids) {
    const audience = await audienceService.getAudienceById(id);
    if (!audience) {
      counts.push({ id, count: null, strategy: null, error: 'Segment not found' });
      continue;
    }
    // Visibility: org-wide segments are readable everywhere; scoped ones
    // only from an account in scope — which for a group includes each of
    // its rooftops, so a rooftop's segment still counts from the group.
    if (audience.accountKey && !inScope.has(audience.accountKey)) {
      counts.push({ id, count: null, strategy: null, error: 'Forbidden' });
      continue;
    }

    let definition: FilterDefinition;
    try {
      definition = JSON.parse(audience.filters) as FilterDefinition;
    } catch {
      counts.push({
        id,
        count: null,
        strategy: null,
        error: 'This segment has an unreadable filter',
      });
      continue;
    }

    try {
      // Validated per account inside — one rooftop missing a custom field
      // must not blank the count for the rest of the group.
      const result = await countSegmentForAccounts(definition, selected);
      counts.push({ id, count: result.count, strategy: result.strategy });
    } catch (err) {
      counts.push({
        id,
        count: null,
        strategy: null,
        error: err instanceof Error ? err.message : 'Failed to count segment',
      });
    }
  }

  return NextResponse.json({ counts });
}
