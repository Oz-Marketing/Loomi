/**
 * The offer emails a generate run produced —
 * GET /api/ad-generator/generated-emails?accountKey=…
 *
 * A run makes two things: the ad designs and the companion email carrying the
 * same offers. They already share a `Campaign` container, and for STAFF that
 * container is where a run is read — Campaigns lists it with an Ads tab and an
 * Emails tab.
 *
 * A client cannot go there. `/campaign-builder` is `AdminOnly` and
 * `studio.client` does not carry `studio.campaigns.view`, by design. So the
 * client's own view has to show the email itself, or half of what the run
 * produced is invisible to the person it was produced for.
 *
 * Deliberately NOT campaign management: just enough to render the email as one
 * item in their list. `automationKey` is the filter — set only by the
 * offer-email generator, so it separates machine-made from hand-built without
 * walking the campaign's source.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, getAccountScope, canAccessAccount, forbidden } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const accountKey = (req.nextUrl.searchParams.get('accountKey') || '').trim();
  if (!accountKey) return NextResponse.json({ emails: [] });
  if (!canAccessAccount(getAccountScope(session), accountKey)) return forbidden();

  try {
    const rows = await prisma.emailBlast.findMany({
      where: { automationKey: { not: null } },
      select: {
        id: true,
        name: true,
        subject: true,
        status: true,
        scheduledFor: true,
        updatedAt: true,
        campaignId: true,
        accountKeys: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });

    // `accountKeys` is a JSON array, not a scalar column, so the account filter
    // cannot be pushed into the query. Bounded by `take` above so this stays a
    // handful of rows rather than the whole table.
    const mine = rows.filter((r) => {
      try {
        const keys = JSON.parse(r.accountKeys);
        return Array.isArray(keys) && keys.includes(accountKey);
      } catch {
        return false;
      }
    });

    return NextResponse.json({
      emails: mine.map((r) => ({
        id: r.id,
        subject: r.subject,
        name: r.name,
        status: r.status,
        scheduledFor: r.scheduledFor,
        updatedAt: r.updatedAt,
        campaignId: r.campaignId,
      })),
    });
  } catch (err) {
    // An unmigrated or unreachable table must not take the ad list down with it —
    // the emails are an addition to that page, not its reason for existing.
    console.warn('[api/ad-generator/generated-emails] falling back to []:', err);
    return NextResponse.json({ emails: [] });
  }
}
