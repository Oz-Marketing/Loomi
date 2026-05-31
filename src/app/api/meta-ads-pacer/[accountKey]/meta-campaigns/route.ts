import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { canAccessPacer } from '@/lib/meta-ads-pacer';
import {
  MetaSyncError,
  fetchCampaigns,
  getAdAccountConfig,
} from '@/lib/integrations/meta-ads';

/**
 * Lists the Facebook campaigns under this account's ad account, so the pacer
 * can offer a picker for linking a pacer ad to a specific campaign (fixing
 * name-match misses). Read-only.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ accountKey: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { accountKey } = await params;
  if (!canAccessPacer(session, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  try {
    const { cfg, adAccountId } = await getAdAccountConfig(accountKey);
    const campaigns = await fetchCampaigns(cfg, adAccountId);
    return NextResponse.json({
      campaigns: campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        effectiveStatus: c.effective_status ?? c.status ?? null,
      })),
    });
  } catch (err) {
    if (err instanceof MetaSyncError) {
      const status = err.code === 'graph_error' ? 502 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    // eslint-disable-next-line no-console
    console.error('[meta-ads-pacer] meta-campaigns failed', err);
    return NextResponse.json({ error: 'Failed to load campaigns' }, { status: 500 });
  }
}
