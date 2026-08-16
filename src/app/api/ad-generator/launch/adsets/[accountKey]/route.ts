/**
 * Ad sets a sub-account can launch into —
 * GET /api/ad-generator/launch/adsets/[accountKey]
 *
 * Backs the target picker. Each row carries its campaign's special ad categories,
 * because that is what decides whether a financing ad may join it — the category
 * lives on the campaign and cannot be changed after creation, so the picker has to
 * show it rather than let someone find out at publish time.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, getAccountScope, canAccessAccount, forbidden } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { getMetaConfig, listAdSetsForPublish } from '@/lib/integrations/meta-ads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ accountKey: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requirePermission('studio.adgen.view');
  if (error) return error;
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { accountKey } = await params;
  if (!canAccessAccount(getAccountScope(session), accountKey)) return forbidden();

  const account = await prisma.account
    .findUnique({ where: { key: accountKey }, select: { metaAdAccountId: true } })
    .catch(() => null);
  if (!account?.metaAdAccountId) {
    return NextResponse.json({ adSets: [], blocked: 'This sub-account has no Meta ad account set.' });
  }
  const cfg = getMetaConfig();
  if (!cfg) {
    return NextResponse.json({
      adSets: [],
      blocked: 'META_SYSTEM_USER_TOKEN is not configured in this environment.',
    });
  }

  try {
    return NextResponse.json({ adSets: await listAdSetsForPublish(cfg, account.metaAdAccountId), blocked: null });
  } catch (err) {
    return NextResponse.json({
      adSets: [],
      blocked: err instanceof Error ? err.message : 'Could not list ad sets.',
    });
  }
}
