import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, canAccessAccount } from '@/lib/api-auth';
import { buildAccountContextForKey } from '@/lib/campaigns/account-context';
import { generateCampaignPlan } from '@/lib/ai/campaign-plan';
import { createCampaign } from '@/lib/services/campaigns';
import { PHASE_2_CHANNELS } from '@/lib/campaigns/types';

/**
 * POST /api/campaigns/ai/plan
 *
 * The "plan" phase of the AI Campaign Builder. Creates a draft Campaign
 * container, asks Claude for a structured multi-channel build plan grounded in
 * the account's brand context, persists the plan, and returns the container.
 * No assets are created here — that happens at /generate after the user
 * confirms the plan.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const goal = typeof body?.goal === 'string' ? body.goal.trim() : '';
  const accountKey = typeof body?.accountKey === 'string' ? body.accountKey.trim() : '';
  const nameOverride = typeof body?.name === 'string' ? body.name.trim() : '';

  if (!goal) {
    return NextResponse.json({ error: 'A campaign goal is required' }, { status: 400 });
  }
  // The builder is account-scoped — branding, sender identity and contacts all
  // come from a single account. Block planning without one.
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
    const accountContext = await buildAccountContextForKey(accountKey);
    if (accountContext === undefined) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const { name, plan } = await generateCampaignPlan({
      goal,
      accountContext,
      channels: PHASE_2_CHANNELS,
    });

    const campaign = await createCampaign({
      name: nameOverride || name,
      accountKey,
      source: 'ai',
      goal,
      plan,
      contextSnapshot: accountContext,
      createdByUserId: session!.user.id,
      createdByRole: session!.user.role,
    });

    return NextResponse.json({ campaign }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to plan campaign';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
