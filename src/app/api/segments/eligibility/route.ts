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
import { requireRole } from '@/lib/api-auth';
import { resolveFilterFields } from '@/lib/services/audience-fields';
import {
  ConsentNotRecordedError,
  resolveEligibleForSync,
  type SyncChannel,
} from '@/lib/segments/eligibility';
import { SegmentRefError } from '@/lib/segments/refs';
import {
  formatFilterErrors,
  validateFilterDefinition,
} from '@/lib/smart-list-validate';

export async function POST(req: Request) {
  const { session, error } = await requireRole(
    'developer',
    'super_admin',
    'admin',
  );
  if (error) return error;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }

  const accountKey =
    typeof body.accountKey === 'string' && body.accountKey.trim()
      ? body.accountKey.trim()
      : '';
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }

  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  if (
    userRole === 'admin' &&
    userAccountKeys.length > 0 &&
    !userAccountKeys.includes(accountKey)
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const fields = await resolveFilterFields(accountKey);
  const validation = validateFilterDefinition(body.definition, fields);
  if (!validation.ok) {
    return NextResponse.json(
      {
        error: `Invalid filter definition — ${formatFilterErrors(validation.errors)}`,
        details: validation.errors,
      },
      { status: 400 },
    );
  }

  const channel: SyncChannel =
    body.channel === 'email' || body.channel === 'phone' ? body.channel : 'any';

  try {
    const { breakdown } = await resolveEligibleForSync(
      accountKey,
      validation.definition,
      fields,
      { channel },
    );
    // Only the counts cross the wire. The hashed identifiers stay
    // server-side — there is no reason for a browser to hold them, and
    // shipping them would turn a UI request into a data export.
    return NextResponse.json({ breakdown });
  } catch (err) {
    if (err instanceof ConsentNotRecordedError) {
      return NextResponse.json(
        { error: err.message, code: 'consent_not_recorded' },
        { status: 409 },
      );
    }
    if (err instanceof SegmentRefError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message =
      err instanceof Error ? err.message : 'Failed to resolve eligibility';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
