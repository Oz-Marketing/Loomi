/**
 * Start spending — POST /api/ad-generator/launch/[id]/activate
 *
 * Its own route, its own permission check, its own audit line. This is the one
 * irreversible act in the whole pipeline: everything upstream produces a paused
 * object that costs nothing if it's wrong, and this is where money starts moving.
 * Folding it into the launch call would have made "assemble the campaign" and
 * "commit the budget" the same click, which is exactly the thing worth not doing.
 *
 * `{ status: 'PAUSED' }` pauses it again — the same narrow write, so stopping is as
 * easy as starting.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, getAccountScope, canAccessAccount, forbidden, requireRole } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { getMetaConfig, setObjectStatus } from '@/lib/integrations/meta-ads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const u = session.user as { name?: string | null };

  const { id } = await params;
  let body: { status?: string } = {};
  try {
    body = (await req.json()) as { status?: string };
  } catch {
    body = {};
  }
  const status = body.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE';

  const launch = await prisma.adLaunch.findUnique({ where: { id } }).catch(() => null);
  if (!launch) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canAccessAccount(getAccountScope(session), launch.accountKey)) return forbidden();
  if (launch.status !== 'published') {
    return NextResponse.json(
      { error: `This launch is "${launch.status}" — only a published launch can be activated.` },
      { status: 400 },
    );
  }

  const adIds: string[] = (() => {
    try {
      return Object.values(JSON.parse(launch.platformAdIds ?? '{}') as Record<string, string>);
    } catch {
      return [];
    }
  })();
  if (!adIds.length) return NextResponse.json({ error: 'This launch created no ad to activate.' }, { status: 400 });

  const cfg = getMetaConfig();
  if (!cfg) return NextResponse.json({ error: 'META_SYSTEM_USER_TOKEN is not configured.' }, { status: 400 });

  // Only the AD's status is touched, never the ad set's or the campaign's.
  // Activating an ad set would start every other ad in it too — someone else's
  // budget, on this button.
  const done: string[] = [];
  for (const adId of adIds) {
    try {
      await setObjectStatus(cfg, adId, status);
      done.push(adId);
    } catch (err) {
      return NextResponse.json(
        {
          error: `Facebook refused to set ${adId} to ${status}: ${err instanceof Error ? err.message : 'unknown error'}`,
          activated: done,
        },
        { status: 502 },
      );
    }
  }

  // Recorded on the launch so "who turned this on" has an answer that isn't a
  // Graph API audit log nobody can reach.
  await prisma.adLaunch
    .update({
      where: { id },
      data: { liveStatus: status, liveChangedAt: new Date(), liveChangedBy: u.name ?? null },
    })
    .catch(() => null);

  return NextResponse.json({ ok: true, status, ads: done });
}
