import { NextRequest, NextResponse } from 'next/server';
import { parseBlastAccountKeys } from '@/lib/services/blast-account-keys';
import { requirePermission } from '@/lib/permissions/require';
import { BlastNotDraftError } from '@/lib/services/email-blasts';
import { getSmsBlast, updateSmsBlastDraft } from '@/lib/services/sms-blasts';
import { deleteBlastWithLinkedChannels } from '@/lib/services/blast-linked';
import { canReadBlast } from '@/lib/messaging/blast-access';
import { isEditableBlastStatus, lockedBlastMessage } from '@/lib/messaging/blast-builder-steps';
import { mergeBlastMetadata, readMetadataPatch } from '@/lib/messaging/blast-metadata';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET /api/blasts/sms/[id] — fetch a single SMS campaign (incl. drafts). */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requirePermission(['studio.email.view', 'reporting.report.view']);
  if (error) return error;

  const { id } = await params;
  const campaign = await getSmsBlast(id);
  // Same scope rule as the email route — see canReadBlast.
  if (!campaign || !canReadBlast(session!.user, campaign.accountKeys)) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  return NextResponse.json({ campaign });
}

/**
 * PATCH /api/blasts/sms/[id] — merge-update a draft.
 *
 * Same contract as the email route: `metadataPatch` merges into the stored
 * metadata, and only a draft may change anything but its name (409 otherwise).
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requirePermission('studio.email.edit');
  if (error) return error;

  const { id } = await params;
  const existing = await getSmsBlast(id);
  if (!existing) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  if (userRole === 'admin' && userAccountKeys.length > 0) {
    const allowed = new Set(userAccountKeys);
    const inScope =
      existing.accountKeys.length === 0 ||
      existing.accountKeys.some((key) => allowed.has(key));
    if (!inScope) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const patch: Parameters<typeof updateSmsBlastDraft>[1] = {};

  if (typeof body?.name === 'string') patch.name = body.name;
  if (typeof body?.message === 'string') patch.message = body.message;
  if (typeof body?.sourceAudienceId === 'string' || body?.sourceAudienceId === null) {
    patch.sourceAudienceId = body.sourceAudienceId || null;
  }
  if (typeof body?.sourceFilter === 'string' || body?.sourceFilter === null) {
    patch.sourceFilter = body.sourceFilter || null;
  }
  if (typeof body?.sourceListId === 'string' || body?.sourceListId === null) {
    patch.sourceListId = body.sourceListId || null;
  }
  if (typeof body?.sourceContactIds === 'string' || body?.sourceContactIds === null) {
    patch.sourceContactIds = body.sourceContactIds || null;
  }
  if (typeof body?.metadata === 'string' || body?.metadata === null) {
    patch.metadata = body.metadata || null;
  }
  const metadataPatch = readMetadataPatch(body?.metadataPatch);
  if (metadataPatch) {
    const base = patch.metadata !== undefined ? patch.metadata : existing.metadata;
    patch.metadata = mergeBlastMetadata(base, metadataPatch);
  }
  if (Array.isArray(body?.accountKeys)) {
    // Moving a blast to "no account" would list it in every account.
    const parsedKeys = parseBlastAccountKeys(body.accountKeys);
    if (!parsedKeys.ok) {
      return NextResponse.json({ error: parsedKeys.error }, { status: 400 });
    }
    patch.accountKeys = parsedKeys.keys;
    if (userRole === 'admin' && userAccountKeys.length > 0) {
      const allowed = new Set(userAccountKeys);
      const disallowed = patch.accountKeys.find((k) => !allowed.has(k));
      if (disallowed) {
        return NextResponse.json({ error: 'Forbidden account selection' }, { status: 403 });
      }
    }
  }

  // A rename is allowed at any status; everything else needs a draft.
  const changesContent = Object.keys(patch).some((key) => key !== 'name');
  if (changesContent && !isEditableBlastStatus(existing.status)) {
    return NextResponse.json(
      { error: lockedBlastMessage(existing.status), code: 'blast_locked' },
      { status: 409 },
    );
  }

  try {
    const updated = await updateSmsBlastDraft(id, patch, { requireDraft: changesContent });
    return NextResponse.json({ campaign: updated });
  } catch (err) {
    if (err instanceof BlastNotDraftError) {
      return NextResponse.json(
        { error: lockedBlastMessage('scheduled'), code: 'blast_locked' },
        { status: 409 },
      );
    }
    const message = err instanceof Error ? err.message : 'Failed to update campaign';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/blasts/sms/[id] — hard-delete a Loomi SMS campaign, and the
 * email half when it is one side of an Email + Text pair. Refused (409) while
 * either half is still scheduled or sending.
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requirePermission('studio.email.edit');
  if (error) return error;

  const { id } = await params;
  const existing = await getSmsBlast(id);
  if (!existing) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  if (userRole === 'admin' && userAccountKeys.length > 0) {
    const allowed = new Set(userAccountKeys);
    const inScope =
      existing.accountKeys.length === 0 ||
      existing.accountKeys.some((key) => allowed.has(key));
    if (!inScope) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  try {
    const result = await deleteBlastWithLinkedChannels('sms', id);
    return NextResponse.json({
      ok: true,
      ...(result.partnerError ? { partnerError: result.partnerError } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete campaign';
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
