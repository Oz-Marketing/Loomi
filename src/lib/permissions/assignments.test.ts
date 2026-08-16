import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * These cover the one thing the assignment layer exists for: a `client`-tier
 * user can never end up holding a non-Reporting role.
 *
 * The resolver already ignores such a row, so this is belt-and-braces — but a
 * stored row that silently does nothing is a trap for whoever reads the table
 * next, and "why does this user have studio.lead but no Studio access" is a bad
 * afternoon. Rejecting the write is what keeps the table honest.
 */

type UserRow = { id: string; role: string; scopeMode: string; accountKeys: string };

let users: UserRow[] = [];
let sectorRoleRows: { id: string; userId: string; sector: string; role: string }[] = [];
let capabilityRows: {
  userId: string;
  capability: string;
  effect: string;
  scopeKey: string;
}[] = [];

const upsertCalls: Record<string, unknown>[] = [];

vi.mock('@/lib/prisma', () => ({
  prisma: {
    // The mocked model methods run eagerly, so by the time the array reaches
    // $transaction the state has already changed — enough to assert ordering
    // and final state, though not real atomicity.
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const user = users.find((u) => u.id === where.id);
        if (!user) return null;
        return {
          ...user,
          sectorRoles: sectorRoleRows
            .filter((r) => r.userId === user.id)
            .map(({ sector, role }) => ({ sector, role })),
          capabilityGrants: capabilityRows
            .filter((c) => c.userId === user.id)
            .map(({ capability, effect, scopeKey }) => ({ capability, effect, scopeKey })),
        };
      }),
    },
    userSectorRole: {
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) =>
        sectorRoleRows.filter((r) => r.userId === where.userId),
      ),
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        upsertCalls.push(args);
        const { userId, sector, role } = args.create as {
          userId: string;
          sector: string;
          role: string;
        };
        const existing = sectorRoleRows.find(
          (r) => r.userId === userId && r.sector === sector,
        );
        if (existing) existing.role = role;
        else
          sectorRoleRows.push({
            id: `sr-${sectorRoleRows.length + 1}`,
            userId,
            sector,
            role,
          });
        return {};
      }),
      deleteMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            userId?: string;
            sector?: string | { in: string[] };
            id?: { in: string[] };
          };
        }) => {
          const before = sectorRoleRows.length;
          sectorRoleRows = sectorRoleRows.filter((r) => {
            if (where.id) return !where.id.in.includes(r.id);
            if (r.userId !== where.userId) return true;
            if (typeof where.sector === 'string') return r.sector !== where.sector;
            if (where.sector?.in) return !where.sector.in.includes(r.sector);
            return false;
          });
          return { count: before - sectorRoleRows.length };
        },
      ),
    },
    userCapabilityGrant: {
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        const created = args.create as {
          userId: string;
          capability: string;
          effect: string;
          scopeKey: string;
        };
        capabilityRows.push(created);
        return {};
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}));

const {
  CAPABILITY_SCOPE_ALL,
  InvalidAssignmentError,
  loadSubject,
  setSectorRole,
  clearSectorRole,
  pruneSectorRolesForTier,
  setCapabilityGrant,
  setUserSectorRoles,
} = await import('./assignments');
const { can } = await import('./registry');

beforeEach(() => {
  users = [
    { id: 'staff-1', role: 'admin', scopeMode: 'all', accountKeys: '[]' },
    {
      id: 'client-1',
      role: 'client',
      scopeMode: 'listed',
      accountKeys: '["youngHonda"]',
    },
  ];
  sectorRoleRows = [];
  capabilityRows = [];
  upsertCalls.length = 0;
});

describe('setSectorRole', () => {
  it('assigns a staff user any sector', async () => {
    await setSectorRole('staff-1', 'studio.designer');
    await setSectorRole('staff-1', 'projects.lead');
    expect(sectorRoleRows.map((r) => `${r.sector}.${r.role}`).sort()).toEqual([
      'projects.lead',
      'studio.designer',
    ]);
  });

  it('replaces rather than duplicates a role in the same sector', async () => {
    await setSectorRole('staff-1', 'studio.designer');
    await setSectorRole('staff-1', 'studio.lead');
    expect(sectorRoleRows).toHaveLength(1);
    expect(sectorRoleRows[0].role).toBe('lead');
  });

  it('lets a client hold a reporting role', async () => {
    await setSectorRole('client-1', 'reporting.client');
    expect(sectorRoleRows).toHaveLength(1);
  });

  it.each(['studio.lead', 'projects.member', 'agency.admin'])(
    'refuses %s for a client tier',
    async (ref) => {
      await expect(setSectorRole('client-1', ref)).rejects.toThrow(InvalidAssignmentError);
      expect(sectorRoleRows).toHaveLength(0);
    },
  );

  it('refuses an unknown role', async () => {
    await expect(setSectorRole('staff-1', 'studio.wizard')).rejects.toThrow(
      InvalidAssignmentError,
    );
    await expect(setSectorRole('staff-1', 'nonsense')).rejects.toThrow(
      InvalidAssignmentError,
    );
  });

  it('refuses an unknown user', async () => {
    await expect(setSectorRole('nobody', 'studio.lead')).rejects.toThrow(
      InvalidAssignmentError,
    );
  });
});

describe('setUserSectorRoles', () => {
  it('replaces the whole set, dropping omitted sectors', async () => {
    await setSectorRole('staff-1', 'studio.lead');
    await setSectorRole('staff-1', 'projects.admin');

    await setUserSectorRoles('staff-1', ['studio.designer', 'reporting.analyst']);

    expect(sectorRoleRows.map((r) => `${r.sector}.${r.role}`).sort()).toEqual([
      'reporting.analyst',
      'studio.designer',
    ]);
  });

  it('clears everything when given an empty list', async () => {
    await setSectorRole('staff-1', 'studio.lead');
    await setUserSectorRoles('staff-1', []);
    expect(sectorRoleRows).toHaveLength(0);
  });

  // Validate-then-write: one bad ref must not leave a half-applied set behind.
  it('writes nothing when any ref is invalid', async () => {
    await setSectorRole('staff-1', 'studio.lead');
    await expect(
      setUserSectorRoles('staff-1', ['reporting.analyst', 'studio.wizard']),
    ).rejects.toThrow(InvalidAssignmentError);

    expect(sectorRoleRows.map((r) => `${r.sector}.${r.role}`)).toEqual(['studio.lead']);
  });

  it('refuses a non-reporting role for a client, changing nothing', async () => {
    await setSectorRole('client-1', 'reporting.client');
    await expect(
      setUserSectorRoles('client-1', ['reporting.client', 'studio.viewer']),
    ).rejects.toThrow(InvalidAssignmentError);

    expect(sectorRoleRows.map((r) => `${r.sector}.${r.role}`)).toEqual([
      'reporting.client',
    ]);
  });

  it.each(['reporting.analyst', 'reporting.admin'])(
    'refuses %s for a client — it would expose Budget',
    async (ref) => {
      await expect(setUserSectorRoles('client-1', [ref])).rejects.toThrow(
        InvalidAssignmentError,
      );
      expect(sectorRoleRows).toHaveLength(0);
    },
  );

  it('refuses two roles for the same sector', async () => {
    await expect(
      setUserSectorRoles('staff-1', ['studio.lead', 'studio.designer']),
    ).rejects.toThrow(InvalidAssignmentError);
  });

  it('does not rewrite rows that are already correct', async () => {
    await setUserSectorRoles('staff-1', ['studio.lead']);
    upsertCalls.length = 0;
    await setUserSectorRoles('staff-1', ['studio.lead']);
    expect(upsertCalls).toHaveLength(0);
  });
});

describe('clearSectorRole', () => {
  it('removes access to just that sector', async () => {
    await setSectorRole('staff-1', 'studio.lead');
    await setSectorRole('staff-1', 'reporting.admin');
    await clearSectorRole('staff-1', 'studio');

    const subject = await loadSubject('staff-1');
    expect(subject!.sectorRoles).toEqual(['reporting.admin']);
    expect(can(subject!, 'studio.access')).toBe(false);
    expect(can(subject!, 'reporting.access')).toBe(true);
  });
});

describe('pruneSectorRolesForTier', () => {
  // Demotion is where stale rows come from: the role column changes, the
  // sector rows don't.
  it('drops the rows a demoted user may no longer hold', async () => {
    await setSectorRole('staff-1', 'studio.lead');
    await setSectorRole('staff-1', 'reporting.client');
    await setSectorRole('staff-1', 'projects.member');

    users.find((u) => u.id === 'staff-1')!.role = 'client';
    const removed = await pruneSectorRolesForTier('staff-1');

    expect(removed).toBe(2);
    expect(sectorRoleRows.map((r) => `${r.sector}.${r.role}`)).toEqual([
      'reporting.client',
    ]);
  });

  // Reporting survives demotion only if the ROLE is client-legal. An Analyst
  // confers budget/executive, so demoting a staff analyst to client must strip
  // it rather than leave a dealer looking at internal figures.
  it('drops a reporting role the client tier may not hold', async () => {
    await setSectorRole('staff-1', 'reporting.analyst');

    users.find((u) => u.id === 'staff-1')!.role = 'client';
    const removed = await pruneSectorRolesForTier('staff-1');

    expect(removed).toBe(1);
    expect(sectorRoleRows).toHaveLength(0);
  });

  it('is a no-op for a user whose roles are all legal', async () => {
    await setSectorRole('staff-1', 'studio.lead');
    expect(await pruneSectorRolesForTier('staff-1')).toBe(0);
  });
});

describe('loadSubject', () => {
  it('reflects stored roles, grants and denies', async () => {
    await setSectorRole('staff-1', 'studio.lead');
    await setCapabilityGrant('staff-1', { capability: 'blast.send' });

    const subject = await loadSubject('staff-1');
    expect(subject!.tier).toBe('staff');
    expect(subject!.scopeMode).toBe('all');
    expect(can(subject!, 'blast.send')).toBe(true);
    expect(can(subject!, 'studio.templates.publish')).toBe(true);
  });

  it('honours a deny row over the role grant', async () => {
    await setSectorRole('staff-1', 'studio.lead');
    capabilityRows.push({
      userId: 'staff-1',
      capability: 'studio.templates.publish',
      effect: 'deny',
      scopeKey: CAPABILITY_SCOPE_ALL,
    });

    const subject = await loadSubject('staff-1');
    expect(can(subject!, 'studio.templates.publish')).toBe(false);
    expect(can(subject!, 'studio.templates.edit')).toBe(true);
  });

  // A grant scoped to one account must not leak across the fleet. The subject
  // is account-agnostic, so it only picks up scoped rows for the account it was
  // loaded for.
  it('applies an account-scoped grant only for that account', async () => {
    await setSectorRole('staff-1', 'studio.lead');
    await setCapabilityGrant('staff-1', {
      capability: 'blast.send',
      scopeKey: 'youngHonda',
    });

    const atGrantedAccount = await loadSubject('staff-1', { accountKey: 'youngHonda' });
    expect(can(atGrantedAccount!, 'blast.send')).toBe(true);

    const elsewhere = await loadSubject('staff-1', { accountKey: 'smithToyota' });
    expect(can(elsewhere!, 'blast.send')).toBe(false);

    // No account named: only global grants count, so this one doesn't apply.
    const unscoped = await loadSubject('staff-1');
    expect(can(unscoped!, 'blast.send')).toBe(false);
  });

  it('applies a global grant regardless of account', async () => {
    await setSectorRole('staff-1', 'studio.lead');
    await setCapabilityGrant('staff-1', { capability: 'blast.send' });

    for (const accountKey of ['youngHonda', 'smithToyota', undefined]) {
      const subject = await loadSubject('staff-1', { accountKey });
      expect(can(subject!, 'blast.send')).toBe(true);
    }
  });

  it('parses the account-key JSON column', async () => {
    const subject = await loadSubject('client-1');
    expect(subject!.accountKeys).toEqual(['youngHonda']);
    expect(subject!.scopeMode).toBe('listed');
  });

  it('returns null for an unknown user', async () => {
    expect(await loadSubject('nobody')).toBeNull();
  });
});

describe('setCapabilityGrant', () => {
  it('refuses a permission that a sector role confers', async () => {
    await expect(
      setCapabilityGrant('staff-1', { capability: 'studio.campaigns.edit' }),
    ).rejects.toThrow(InvalidAssignmentError);
  });

  it('accepts the sensitive capabilities', async () => {
    await setCapabilityGrant('staff-1', {
      capability: 'finance.spend.view',
      reason: 'covers media buying',
    });
    expect(capabilityRows).toHaveLength(1);
  });
});
