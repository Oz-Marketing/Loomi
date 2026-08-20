// POST /api/segments/export
//
// The whole of a segment as CSV — every member, not the page or the
// selection that happens to be on screen. This is the "export this list"
// action on the segments index, in the segment builder, and on the
// filtered Contacts view.
//
// It goes through the server for the same reason /api/contacts/export
// does: taking names, emails and phone numbers out of Loomi is gated by
// `contacts.pii.export` and recorded. It reuses that route's column list
// (`@/lib/contacts/csv`) so the two files are identical, and the segment
// resolver (`@/lib/segments/lookup`) so the rows are exactly the segment's
// members — not whatever a capped browser fetch could see.

import { NextResponse } from 'next/server';
import { requireAllPermissions } from '@/lib/permissions/require';
import { recordCapabilityUse } from '@/lib/permissions/audit';
import {
  buildContactsCsv,
  csvFilenameSlug,
  csvHeaders,
  loadContactsForCsv,
} from '@/lib/contacts/csv';
import { resolveRequestedAccountKeys } from '@/lib/segments/api-scope';
import {
  resolveSegmentMembership,
  resolveSegmentSource,
  SegmentLookupError,
} from '@/lib/segments/lookup';
import { SegmentRefError } from '@/lib/segments/refs';
import { SegmentScanOverflowError } from '@/lib/segments/resolve';

/** Matches /api/contacts/export. A bigger segment has to be narrowed. */
const MAX_ROWS = 50_000;

export async function POST(req: Request) {
  const { session, error } = await requireAllPermissions([
    'studio.contacts.view',
    'contacts.pii.export',
  ]);
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
  if (selected.length === 0) {
    return NextResponse.json({ error: 'No accounts in scope to export' }, { status: 400 });
  }

  try {
    const source = await resolveSegmentSource(
      { segmentId: body.segmentId, definition: body.definition },
      selected,
    );
    const membership = await resolveSegmentMembership(source.definition, selected);

    if (membership.ids.length === 0) {
      return NextResponse.json(
        { error: 'This segment has no members to export.' },
        { status: 400 },
      );
    }
    if (membership.ids.length > MAX_ROWS) {
      return NextResponse.json(
        {
          error: `Export limit is ${MAX_ROWS.toLocaleString()} contacts per request — this segment has ${membership.ids.length.toLocaleString()}.`,
        },
        { status: 400 },
      );
    }

    // Scoped in the query, not filtered after — an id the caller can't
    // reach must not come back at all.
    const contacts = await loadContactsForCsv(membership.ids, selected);
    const csv = buildContactsCsv(contacts);

    const label = source.segment?.name ?? 'custom-filter';
    recordCapabilityUse(
      { id: session!.user.id, email: session!.user.email },
      'contacts.pii.export',
      `Exported ${contacts.length} contact(s) from segment "${label}" to CSV`,
      selected.length === 1 ? selected[0]! : null,
    );

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      status: 200,
      headers: csvHeaders(`${csvFilenameSlug(label)}-${stamp}.csv`),
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
  return err instanceof Error ? err.message : 'Failed to export segment';
}
