/**
 * Meta publishing identity — /api/ad-generator/launch/meta-assets/[accountKey]
 *
 * GET  → what the agency token can see for this sub-account's ad account (Pages,
 *        Instagram accounts, pixels), plus whatever is already confirmed.
 * POST → confirm the chosen ids onto the Account.
 *
 * Discovery and confirmation are deliberately separate, and nothing is
 * auto-selected. Across a 38-rooftop multi-brand group the wrong Page publishes a
 * Ford store's ad from the Chevy store's Page — a brand incident that is invisible
 * until somebody notices it in the feed. A name-similarity match is exactly the
 * guess that produces it, so a person picks and the choice is attributed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, getAccountScope, canAccessAccount, forbidden } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { discoverMetaAssets, isMetaConfigured } from '@/lib/integrations/meta-ads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ACCOUNT_SELECT = {
  metaAdAccountId: true,
  metaPageId: true,
  metaInstagramActorId: true,
  metaPixelId: true,
  metaDefaultConversionEvent: true,
  metaAssetsConfirmedBy: true,
  metaAssetsConfirmedAt: true,
} as const;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ accountKey: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requirePermission('studio.adgen.view');
  if (error) return error;
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { accountKey } = await params;
  if (!canAccessAccount(getAccountScope(session), accountKey)) return forbidden();

  const account = await prisma.account
    .findUnique({ where: { key: accountKey }, select: ACCOUNT_SELECT })
    .catch(() => null);
  if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Without an ad account there is nothing to enumerate — and saying so is more
  // useful than an empty list that looks like a permissions problem.
  if (!account.metaAdAccountId) {
    return NextResponse.json({
      confirmed: account,
      assets: { pages: [], instagramAccounts: [], pixels: [], errors: {} },
      blocked: 'This sub-account has no Meta ad account set, so there is nothing to list yet.',
    });
  }
  if (!isMetaConfigured()) {
    return NextResponse.json({
      confirmed: account,
      assets: { pages: [], instagramAccounts: [], pixels: [], errors: {} },
      blocked: 'META_SYSTEM_USER_TOKEN is not configured in this environment.',
    });
  }

  const assets = await discoverMetaAssets(account.metaAdAccountId);
  return NextResponse.json({ confirmed: account, assets, blocked: null });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ accountKey: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requirePermission('studio.adgen.launch');
  if (error) return error;
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const u = session.user as { name?: string | null };

  const { accountKey } = await params;
  if (!canAccessAccount(getAccountScope(session), accountKey)) return forbidden();

  let body: {
    metaPageId?: string | null;
    metaInstagramActorId?: string | null;
    metaPixelId?: string | null;
    metaDefaultConversionEvent?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const clean = (v: string | null | undefined): string | null | undefined =>
    v === undefined ? undefined : typeof v === 'string' && v.trim() ? v.trim() : null;

  const data: Record<string, unknown> = {};
  for (const k of ['metaPageId', 'metaInstagramActorId', 'metaPixelId', 'metaDefaultConversionEvent'] as const) {
    const v = clean(body[k]);
    if (v !== undefined) data[k] = v;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to confirm' }, { status: 400 });
  }
  // Attribution is the point of the confirm step — "which Page does this rooftop
  // post from" is a decision someone will need to re-verify, and an unattributed
  // id is not re-verifiable.
  data.metaAssetsConfirmedBy = u.name ?? null;
  data.metaAssetsConfirmedAt = new Date();

  try {
    const row = await prisma.account.update({
      where: { key: accountKey },
      data,
      select: ACCOUNT_SELECT,
    });
    return NextResponse.json({ ok: true, confirmed: row });
  } catch (err) {
    console.error('[api/ad-generator/launch/meta-assets] confirm failed:', err);
    return NextResponse.json({ error: 'Could not save' }, { status: 500 });
  }
}
