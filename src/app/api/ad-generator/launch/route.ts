/**
 * Publish an ad to Meta — POST /api/ad-generator/launch
 *
 * Body: `{ creativeId }`. Creates the ad PAUSED inside the sub-account's target ad
 * set, back-links it to the pacer, and returns what happened. Everything that can
 * refuse without a platform write refuses first, so a `blocked` response means
 * nothing was created.
 *
 * Runs inline rather than through pg-boss: it's a handful of sequential Graph calls
 * behind an explicit button press, so the person is waiting for the answer and a
 * queued job would only hide it from them. The AdLaunch row is what makes a retry
 * safe, not the transport.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, getAccountScope, canAccessAccount, forbidden, requireRole } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { launchToMeta } from '@/lib/ad-generator/automation/launch-meta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Publishing spends money. Admin-gated, and the launch records who asked.
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const u = session.user as { id?: string; name?: string | null };

  let body: { creativeId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const creativeId = (body.creativeId ?? '').trim();
  if (!creativeId) return NextResponse.json({ error: 'creativeId is required' }, { status: 400 });

  const ad = await prisma.adCreative
    .findUnique({ where: { id: creativeId }, select: { accountKey: true } })
    .catch(() => null);
  if (!ad) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canAccessAccount(getAccountScope(session), ad.accountKey)) return forbidden();

  const result = await launchToMeta({
    creativeId,
    requestedById: u.id ?? null,
    requestedByName: u.name ?? null,
  });

  // `blocked` is a 200 with a body, not a 4xx: it's a normal, expected answer that
  // the UI renders as a checklist, and an error status would push callers into
  // treating a fixable configuration gap as a bug.
  return NextResponse.json({ result });
}
