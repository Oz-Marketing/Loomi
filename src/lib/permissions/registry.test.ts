import { describe, it, expect } from 'vitest';
import {
  ROLE_PERMISSIONS,
  PERMISSIONS,
  SECTORS,
  SECTOR_ROLES,
  SENSITIVE_CAPABILITIES,
  accessibleSectors,
  assignableRolesForTier,
  assignableSectorsForTier,
  can,
  canTierHoldRole,
  canTierHoldSector,
  parseSectorRoleRef,
  resolvePermissions,
  sectorRoleRef,
  type Permission,
  type PermissionSubject,
  type SectorRoleRef,
} from './registry';
import {
  LEGACY_GUARD,
  findPermissionsMissingLegacyGuard,
  legacyCan,
  legacySectorRolesFor,
  legacyTierFor,
} from './legacy';
import type { UserRole } from '@/lib/roles';

function subject(over: Partial<PermissionSubject> = {}): PermissionSubject {
  return {
    tier: 'staff',
    sectorRoles: [],
    scopeMode: 'all',
    accountKeys: [],
    ...over,
  };
}

describe('registry integrity', () => {
  it('gives every sector role a permission set', () => {
    const refs: SectorRoleRef[] = SECTORS.flatMap((s) =>
      (SECTOR_ROLES[s] as readonly string[]).map((r) => sectorRoleRef(s, r)),
    );
    for (const ref of refs) {
      expect(ROLE_PERMISSIONS[ref], `missing permissions for ${ref}`).toBeDefined();
    }
  });

  it('only grants permissions that exist', () => {
    const known = new Set<string>(PERMISSIONS);
    for (const [ref, granted] of Object.entries(ROLE_PERMISSIONS)) {
      for (const p of granted) {
        expect(known.has(p), `${ref} grants unknown permission ${p}`).toBe(true);
      }
    }
  });

  it('grants every role its own sector and no other', () => {
    for (const [ref, granted] of Object.entries(ROLE_PERMISSIONS)) {
      const sector = parseSectorRoleRef(ref)!.sector;
      expect(granted, `${ref} must grant ${sector}.access`).toContain(
        `${sector}.access`,
      );
      for (const p of granted) {
        expect(
          p.startsWith(`${sector}.`),
          `${ref} leaks a cross-sector permission: ${p}`,
        ).toBe(true);
      }
    }
  });

  // The whole point of the sensitive tier: no amount of sector role gets you
  // there. If this ever fails, a blast/PII/finance action became inheritable.
  it('never confers a sensitive capability through a sector role', () => {
    for (const [ref, granted] of Object.entries(ROLE_PERMISSIONS)) {
      for (const capability of SENSITIVE_CAPABILITIES) {
        expect(
          granted.includes(capability),
          `${ref} must not confer ${capability}`,
        ).toBe(false);
      }
    }
  });

  it('declares a legacy guard for every permission', () => {
    expect(findPermissionsMissingLegacyGuard()).toEqual([]);
    expect(Object.keys(LEGACY_GUARD).sort()).toEqual([...PERMISSIONS].sort());
  });
});

describe('client tier is confined to reporting', () => {
  it('allows only the reporting sector', () => {
    expect(assignableSectorsForTier('client')).toEqual(['reporting']);
    expect(canTierHoldSector('client', 'studio')).toBe(false);
    expect(canTierHoldSector('client', 'projects')).toBe(false);
    expect(canTierHoldSector('client', 'agency')).toBe(false);
  });

  it('lets staff into every sector', () => {
    expect(assignableSectorsForTier('staff')).toEqual(SECTORS);
  });

  // A user demoted to `client` may still have stale UserSectorRole rows. The
  // resolver must ignore them rather than keep honouring Studio access.
  it('ignores a stale non-reporting role on a client', () => {
    const s = subject({
      tier: 'client',
      sectorRoles: ['studio.lead', 'reporting.client'],
    });
    expect(can(s, 'studio.templates.edit')).toBe(false);
    expect(can(s, 'reporting.report.view')).toBe(true);
    expect(accessibleSectors(s)).toEqual(['reporting']);
  });

  it('keeps budget and executive away from reporting.client', () => {
    const s = subject({ tier: 'client', sectorRoles: ['reporting.client'] });
    expect(can(s, 'reporting.budget.view')).toBe(false);
    expect(can(s, 'reporting.executive.view')).toBe(false);
    expect(can(s, 'finance.spend.view')).toBe(false);
  });

  // Sector alone is too loose a bound: reporting.analyst and reporting.admin
  // both confer budget/executive, so a client holding one would see internal
  // figures without ever leaving the Reporting sector.
  it('bars a client from the reporting roles that confer budget', () => {
    expect(assignableRolesForTier('client', 'reporting')).toEqual(['client', 'viewer']);
    expect(canTierHoldRole('client', 'reporting', 'analyst')).toBe(false);
    expect(canTierHoldRole('client', 'reporting', 'admin')).toBe(false);
    expect(canTierHoldRole('client', 'reporting', 'client')).toBe(true);
    expect(canTierHoldRole('client', 'reporting', 'viewer')).toBe(true);
  });

  it('ignores a stale reporting.analyst left on a demoted client', () => {
    const s = subject({ tier: 'client', sectorRoles: ['reporting.analyst'] });
    expect(can(s, 'reporting.budget.view')).toBe(false);
    expect(can(s, 'reporting.executive.view')).toBe(false);
    // The row confers nothing at all, so the sector drops out entirely.
    expect(accessibleSectors(s)).toEqual([]);
  });

  it('still lets staff hold every reporting role', () => {
    expect(assignableRolesForTier('staff', 'reporting')).toEqual([
      'admin',
      'analyst',
      'client',
      'viewer',
    ]);
  });

  // Every capability a client CAN reach, enumerated. If a future role edit
  // widens this, the diff says so out loud.
  it('bounds the total permission set a client can ever hold', () => {
    const reachable = new Set<Permission>();
    for (const role of assignableRolesForTier('client', 'reporting')) {
      const s = subject({
        tier: 'client',
        sectorRoles: [sectorRoleRef('reporting', role)],
      });
      for (const p of resolvePermissions(s)) reachable.add(p);
    }
    expect([...reachable].sort()).toEqual(['reporting.access', 'reporting.report.view']);
  });
});

describe('resolution', () => {
  it('unions across sectors', () => {
    const s = subject({ sectorRoles: ['studio.designer', 'reporting.analyst'] });
    expect(can(s, 'studio.adgen.edit')).toBe(true);
    expect(can(s, 'reporting.budget.view')).toBe(true);
    // designer stops short of outbound
    expect(can(s, 'studio.campaigns.publish')).toBe(false);
  });

  it('adds explicitly granted capabilities', () => {
    const base = subject({ sectorRoles: ['studio.lead'] });
    expect(can(base, 'blast.send')).toBe(false);
    const granted = subject({ sectorRoles: ['studio.lead'], allows: ['blast.send'] });
    expect(can(granted, 'blast.send')).toBe(true);
  });

  it('lets a deny beat both a role grant and an explicit allow', () => {
    const s = subject({
      sectorRoles: ['studio.lead'],
      allows: ['blast.send'],
      denies: ['blast.send', 'studio.templates.publish'],
    });
    expect(can(s, 'blast.send')).toBe(false);
    expect(can(s, 'studio.templates.publish')).toBe(false);
  });

  it('gives developer everything as break-glass', () => {
    const s = subject({ tier: 'developer', sectorRoles: [] });
    expect(resolvePermissions(s).size).toBe(PERMISSIONS.length);
    expect(can(s, 'user.impersonate')).toBe(true);
  });

  it('reports no accessible sector for a user with no roles', () => {
    expect(accessibleSectors(subject())).toEqual([]);
  });
});

describe('account scope', () => {
  const s = (over: Partial<PermissionSubject>) =>
    subject({ sectorRoles: ['studio.lead'], ...over });

  it('admits any account under scopeMode all', () => {
    expect(can(s({ scopeMode: 'all' }), 'studio.campaigns.edit', 'youngHonda')).toBe(
      true,
    );
  });

  it('admits only listed accounts under scopeMode listed', () => {
    const scoped = s({ scopeMode: 'listed', accountKeys: ['youngHonda'] });
    expect(can(scoped, 'studio.campaigns.edit', 'youngHonda')).toBe(true);
    expect(can(scoped, 'studio.campaigns.edit', 'smithToyota')).toBe(false);
  });

  // The ambiguity scopeMode exists to retire: `listed` + empty is NOTHING,
  // never "everything".
  it('grants nothing for listed with an empty key list', () => {
    const none = s({ scopeMode: 'listed', accountKeys: [] });
    expect(can(none, 'studio.campaigns.edit', 'youngHonda')).toBe(false);
    expect(can(none, 'studio.campaigns.edit')).toBe(false);
  });
});

/**
 * What actually changes for a real user when the enforcement flags flip.
 *
 * For each legacy role: the permissions they hold today (via the legacy
 * buckets) vs the permissions the backfilled sector roles give them. This is
 * the check that turned up two problems the design docs had missed — `admin`
 * silently GAINING `agency.users.manage`, and `admin` silently losing nine
 * Projects and Reporting permissions — so it earns its place as a standing
 * test rather than a one-off script.
 */
describe('enforcement flip: access delta per legacy role', () => {
  function delta(role: UserRole) {
    const today = new Set(PERMISSIONS.filter((p) => legacyCan(role, p)));
    const next = resolvePermissions({
      tier: legacyTierFor(role),
      sectorRoles: legacySectorRolesFor(role),
      scopeMode: 'all',
      accountKeys: [],
    });
    return {
      gained: [...next].filter((p) => !today.has(p)).sort(),
      lost: [...today].filter((p) => !next.has(p)).sort(),
    };
  }

  // THE rule for this migration. Losing access is a reviewable product
  // decision; gaining it by accident is a security incident, and it nearly
  // happened — `agency.admin` used to carry `agency.users.manage`, which is
  // elevated-only today.
  it.each<UserRole>(['developer', 'super_admin', 'admin', 'client'])(
    'never widens what a %s can do',
    (role) => {
      expect(delta(role).gained).toEqual([]);
    },
  );

  // Staff lose exactly the sensitive capabilities, which Phase 4 re-grants by
  // hand. Nothing else may quietly disappear.
  it('takes only the sensitive capabilities away from staff', () => {
    for (const role of ['super_admin', 'admin'] as UserRole[]) {
      const { lost } = delta(role);
      const nonSensitive = lost.filter((p) => !SENSITIVE_CAPABILITIES.includes(p));
      expect(nonSensitive, `${role} loses non-sensitive permissions`).toEqual([]);
    }
  });

  // The one deliberate removal for external users: today every reporting read
  // is merely "authenticated", so a dealer can reach Budget and Executive.
  // Closing that is the single biggest thing this migration fixes.
  it('closes the client budget/executive hole and nothing more', () => {
    expect(delta('client').lost).toEqual([
      'reporting.budget.view',
      'reporting.executive.view',
    ]);
  });
});

describe('legacy backfill', () => {
  it('maps old roles to tiers', () => {
    expect(legacyTierFor('developer')).toBe('developer');
    expect(legacyTierFor('super_admin')).toBe('staff');
    expect(legacyTierFor('admin')).toBe('staff');
    expect(legacyTierFor('client')).toBe('client');
  });

  it('backfills a client into reporting only', () => {
    expect(legacySectorRolesFor('client')).toEqual(['reporting.client']);
  });

  // Every backfilled role must be legal for the tier it lands on, or Phase 1
  // writes rows the resolver then silently drops.
  it('produces assignments legal for their tier', () => {
    for (const role of ['developer', 'super_admin', 'admin', 'client'] as const) {
      const tier = legacyTierFor(role);
      for (const ref of legacySectorRolesFor(role)) {
        const parsed = parseSectorRoleRef(ref);
        expect(parsed, `${ref} is not a valid ref`).not.toBeNull();
        expect(
          canTierHoldRole(tier, parsed!.sector, parsed!.role),
          `${role} backfilled to ${ref}, illegal for tier ${tier}`,
        ).toBe(true);
      }
    }
  });

  // Phase 0 promises "no behaviour change". The legacy buckets are what deliver
  // that, so pin the three that are NOT plain management.
  it('pins the non-management legacy guards', () => {
    const expected: Partial<Record<Permission, string>> = {
      'agency.users.manage': 'elevated',
      'agency.platform.configure': 'elevated',
      'finance.markup.manage': 'elevated',
      'user.impersonate': 'developer',
      'reporting.report.view': 'authenticated',
      'reporting.budget.view': 'authenticated',
    };
    for (const [permission, bucket] of Object.entries(expected)) {
      expect(LEGACY_GUARD[permission as Permission]).toBe(bucket);
    }
  });
});

/**
 * Regressions from the pre-staging review. Each of these was a real defect;
 * the tests exist because none of them changes anything visible on screen.
 */
describe('review regressions', () => {
  it('grants nothing when every sector role is revoked', () => {
    // The bug: an empty array fell through to `legacySectorRolesFor(role)`, so
    // setting every dropdown to "No access" handed back the full legacy set.
    const stripped = subject({ tier: 'staff', sectorRoles: [] });
    expect(resolvePermissions(stripped).size).toBe(0);
    expect(accessibleSectors(stripped)).toEqual([]);
    expect(can(stripped, 'studio.templates.edit')).toBe(false);
  });

  it('applies an account-scoped capability only on that account', () => {
    const s = subject({
      sectorRoles: ['studio.lead'],
      scopedAllows: { youngHonda: ['blast.send'] },
    });
    expect(can(s, 'blast.send', 'youngHonda')).toBe(true);
    expect(can(s, 'blast.send', 'smithToyota')).toBe(false);
    // Account-agnostic question: a grant tied to one rooftop isn't an answer.
    expect(can(s, 'blast.send')).toBe(false);
  });

  it('applies an account-scoped deny only on that account', () => {
    const s = subject({
      sectorRoles: ['studio.lead'],
      allows: ['blast.send'],
      scopedDenies: { youngHonda: ['blast.send'] },
    });
    expect(can(s, 'blast.send', 'youngHonda')).toBe(false);
    expect(can(s, 'blast.send', 'smithToyota')).toBe(true);
  });
});
