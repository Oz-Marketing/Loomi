import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getCampaignEngagementById } from '@/lib/services/email-analytics';
import { getEmailBlast } from '@/lib/services/email-blasts';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/blasts/loomi/engagement/[id]?accountKey=
 *
 * Per-campaign engagement KPIs for the sent-campaign detail drawer on
 * the campaigns list. Returns the same shape as one row from
 * /api/blasts/loomi/engagement so the drawer can render KPI cards
 * without pulling the whole account.
 *
 * The recipients counted are scoped exactly as that list endpoint scopes
 * them — the requested `accountKey`, else a scoped user's own accounts, else
 * everyone — so a blast that spans several accounts reads the same in its
 * list row and in its drawer. Unscoped, the numbers cover the whole blast.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
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

  const accountKey = req.nextUrl.searchParams.get('accountKey');
  let recipientScope: string[] | null = null;
  if (accountKey) {
    if (scoped && !userAccountKeys.includes(accountKey)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    recipientScope = [accountKey];
  } else if (scoped) {
    recipientScope = userAccountKeys;
  }

  try {
    const row = await getCampaignEngagementById(id, recipientScope);
    return NextResponse.json({ campaign: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load engagement';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
