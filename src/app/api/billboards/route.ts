/**
 * Billboard authoring — POST /api/billboards
 *
 * STAFF ONLY (`reporting.configure`). A board is an agency-managed asset — Oz signs
 * the out-of-home contract — so unlike Marketing Lists this is not a surface a
 * dealer writes to. The read side lives at /api/reporting/billboards and IS
 * client-visible.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope, forbidden } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const VALID_STATUS = ['active', 'archived'];

export async function POST(req: NextRequest) {
  const { session, error } = await requirePermission('reporting.configure');
  if (error) return error;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const accountKey = typeof body.accountKey === 'string' ? body.accountKey.trim() : '';
  if (!accountKey) return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });

  const scope = getAccountScope(session!);
  if (scope !== null && !scope.includes(accountKey)) return forbidden();

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true },
  });
  if (!account) return NextResponse.json({ error: 'Unknown account' }, { status: 404 });

  const lat = Number(body.latitude);
  const lng = Number(body.longitude);
  // A board with no location can't go on a map, and a 0,0 default would put it
  // in the Gulf of Guinea rather than failing visibly.
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: 'latitude and longitude are required' }, { status: 400 });
  }

  const status = typeof body.status === 'string' ? body.status : 'active';
  if (!VALID_STATUS.includes(status)) {
    return NextResponse.json({ error: `status must be one of ${VALID_STATUS.join(', ')}` }, { status: 400 });
  }

  const billboard = await prisma.billboard.create({
    data: {
      accountKey,
      sharedWithChildren: body.sharedWithChildren === true,
      providerName: String(body.providerName ?? '').trim() || 'Unknown provider',
      billboardNumber: String(body.billboardNumber ?? '').trim() || '—',
      artworkUrl: body.artworkUrl ? String(body.artworkUrl) : null,
      facingDirection: body.facingDirection ? String(body.facingDirection) : null,
      avgDailyTraffic: Number.isFinite(Number(body.avgDailyTraffic))
        ? Math.max(0, Math.round(Number(body.avgDailyTraffic)))
        : null,
      pricePerPeriod:
        body.pricePerPeriod === null || body.pricePerPeriod === undefined || body.pricePerPeriod === ''
          ? null
          : Number(body.pricePerPeriod),
      numPeriods: Number.isFinite(Number(body.numPeriods)) ? Math.max(1, Math.round(Number(body.numPeriods))) : 1,
      periodType: String(body.periodType ?? '4-week'),
      expirationDate: body.expirationDate ? new Date(String(body.expirationDate)) : null,
      latitude: lat,
      longitude: lng,
      status,
      notes: body.notes ? String(body.notes) : null,
    },
  });

  return NextResponse.json({ billboard }, { status: 201 });
}
