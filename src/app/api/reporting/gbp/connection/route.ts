/**
 * Connection state for the Business Profile report.
 *
 *   GET    /api/reporting/gbp/connection?accountKey=…   status (+ locations)
 *   POST   /api/reporting/gbp/connection               choose a location
 *   DELETE /api/reporting/gbp/connection?accountKey=…   disconnect
 *
 * STAFF ONLY (`integrations.credentials.manage`) — all three mutate or expose who granted
 * access. The report route is the client-visible half.
 *
 * GET never returns the refresh token: it serializes `GbpConnectionStatus`,
 * which has no token field. Pass `?locations=1` to also fetch the pickable
 * locations, which costs a Google round trip and is only wanted while the
 * picker is open.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope, forbidden } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';
import { GbpError, listAllLocations, normalizeLocationId } from '@/lib/integrations/gbp';
import {
  getConnectionStatus,
  saveLocation,
  clearConnection,
  withAccessToken,
} from '@/lib/integrations/gbp-connection';

export const dynamic = 'force-dynamic';

/** Shared guard: management role + the account is in the caller's scope. */
async function guard(accountKey: string | null) {
  const { session, error } = await requirePermission('integrations.credentials.manage');
  if (error) return { error, session: null };
  if (!accountKey) {
    return {
      error: NextResponse.json({ error: 'accountKey is required' }, { status: 400 }),
      session: null,
    };
  }
  const scope = getAccountScope(session!);
  if (scope !== null && !scope.includes(accountKey)) {
    return { error: forbidden(), session: null };
  }
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true },
  });
  if (!account) {
    return {
      error: NextResponse.json({ error: 'Unknown account' }, { status: 404 }),
      session: null,
    };
  }
  return { error: null, session: session! };
}

export async function GET(req: NextRequest) {
  const accountKey = req.nextUrl.searchParams.get('accountKey');
  const { error } = await guard(accountKey);
  if (error) return error;

  const status = await getConnectionStatus(accountKey!);

  if (req.nextUrl.searchParams.get('locations') !== '1' || !status.connected) {
    return NextResponse.json({ status });
  }

  try {
    const locations = await withAccessToken(accountKey!, (token) => listAllLocations(token));
    return NextResponse.json({ status, locations });
  } catch (err) {
    // The connection exists but Google won't talk to us. Return the status
    // anyway so the UI can show "connected, but…" with a reconnect button
    // rather than collapsing to a bare error.
    const message = err instanceof GbpError ? err.message : 'Could not list locations.';
    const code = err instanceof GbpError ? err.code : 'api_error';
    if (!(err instanceof GbpError)) console.error('[reporting/gbp/connection:list]', err);
    return NextResponse.json({ status, locations: [], error: message, code }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const accountKey = typeof body?.accountKey === 'string' ? body.accountKey : null;
  const { error } = await guard(accountKey);
  if (error) return error;

  const locationId = typeof body?.locationId === 'string' ? body.locationId.trim() : '';
  if (!locationId) {
    return NextResponse.json({ error: 'locationId is required' }, { status: 400 });
  }

  const status = await getConnectionStatus(accountKey!);
  if (!status.connected) {
    return NextResponse.json(
      { error: 'Connect this account to Google first.', code: 'not_connected' },
      { status: 409 },
    );
  }

  try {
    // Re-list rather than trusting the posted name/address: the client could
    // send any label, and the stored name is what the report displays as the
    // location it is reporting on.
    const locations = await withAccessToken(accountKey!, (token) => listAllLocations(token));
    const wanted = normalizeLocationId(locationId);
    const match = locations.find((l) => normalizeLocationId(l.name) === wanted);
    if (!match) {
      return NextResponse.json(
        { error: 'That location is not available on this connection.', code: 'no_location' },
        { status: 400 },
      );
    }

    await saveLocation(accountKey!, {
      id: normalizeLocationId(match.name),
      name: match.title,
      address: match.address,
    });

    return NextResponse.json({ status: await getConnectionStatus(accountKey!) });
  } catch (err) {
    const message = err instanceof GbpError ? err.message : 'Could not save the location.';
    if (!(err instanceof GbpError)) console.error('[reporting/gbp/connection:save]', err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const accountKey = req.nextUrl.searchParams.get('accountKey');
  const { error } = await guard(accountKey);
  if (error) return error;

  // Local only. Deleting the row stops Loomi using the grant, but the dealer's
  // Google account still lists Loomi under third-party access until they remove
  // it there — the UI says so rather than implying we revoked it.
  const removed = await clearConnection(accountKey!);
  return NextResponse.json({ removed, status: await getConnectionStatus(accountKey!) });
}
