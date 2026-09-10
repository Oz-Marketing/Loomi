import { describe, it, expect } from 'vitest';
import type { Session } from 'next-auth';
import { campaignAccessFor } from './access';

// The client tier's entitlement on Campaigns is the OEM offer runs and nothing
// else. `automationOnly` is what the list filter and the [id] route's 404 both
// key on, so this is the fact that keeps a manual blast or an AI campaign on a
// client's account out of that client's view.
const session = (role: string, sectorRoles: string[] = []): Session =>
  ({ user: { id: 'u1', role, accountKeys: ['acct'], sectorRoles } }) as unknown as Session;

describe('campaignAccessFor', () => {
  it('bounds a client to automation campaigns', () => {
    expect(campaignAccessFor(session('client')).automationOnly).toBe(true);
  });

  it('does not bound staff', () => {
    for (const role of ['admin', 'super_admin', 'developer']) {
      expect(campaignAccessFor(session(role)).automationOnly, role).toBe(false);
    }
  });

  it('denies a missing session outright', () => {
    expect(campaignAccessFor(null)).toEqual({ allowed: false, automationOnly: false });
  });
});
