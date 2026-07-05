import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getCampaignEngagementById } from '@/lib/services/email-analytics';
import { getEmailBlast } from '@/lib/services/email-blasts';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/blasts/loomi/engagement/[id]
 *
 * Per-campaign engagement KPIs for the sent-campaign detail drawer on
 * the campaigns list. Returns the same shape as one row from
 * /api/blasts/loomi/engagement so the drawer can render KPI cards
 * without pulling the whole account.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;

  const campaign = await getEmailBlast(id);
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  const role = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  const scoped = role === 'client' || (role === 'admin' && userAccountKeys.length > 0);
  if (scoped) {
    const allowed = new Set(userAccountKeys);
    const visible =
      campaign.accountKeys.length === 0 ||
      campaign.accountKeys.some((key) => allowed.has(key));
    if (!visible) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  try {
    const row = await getCampaignEngagementById(id);
    return NextResponse.json({ campaign: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load engagement';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
