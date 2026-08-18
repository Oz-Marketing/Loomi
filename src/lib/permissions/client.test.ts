import { describe, it, expect } from 'vitest';
import { roleGrants } from './client';

describe('roleGrants — the client-side UI gate', () => {
  it('grants what the assigned sector role holds in the matrix', () => {
    // The bug this exists for: a Studio Lead was shown "not authorized" on the
    // ad-template page, which their role grants.
    expect(roleGrants({ role: 'staff', sectorRoles: ['studio.lead'] }, 'studio.templates.edit')).toBe(true);
  });

  it('does not grant what the role lacks', () => {
    expect(roleGrants({ role: 'staff', sectorRoles: ['studio.viewer'] }, 'studio.templates.edit')).toBe(false);
  });

  it('treats a pre-field token as granting nothing rather than everything', () => {
    // `undefined` means a token minted before sectorRoles existed. Defaulting it
    // to a legacy role set here would hand out access the matrix never granted.
    expect(roleGrants({ role: 'staff' }, 'studio.templates.edit')).toBe(false);
    expect(roleGrants(null, 'studio.templates.edit')).toBe(false);
  });

  it('honors a deliberate revocation of every role', () => {
    expect(roleGrants({ role: 'staff', sectorRoles: [] }, 'studio.templates.edit')).toBe(false);
  });

  it('will not let a client tier hold a studio role', () => {
    // canTierHoldRole drops the ref, so a stale row cannot confer Studio access.
    expect(roleGrants({ role: 'client', sectorRoles: ['studio.lead'] }, 'studio.templates.edit')).toBe(false);
  });
});
