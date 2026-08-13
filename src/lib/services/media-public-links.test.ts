import { describe, it, expect } from 'vitest';
import {
  generatePublicToken,
  publicLinkPath,
  publicLinkState,
  serializePublicLink,
} from './media-public-links';

const NOW = new Date('2026-08-13T12:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 864e5);

describe('generatePublicToken', () => {
  it('is url-safe and long enough to be unguessable', () => {
    const t = generatePublicToken();
    // 16 random bytes → 22 base64url chars, ~128 bits.
    expect(t).toHaveLength(22);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('does not repeat', () => {
    // Unguessable IS the security model here, so collisions and predictability
    // both matter. A cuid would embed a timestamp and counter; this doesn't.
    const seen = new Set(Array.from({ length: 500 }, generatePublicToken));
    expect(seen.size).toBe(500);
  });
});

describe('publicLinkState', () => {
  it('is active with no expiry — the default and the point', () => {
    expect(publicLinkState({ revokedAt: null, expiresAt: null }, NOW)).toBe('active');
  });

  it('is active while the expiry is in the future', () => {
    expect(publicLinkState({ revokedAt: null, expiresAt: inDays(1) }, NOW)).toBe('active');
  });

  it('is expired once the moment passes, inclusive', () => {
    expect(publicLinkState({ revokedAt: null, expiresAt: NOW }, NOW)).toBe('expired');
    expect(publicLinkState({ revokedAt: null, expiresAt: inDays(-1) }, NOW)).toBe('expired');
  });

  it('reports revoked ahead of expired', () => {
    // Someone pulled it deliberately; that's the more meaningful fact, and it's
    // what the audit trail is for.
    expect(publicLinkState({ revokedAt: inDays(-2), expiresAt: inDays(-1) }, NOW)).toBe('revoked');
  });
});

describe('publicLinkPath', () => {
  it('is short, because these get pasted into emails', () => {
    expect(publicLinkPath('abc123')).toBe('/m/abc123');
  });
});

describe('serializePublicLink', () => {
  const base = {
    id: 'tok',
    label: 'Print vendor',
    expiresAt: null,
    revokedAt: null,
    accessCount: 3,
    lastAccessedAt: inDays(-1),
    createdByName: 'Connor',
    createdAt: inDays(-5),
  };

  it('exposes the token, its path and a resolved state', () => {
    const s = serializePublicLink(base, NOW);
    expect(s).toMatchObject({ token: 'tok', path: '/m/tok', state: 'active', accessCount: 3 });
  });

  it('sends dates as ISO strings and keeps nulls null', () => {
    const s = serializePublicLink(base, NOW);
    expect(s.expiresAt).toBeNull();
    expect(s.lastAccessedAt).toBe(inDays(-1).toISOString());
  });

  it('reflects a revoked link rather than hiding it', () => {
    // Revoked links stay listed: who shared what, and when it was pulled, is
    // the record the row exists for.
    expect(serializePublicLink({ ...base, revokedAt: inDays(-1) }, NOW).state).toBe('revoked');
  });
});
