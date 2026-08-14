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
import { resolveFilterFields } from '@/lib/services/audience-fields';
import { countSegment, type SegmentStrategy } from '@/lib/segments/resolve';
import { parseAndValidateFilterDefinition } from '@/lib/smart-list-validate';

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
  // The account the counts are FOR. A segment is a filter, not a member
  // list — an org-wide segment has a different size in every account, so
  // the caller has to say which one it's asking about.
  const accountKey =
    typeof body?.accountKey === 'string' && body.accountKey.trim()
      ? body.accountKey.trim()
      : '';

  if (ids.length === 0 || !accountKey) {
    return NextResponse.json(
      { error: 'ids and accountKey are required' },
      { status: 400 },
    );
  }

  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  const isPrivileged = userRole === 'developer' || userRole === 'super_admin';
  if (!isPrivileged && !userAccountKeys.includes(accountKey)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const fields = await resolveFilterFields(accountKey);

  const counts: CountEntry[] = [];
  for (const id of ids) {
    const audience = await audienceService.getAudienceById(id);
    if (!audience) {
      counts.push({ id, count: null, strategy: null, error: 'Segment not found' });
      continue;
    }
    // Visibility: org-wide segments are readable everywhere; scoped ones
    // only from their own account.
    if (audience.accountKey && audience.accountKey !== accountKey) {
      counts.push({ id, count: null, strategy: null, error: 'Forbidden' });
      continue;
    }

    const validation = parseAndValidateFilterDefinition(audience.filters, fields);
    if (!validation.ok) {
      counts.push({
        id,
        count: null,
        strategy: null,
        error: 'This segment references a field that no longer exists',
      });
      continue;
    }

    try {
      const result = await countSegment(accountKey, validation.definition, fields);
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
