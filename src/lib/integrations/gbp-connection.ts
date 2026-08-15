/**
 * Persistence for the per-account Business Profile grant.
 *
 * Kept apart from `gbp.ts` (the pure HTTP client) because this is the half that
 * touches the database and the encryption helper. The split is what lets the
 * API client be unit-tested without a database.
 *
 * THE REFRESH TOKEN NEVER LEAVES THIS MODULE. `getConnectionStatus` returns a
 * DTO with no token in it, and that is the only shape any route may serialize.
 * The plaintext token exists only inside `withAccessToken`.
 */
import { prisma } from '@/lib/prisma';
import { encryptToken, decryptToken } from '@/lib/crypto/encryption';
import { GbpError, refreshAccessToken } from './gbp';

/** Everything the UI is allowed to know about a connection. No token. */
export interface GbpConnectionStatus {
  connected: boolean;
  connectedEmail: string | null;
  locationId: string | null;
  locationName: string | null;
  locationAddress: string | null;
  connectedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  /** Connected but no location chosen yet — the picker still has to run. */
  needsLocation: boolean;
}

export async function getConnectionStatus(accountKey: string): Promise<GbpConnectionStatus> {
  const row = await prisma.gbpConnection.findUnique({
    where: { accountKey },
    // Explicit select, so adding a column to the model can never widen what a
    // route returns by accident.
    select: {
      connectedEmail: true,
      locationId: true,
      locationName: true,
      locationAddress: true,
      createdAt: true,
      lastError: true,
      lastErrorAt: true,
    },
  });

  if (!row) {
    return {
      connected: false,
      connectedEmail: null,
      locationId: null,
      locationName: null,
      locationAddress: null,
      connectedAt: null,
      lastError: null,
      lastErrorAt: null,
      needsLocation: false,
    };
  }

  return {
    connected: true,
    connectedEmail: row.connectedEmail,
    locationId: row.locationId,
    locationName: row.locationName,
    locationAddress: row.locationAddress,
    connectedAt: row.createdAt.toISOString(),
    lastError: row.lastError,
    lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
    needsLocation: !row.locationId,
  };
}

/**
 * Store a fresh grant.
 *
 * Reconnecting an account KEEPS its chosen location — the usual reason to
 * reconnect is that the previous grant expired, and making someone re-pick the
 * same listing every time is friction for no safety gain. A different Google
 * identity that cannot see the old location will simply fail on next read, and
 * the picker is always available.
 */
export async function saveConnection(input: {
  accountKey: string;
  refreshToken: string;
  connectedEmail: string | null;
  userId: string | null;
}): Promise<void> {
  const encrypted = encryptToken(input.refreshToken);
  await prisma.gbpConnection.upsert({
    where: { accountKey: input.accountKey },
    create: {
      accountKey: input.accountKey,
      refreshToken: encrypted,
      connectedEmail: input.connectedEmail,
      connectedByUserId: input.userId,
    },
    update: {
      refreshToken: encrypted,
      connectedEmail: input.connectedEmail,
      connectedByUserId: input.userId,
      // A successful reconnect clears the failure that prompted it.
      lastError: null,
      lastErrorAt: null,
    },
  });
}

export async function saveLocation(
  accountKey: string,
  location: { id: string; name: string; address: string | null },
): Promise<void> {
  await prisma.gbpConnection.update({
    where: { accountKey },
    data: {
      locationId: location.id,
      locationName: location.name,
      locationAddress: location.address,
      lastError: null,
      lastErrorAt: null,
    },
  });
}

export async function clearConnection(accountKey: string): Promise<boolean> {
  const deleted = await prisma.gbpConnection.deleteMany({ where: { accountKey } });
  return deleted.count > 0;
}

async function recordError(accountKey: string, message: string): Promise<void> {
  await prisma.gbpConnection
    .update({
      where: { accountKey },
      data: { lastError: message.slice(0, 500), lastErrorAt: new Date() },
    })
    // Never let bookkeeping mask the real failure being reported to the caller.
    .catch(() => undefined);
}

/**
 * Run `fn` with a live access token for the account.
 *
 * Access tokens last an hour and are not worth storing — minting one per
 * request costs a single round trip and removes a whole class of staleness
 * bugs. A failure is recorded on the connection so the UI can tell "never
 * connected" from "stopped working on Tuesday".
 */
export async function withAccessToken<T>(
  accountKey: string,
  fn: (accessToken: string) => Promise<T>,
): Promise<T> {
  const row = await prisma.gbpConnection.findUnique({
    where: { accountKey },
    select: { refreshToken: true },
  });
  if (!row) {
    throw new GbpError('This account is not connected to Google Business Profile.', 'not_connected');
  }

  let refreshToken: string;
  try {
    refreshToken = decryptToken(row.refreshToken);
  } catch {
    // The stored ciphertext no longer decrypts — the encryption secret was
    // rotated without the old value being kept in the rotation list. The grant
    // is unrecoverable; say so plainly instead of reporting a Google error.
    await recordError(accountKey, 'Stored credentials could not be decrypted.');
    throw new GbpError(
      'This account’s stored Google credentials could not be read. Reconnect to restore the report.',
      'auth_expired',
    );
  }

  try {
    const accessToken = await refreshAccessToken(refreshToken);
    return await fn(accessToken);
  } catch (err) {
    if (err instanceof GbpError) await recordError(accountKey, err.message);
    throw err;
  }
}

/** The chosen location, or null when the picker hasn't run yet. */
export async function getLocationId(accountKey: string): Promise<string | null> {
  const row = await prisma.gbpConnection.findUnique({
    where: { accountKey },
    select: { locationId: true },
  });
  return row?.locationId ?? null;
}
