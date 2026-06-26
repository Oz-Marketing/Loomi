import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, canAccessAccount } from '@/lib/api-auth';
import { createCampaign, listCampaigns } from '@/lib/services/campaigns';

/**
 * GET /api/campaigns — list campaign containers visible to the session.
 * POST /api/campaigns — create an empty (manual) campaign container.
 *
 * The AI builder creates its container via /api/campaigns/ai/plan; this POST
 * is for the manual step-by-step wizard.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const scope = getAccountScope(session!);
  const includeArchived = new URL(req.url).searchParams.get('archived') === '1';

  const campaigns = await listCampaigns({ accountKeys: scope, includeArchived });
  return NextResponse.json({ campaigns });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
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
