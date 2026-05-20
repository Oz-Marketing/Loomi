import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import {
  deleteEmailCampaign,
  getEmailCampaign,
  updateEmailCampaignDraft,
} from '@/lib/services/email-campaigns';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/campaigns/email/[id]
 *
 * Fetch a single campaign (including drafts). Used by each step of the
 * campaign builder to hydrate the form.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin', 'client');
  if (error) return error;

  const { id } = await params;
  const campaign = await getEmailCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  // Clients can only see campaigns scoped to one of their accounts.
  if (session!.user.role === 'client') {
    const allowed = new Set(session!.user.accountKeys ?? []);
    const visible = campaign.accountKeys.some((key) => allowed.has(key));
    if (!visible) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
  }

  return NextResponse.json({ campaign });
}

/**
 * PATCH /api/campaigns/email/[id]
 *
 * Merge-update a campaign draft. Each step of the builder PATCHes its own
 * slice of fields (recipients step → accountKeys/sourceAudienceId/sourceFilter,
 * template step → htmlContent/subject/etc., schedule step → scheduledFor + status).
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await params;
  const existing = await getEmailCampaign(id);
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
  const patch: Parameters<typeof updateEmailCampaignDraft>[1] = {};

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
  if (typeof body?.metadata === 'string' || body?.metadata === null) {
    patch.metadata = body.metadata || null;
  }
  if (Array.isArray(body?.accountKeys)) {
    patch.accountKeys = (body.accountKeys as unknown[]).filter(
      (k): k is string => typeof k === 'string' && k.length > 0,
    );
    if (userRole === 'admin' && userAccountKeys.length > 0) {
      const allowed = new Set(userAccountKeys);
      const disallowed = patch.accountKeys.find((key) => !allowed.has(key));
      if (disallowed) {
        return NextResponse.json({ error: 'Forbidden account selection' }, { status: 403 });
      }
    }
  }

  try {
    const updated = await updateEmailCampaignDraft(id, patch);
    return NextResponse.json({ campaign: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update campaign';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/campaigns/email/[id]
 *
 * Hard-delete a Loomi-native email campaign + its recipient rows. Used by
 * the campaigns-list bulk-actions dock. In-flight campaigns
 * (queued/processing) cannot be deleted — the service throws and we 409.
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await params;
  const existing = await getEmailCampaign(id);
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
    await deleteEmailCampaign(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete campaign';
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
