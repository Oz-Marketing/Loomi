import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, canAccessAccount } from '@/lib/api-auth';
import { getCampaignRow, updateCampaignPlan } from '@/lib/services/campaigns';
import { CAMPAIGN_PLAN_VERSION, type CampaignPlan } from '@/lib/campaigns/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/campaigns/[id]/plan
 *
 * Persist the user's edited build plan (whole-object replace) during the
 * confirm step — subject tweaks, dropped touches, clarification answers, etc.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await params;
  const row = await getCampaignRow(id);
  if (!row) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

  const scope = getAccountScope(session!);
  if (row.accountKey && !canAccessAccount(scope, row.accountKey)) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const plan = body?.plan as CampaignPlan | undefined;
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.emails) || !Array.isArray(plan.sms)) {
    return NextResponse.json({ error: 'A valid plan object is required' }, { status: 400 });
  }

  // Keep the version stamp consistent regardless of what the client sent.
  await updateCampaignPlan(id, { ...plan, version: CAMPAIGN_PLAN_VERSION });
  return NextResponse.json({ ok: true });
}
