import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { canAccessPacer } from '@/lib/meta-ads-pacer';
import {
  MetaSyncError,
  fetchAdSets,
  getAdAccountConfig,
} from '@/lib/integrations/meta-ads';

/**
 * Lists the ad sets under this account's Facebook ad account, so the pacer can
 * offer a picker for linking a pacer row to a specific ad set — the ABO budget
 * level, and the fix for first-sync name-match misses. The parent campaign
 * name rides along so similarly-named ad sets can be told apart. Read-only.
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
    const adSets = await fetchAdSets(cfg, adAccountId);
    return NextResponse.json({
      adSets: adSets.map((s) => ({
        id: s.id,
        name: s.name,
        effectiveStatus: s.effective_status ?? s.status ?? null,
        campaignName: s.campaign?.name ?? null,
      })),
    });
  } catch (err) {
    if (err instanceof MetaSyncError) {
      const status = err.code === 'graph_error' ? 502 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    // eslint-disable-next-line no-console
    console.error('[meta-ads-pacer] meta-adsets failed', err);
    return NextResponse.json({ error: 'Failed to load ad sets' }, { status: 500 });
  }
}
