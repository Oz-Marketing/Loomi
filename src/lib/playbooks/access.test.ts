/**
 * The Playbooks gate.
 *
 * This one function stands in front of a page that enumerates every account's
 * ad account ids, pixel ids, Google customer ids and sender domains. It runs
 * server-side precisely so a typed URL can't reach that screen while the nav
 * link is hidden — which means the only way to know it still works is a test,
 * because a gate that silently stopped gating looks exactly like one that works.
 *
 * Two conditions, independent, both required: the permission AND the flag (with
 * a developer bypass). The pairing is the part worth pinning — an earlier version
 * checked `MANAGEMENT_ROLES.includes(role)` here while every route beside it
 * checked `agency.subaccounts.view`, so the door had two locks that could drift.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const getAuthSession = vi.fn();
let playbooksFlag = false;

vi.mock('@/lib/api-auth', () => ({
  getAuthSession: () => getAuthSession(),
}));

// A build-time const in the real module, so it has to be mocked rather than
// stubbed through the environment — `PLAYBOOKS_ENABLED` is evaluated at import.
vi.mock('@/lib/feature-flags', () => ({
  get PLAYBOOKS_ENABLED() {
    return playbooksFlag;
  },
  AD_GENERATOR_ENABLED: false,
}));

const { playbooksAllowed } = await import('./access');

/** A session shaped the way `subjectFromSession` reads one. */
function session(role: string, over: Record<string, unknown> = {}) {
  return {
    user: {
      id: 'user_1',
      role,
      accountKeys: [],
      sectorRoles: undefined,
      capabilities: [],
      ...over,
    },
  };
}

beforeEach(() => {
  getAuthSession.mockReset();
  playbooksFlag = false;
});

describe('playbooksAllowed', () => {
  it('refuses an unauthenticated caller', async () => {
    getAuthSession.mockResolvedValue(null);
    expect(await playbooksAllowed()).toBe(false);
  });

  it('refuses a session with no user', async () => {
    getAuthSession.mockResolvedValue({});
    expect(await playbooksAllowed()).toBe(false);
  });

  // The one that matters most: Playbooks lists other people's rooftops.
  it('refuses a client role even with the flag on', async () => {
    playbooksFlag = true;
    getAuthSession.mockResolvedValue(session('client', { accountKeys: ['youngHonda'] }));
    expect(await playbooksAllowed()).toBe(false);
  });

  it('refuses staff while the flag is off', async () => {
    getAuthSession.mockResolvedValue(session('admin'));
    expect(await playbooksAllowed()).toBe(false);
  });

  it('admits staff once the flag is on', async () => {
    playbooksFlag = true;
    getAuthSession.mockResolvedValue(session('admin'));
    expect(await playbooksAllowed()).toBe(true);
  });

  it('admits super_admin once the flag is on', async () => {
    playbooksFlag = true;
    getAuthSession.mockResolvedValue(session('super_admin'));
    expect(await playbooksAllowed()).toBe(true);
  });

  // The bypass exists so the feature can be exercised in production before it
  // ships to anyone else. It must not extend to any other role.
  it('admits a developer with the flag off', async () => {
    getAuthSession.mockResolvedValue(session('developer'));
    expect(await playbooksAllowed()).toBe(true);
  });

  it('does not let the flag alone admit someone without the permission', async () => {
    playbooksFlag = true;
    getAuthSession.mockResolvedValue(session('client'));
    expect(await playbooksAllowed()).toBe(false);
  });
});
