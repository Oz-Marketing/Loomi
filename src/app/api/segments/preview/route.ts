// POST /api/segments/preview
//
// Resolve an unsaved filter definition against an account and return an
// EXACT count plus a bounded sample. This is what the segment builder's
// live preview runs on.
//
// It replaces the old approach of pulling `/api/contacts?all=true` into
// the browser and filtering there, which capped at 5,000 contacts and
// reported the size of that sample as the segment's size.

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { SegmentRefError } from '@/lib/segments/refs';
import { resolveFilterFields } from '@/lib/services/audience-fields';
import { previewSegment, SegmentScanOverflowError } from '@/lib/segments/resolve';
import {
  formatFilterErrors,
  validateFilterDefinition,
} from '@/lib/smart-list-validate';

const MAX_SAMPLE = 100;

export async function POST(req: Request) {
  const { session, error } = await requireAuth();
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
  const isPrivileged = userRole === 'developer' || userRole === 'super_admin';
  if (!isPrivileged && !userAccountKeys.includes(accountKey)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // When previewing an existing segment, exclude it from its own
  // referenceable options — a self-reference is an immediate cycle.
  const editingSegmentId =
    typeof body.segmentId === 'string' && body.segmentId.trim()
      ? body.segmentId.trim()
      : null;
  const fields = await resolveFilterFields(accountKey, editingSegmentId);
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

  const sampleSize = Math.max(
    1,
    Math.min(MAX_SAMPLE, Number(body.sampleSize) || 25),
  );

  try {
    const result = await previewSegment(
      accountKey,
      validation.definition,
      fields,
      sampleSize,
    );
    return NextResponse.json({
      count: result.count,
      reachable: result.reachable,
      accountTotal: result.accountTotal,
      contacts: result.contacts,
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
    // A broken segment reference (deleted, cross-account, or a loop) is
    // the author's problem to fix, not a server fault.
    if (err instanceof SegmentRefError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'Failed to resolve segment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
