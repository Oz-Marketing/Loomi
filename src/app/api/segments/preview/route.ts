// POST /api/segments/preview
//
// Resolve an unsaved filter definition against the accounts in scope and
// return an EXACT count plus a bounded sample. This is what the segment
// builder's live preview runs on.
//
// It replaces the old approach of pulling `/api/contacts?all=true` into
// the browser and filtering there, which capped at 5,000 contacts and
// reported the size of that sample as the segment's size.
//
// SCOPE: takes `accountKeys` — the same subtree every other roll-up view
// fans out to. A single `accountKey` is still accepted and means the same
// thing as a one-element list. It has to be a list because a GROUP
// account owns no contacts of its own: previewing Young Powersports
// against its own key returned "0 contacts match, 0% of 0 total" while
// its rooftops held thousands.

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { SegmentRefError } from '@/lib/segments/refs';
import { resolveRequestedAccountKeys } from '@/lib/segments/api-scope';
import { previewSegmentForAccounts, SegmentLookupError } from '@/lib/segments/lookup';
import { SegmentScanOverflowError } from '@/lib/segments/resolve';
import type { FilterDefinition } from '@/lib/smart-list-types';

const MAX_SAMPLE = 100;

export async function POST(req: Request) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }

  const requestedKeys: string[] = Array.isArray(body.accountKeys)
    ? body.accountKeys.map((v: unknown) => String(v))
    : typeof body.accountKey === 'string' && body.accountKey.trim()
      ? [body.accountKey.trim()]
      : [];
  if (requestedKeys.length === 0) {
    return NextResponse.json(
      { error: 'accountKeys is required' },
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

  // When previewing an existing segment, exclude it from its own
  // referenceable options — a self-reference is an immediate cycle.
  const editingSegmentId =
    typeof body.segmentId === 'string' && body.segmentId.trim()
      ? body.segmentId.trim()
      : null;

  const sampleSize = Math.max(
    1,
    Math.min(MAX_SAMPLE, Number(body.sampleSize) || 25),
  );

  // The definition is the one ON SCREEN, not the saved segment's —
  // `segmentId` here identifies what's being edited (so it can't reference
  // itself), it is not a request to resolve the stored version.
  const definition = body.definition;
  if (!definition || typeof definition !== 'object') {
    return NextResponse.json({ error: 'definition is required' }, { status: 400 });
  }

  try {
    // Validated per account inside — the field catalogue differs per
    // rooftop, so there is no one catalogue to check it against up front.
    const result = await previewSegmentForAccounts(definition as FilterDefinition, selected, {
      sampleSize,
      excludeSegmentId: editingSegmentId,
    });
    return NextResponse.json({
      count: result.count,
      reachable: result.reachable,
      accountTotal: result.accountTotal,
      contacts: result.contacts,
      // What the count actually covers, so the UI can say "across 12
      // accounts" rather than leaving a group's number unexplained.
      accountKeys: selected,
      // Rooftops whose catalogue rejected the definition. Reported rather
      // than folded into the count: a segment that couldn't be resolved in
      // three of eighteen stores is not the same as one nobody matched.
      accountErrors: result.errors,
      // `strategy` and `untranslatable` are diagnostic, not decorative:
      // 'scan' means this segment can't be answered by an index, which is
      // what to look at first when a preview feels slow.
      strategy: result.strategy,
      untranslatable: result.untranslatable,
    });
  } catch (err) {
    if (err instanceof SegmentScanOverflowError) {
      return NextResponse.json({ error: err.message }, { status: 507 });
    }
    // A broken segment reference (deleted, cross-account, or a loop) and a
    // definition no account in scope accepts are both the author's problem
    // to fix, not a server fault.
    if (err instanceof SegmentRefError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof SegmentLookupError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Failed to resolve segment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
