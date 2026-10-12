// POST /api/segments/recipients → `{ total }`
//
// Count the deliverable members of an audience selection, server-side and
// over the WHOLE contact roster — the Recipients step's "sendable recipients"
// number. Pass `limit` (≤ 50) for a sample of ids and names as well; email
// addresses and phone numbers are never returned (lib/messaging/audience-count).
//
// The schedule steps used to do this in the browser against the 5,000
// most-recently-added contacts, so the campaign ceiling was effectively
// applied before the segment filter rather than after it. See
// src/lib/segments/recipients.ts for the full explanation.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { resolveFilterFields } from '@/lib/services/audience-fields';
import {
  resolveRecipients,
  type AudienceSelection,
} from '@/lib/segments/recipients';
import {
  formatFilterErrors,
  validateFilterDefinition,
} from '@/lib/smart-list-validate';
import { projectAudienceCount, requestedSampleSize } from '@/lib/messaging/audience-count';
import { clientErrorMessage } from '@/lib/api-errors';

export async function POST(req: Request) {
  const { session, error } = await requirePermission('studio.segments.edit');
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

  const channel =
    body.channel === 'email' || body.channel === 'sms' ? body.channel : 'any';
  // A count by default. The roster stays on the server: see
  // lib/messaging/audience-count for why rows are no longer returned.
  const sampleSize = requestedSampleSize(body.limit);

  const fields = await resolveFilterFields(accountKey);

  const selection = body.selection as AudienceSelection | undefined;
  if (!selection || typeof selection !== 'object') {
    return NextResponse.json({ error: 'selection is required' }, { status: 400 });
  }

  switch (selection.kind) {
    case 'all':
      break;
    case 'list':
      if (typeof selection.listId !== 'string' || !selection.listId.trim()) {
        return NextResponse.json({ error: 'selection.listId is required' }, { status: 400 });
      }
      break;
    case 'contacts':
      if (!Array.isArray(selection.ids)) {
        return NextResponse.json({ error: 'selection.ids must be an array' }, { status: 400 });
      }
      break;
    case 'filter': {
      const validation = validateFilterDefinition(selection.definition, fields);
      if (!validation.ok) {
        return NextResponse.json(
          {
            error: `Invalid filter definition — ${formatFilterErrors(validation.errors)}`,
            details: validation.errors,
          },
          { status: 400 },
        );
      }
      selection.definition = validation.definition;
      break;
    }
    default:
      return NextResponse.json({ error: 'Unknown selection kind' }, { status: 400 });
  }

  try {
    const result = await resolveRecipients(accountKey, selection, fields, {
      channel,
      limit: sampleSize,
    });
    return NextResponse.json(projectAudienceCount(result, sampleSize));
  } catch (err) {
    const message =
      clientErrorMessage(err, 'Failed to resolve recipients');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
