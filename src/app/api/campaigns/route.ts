import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope, canAccessAccount, getAuthSession } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import { campaignAccessFor } from '@/lib/campaigns/access';
import { createCampaign, listCampaigns } from '@/lib/services/campaigns';

/**
 * GET /api/campaigns — list campaign containers visible to the session.
 * POST /api/campaigns — create an empty (manual) campaign container.
 *
 * The AI builder creates its container via /api/campaigns/ai/plan; this POST
 * is for the manual step-by-step wizard.
 */
export async function GET(req: NextRequest) {
  // Deliberately NOT `requirePermission` — see `campaignAccessFor`. Studio
  // enforcement is off, so that helper would fall back to the `management`
  // legacy bucket and 403 the clients this page now exists for.
  const session = await getAuthSession();
  const access = campaignAccessFor(session);
  if (!access.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const scope = getAccountScope(session!);
  const params = new URL(req.url).searchParams;
  const archived = params.get('archived');
  const limitRaw = Number(params.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 50;

  const campaigns = await listCampaigns({
    accountKeys: scope,
    // `only` is the Archived filter; `1` is the old include-everything form.
    archivedOnly: archived === 'only',
    includeArchived: archived === '1',
    limit,
    automationOnly: access.automationOnly,
  });
  // `hasMore` lets the list offer "Load more" without a second count query.
  return NextResponse.json({ campaigns, hasMore: campaigns.length >= limit, limit });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requirePermission('studio.campaigns.edit');
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const accountKey = typeof body?.accountKey === 'string' ? body.accountKey.trim() : '';
  const goal = typeof body?.goal === 'string' ? body.goal.trim() : '';

  if (!accountKey) {
    return NextResponse.json(
      { error: 'Select an account before building a campaign' },
      { status: 400 },
    );
  }

  const scope = getAccountScope(session!);
  if (!canAccessAccount(scope, accountKey)) {
    return NextResponse.json({ error: 'Forbidden account selection' }, { status: 403 });
  }

  try {
    const campaign = await createCampaign({
      name: name || 'New campaign',
      accountKey,
      source: 'manual',
      goal: goal || null,
      createdByUserId: session!.user.id,
      createdByRole: session!.user.role,
    });
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create campaign';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
