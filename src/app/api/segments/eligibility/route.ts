// POST /api/segments/eligibility
//
// "If we pushed this segment to an ad platform, who would actually go?"
//
// Returns the gated count plus the reason for every exclusion, so the
// difference between a segment's size and its uploadable size is visible
// while the segment is being built — not discovered afterwards when the
// platform reports a smaller audience than expected.
//
// Deliberately separate from /api/segments/preview: preview answers "who
// matches", this answers "who may be exported", and collapsing the two
// would let a consent failure blank out an otherwise working preview.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { resolveRequestedAccountKeys } from '@/lib/segments/api-scope';
import {
  resolveEligibleAcrossAccounts,
  type SyncChannel,
} from '@/lib/segments/eligibility';
import {
  planSegmentAcrossAccounts,
  SegmentLookupError,
} from '@/lib/segments/lookup';
import { SegmentRefError } from '@/lib/segments/refs';
import type { FieldDefinition, FilterDefinition } from '@/lib/smart-list-types';

export async function POST(req: Request) {
  const { session, error } = await requirePermission('studio.segments.edit');
  if (error) return error;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }

  // A list, for the same reason the preview takes one: a group account
  // holds no contacts of its own, so gating its own key alone reports
  // that nothing in the group is uploadable.
  const requestedKeys: string[] = Array.isArray(body.accountKeys)
    ? body.accountKeys.map((v: unknown) => String(v))
    : typeof body.accountKey === 'string' && body.accountKey.trim()
      ? [body.accountKey.trim()]
      : [];
  if (requestedKeys.length === 0) {
    return NextResponse.json({ error: 'accountKeys is required' }, { status: 400 });
  }

  const { selected, deniedAll } = await resolveRequestedAccountKeys(
    requestedKeys,
    session!.user.role,
    session!.user.accountKeys ?? [],
  );
  if (deniedAll) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const definition = body.definition;
  if (!definition || typeof definition !== 'object') {
    return NextResponse.json({ error: 'definition is required' }, { status: 400 });
  }

  const channel: SyncChannel =
    body.channel === 'email' || body.channel === 'phone' ? body.channel : 'any';

  try {
    // Per-account catalogues, then one gated pass that de-duplicates
    // across them — a shopper at three rooftops is one uploadable person.
    const { plans } = await planSegmentAcrossAccounts(
      definition as FilterDefinition,
      selected,
    );
    const fieldsByAccount = new Map<string, FieldDefinition[]>(
      plans.map((plan) => [plan.accountKey, plan.fields]),
    );
    const { breakdown } = await resolveEligibleAcrossAccounts(
      plans.map((plan) => plan.accountKey),
      plans[0]?.definition ?? (definition as FilterDefinition),
      fieldsByAccount,
      { channel },
    );
    // Only the counts cross the wire. The hashed identifiers stay
    // server-side — there is no reason for a browser to hold them, and
    // shipping them would turn a UI request into a data export.
    return NextResponse.json({ breakdown });
  } catch (err) {
    if (err instanceof SegmentRefError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof SegmentLookupError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : 'Failed to resolve eligibility';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
