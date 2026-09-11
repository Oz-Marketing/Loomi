import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope, canAccessAccount } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import { buildAccountContextForKey } from '@/lib/campaigns/account-context';
import { generateCampaignIntake } from '@/lib/ai/campaign-intake';
import { PHASE_3_CHANNELS } from '@/lib/campaigns/types';

/**
 * POST /api/campaigns/ai/intake
 *
 * The interview that runs between the opening line and the plan: two to four
 * questions written for this goal and this account, plus the fixed channel
 * question. Creates nothing — the Campaign container is still made by /plan
 * once the answers are in.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requirePermission('studio.campaigns.edit');
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const goal = typeof body?.goal === 'string' ? body.goal.trim() : '';
  const accountKey = typeof body?.accountKey === 'string' ? body.accountKey.trim() : '';

  if (!goal) {
    return NextResponse.json({ error: 'A campaign goal is required' }, { status: 400 });
  }
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

  const accountContext = await buildAccountContextForKey(accountKey);
  if (accountContext === undefined) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  // Never throws — an unusable model response comes back as the fixed set, so
  // the interview always opens.
  const intake = await generateCampaignIntake({
    goal,
    accountContext,
    channels: PHASE_3_CHANNELS,
  });

  return NextResponse.json(intake);
}
