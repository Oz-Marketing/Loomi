import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, canAccessAccount } from '@/lib/api-auth';
import {
  archiveCampaign,
  restoreCampaign,
  deleteCampaign,
  getCampaignRow,
  getCampaignWithAssets,
  updateCampaign,
} from '@/lib/services/campaigns';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** Shared: load the campaign row + enforce the session's account scope. */
async function authorizeCampaign(
  id: string,
  session: { user: { role: string; accountKeys?: string[] } },
): Promise<{ accountKey: string | null } | NextResponse> {
  const row = await getCampaignRow(id);
  if (!row) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  const scope = getAccountScope(session as Parameters<typeof getAccountScope>[0]);
  if (row.accountKey && !canAccessAccount(scope, row.accountKey)) {
    // Hide existence from out-of-scope callers.
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }
  return { accountKey: row.accountKey };
}

/** GET /api/campaigns/[id] — full container + linked assets + derived status. */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await params;
  const auth = await authorizeCampaign(id, session!);
  if (auth instanceof NextResponse) return auth;

  const campaign = await getCampaignWithAssets(id);
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  return NextResponse.json({ campaign });
}

/** PATCH /api/campaigns/[id] — rename or archive the container. */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await params;
  const auth = await authorizeCampaign(id, session!);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));

  if (body?.archive === true) {
    await archiveCampaign(id);
    const campaign = await getCampaignWithAssets(id);
    return NextResponse.json({ campaign });
  }

  if (body?.archive === false) {
    await restoreCampaign(id);
    const campaign = await getCampaignWithAssets(id);
    return NextResponse.json({ campaign });
  }

  const name = typeof body?.name === 'string' ? body.name : undefined;
  const campaign = await updateCampaign(id, { name });
  return NextResponse.json({ campaign });
}

/**
 * DELETE /api/campaigns/[id] — hard-delete the campaign AND every asset it
 * generated (emails, SMS, landing pages, forms) so they're removed from their
 * channel surfaces too.
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await params;
  const auth = await authorizeCampaign(id, session!);
  if (auth instanceof NextResponse) return auth;

  await deleteCampaign(id);
  return NextResponse.json({ ok: true });
}
