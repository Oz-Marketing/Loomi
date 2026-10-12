import { NextRequest, NextResponse } from 'next/server';
import { parseBlastAccountKeys } from '@/lib/services/blast-account-keys';
import { requirePermission } from '@/lib/permissions/require';
import {
  BlastNotDraftError,
  getEmailBlast,
  updateEmailBlastDraft,
} from '@/lib/services/email-blasts';
import { deleteBlastWithLinkedChannels } from '@/lib/services/blast-linked';
import { canReadBlast } from '@/lib/messaging/blast-access';
import { isEditableBlastStatus, lockedBlastMessage } from '@/lib/messaging/blast-builder-steps';
import { mergeBlastMetadata, readMetadataPatch } from '@/lib/messaging/blast-metadata';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/blasts/email/[id]
 *
 * Fetch a single campaign (including drafts). Used by each step of the
 * campaign builder to hydrate the form.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requirePermission(['studio.email.view', 'reporting.report.view']);
  if (error) return error;

  const { id } = await params;
  const campaign = await getEmailBlast(id);
  // Out of scope reads as not found, so ids can't be probed across accounts.
  // Account-scoped admins used to be let through here — only clients were
  // checked — while every write route already confined them.
  if (!campaign || !canReadBlast(session!.user, campaign.accountKeys)) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  return NextResponse.json({ campaign });
}

/**
 * PATCH /api/blasts/email/[id]
 *
 * Merge-update a campaign draft. Each step of the builder PATCHes its own
 * slice of fields (recipients step → accountKeys/sourceAudienceId/sourceFilter,
 * template step → htmlContent/subject/etc., schedule step → metadata).
 *
 * `metadataPatch` (an object) merges into the stored metadata instead of
 * replacing it — `null` removes a key. Steps use it for the keys they own, so
 * one step's save can't erase another's (see lib/messaging/blast-metadata).
 *
 * Only a DRAFT may change. Past that, the content, audience and settings are
 * what the worker delivers — or a record of what it delivered — so anything
 * but a rename is refused with 409. The builder pages stop short of this, but
 * they were reachable for any status (Campaign overview, browser Back), and
 * opening a scheduled blast's Message step used to re-sync and overwrite the
 * HTML it was about to send.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requirePermission('studio.email.edit');
  if (error) return error;

  const { id } = await params;
  const existing = await getEmailBlast(id);
  if (!existing) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  // Admins scoped to specific accounts can only edit campaigns in their scope.
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
  const patch: Parameters<typeof updateEmailBlastDraft>[1] = {};

  if (typeof body?.name === 'string') patch.name = body.name;
  if (typeof body?.subject === 'string') patch.subject = body.subject;
  if (typeof body?.previewText === 'string') patch.previewText = body.previewText;
  if (typeof body?.htmlContent === 'string') patch.htmlContent = body.htmlContent;
  if (typeof body?.textContent === 'string') patch.textContent = body.textContent;
  if (typeof body?.sourceType === 'string') patch.sourceType = body.sourceType;
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
    // On top of a full `metadata` in the same request, else of what's stored.
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
      const disallowed = patch.accountKeys.find((key) => !allowed.has(key));
      if (disallowed) {
        return NextResponse.json({ error: 'Forbidden account selection' }, { status: 403 });
      }
    }
  }

  // The name is a label, not part of what gets sent, so it may change at any
  // status. Everything else needs a draft.
  const changesContent = Object.keys(patch).some((key) => key !== 'name');
  if (changesContent && !isEditableBlastStatus(existing.status)) {
    return NextResponse.json(
      { error: lockedBlastMessage(existing.status), code: 'blast_locked' },
      { status: 409 },
    );
  }

  try {
    const updated = await updateEmailBlastDraft(id, patch, { requireDraft: changesContent });
    return NextResponse.json({ campaign: updated });
  } catch (err) {
    // A schedule can commit between the status check above and this write.
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
 * DELETE /api/blasts/email/[id]
 *
 * Hard-delete a Loomi-native email campaign + its recipient rows — and, for
 * an Email + Text blast, its linked text half, which the Blasts list hides
 * (lib/services/blast-linked). A blast still scheduled or sending (either
 * half) is refused with 409: cancel it first.
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requirePermission('studio.email.edit');
  if (error) return error;

  const { id } = await params;
  const existing = await getEmailBlast(id);
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
    const result = await deleteBlastWithLinkedChannels('email', id);
    return NextResponse.json({
      ok: true,
      ...(result.partnerError ? { partnerError: result.partnerError } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete campaign';
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
