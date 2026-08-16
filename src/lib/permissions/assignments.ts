/**
 * Reading and writing permission assignments — the `UserSectorRole` and
 * `UserCapabilityGrant` tables. Server-only (imports prisma).
 *
 * The registry says what a role *means*; this says who holds it. Every write
 * goes through here so the tier/sector invariant is enforced in exactly one
 * place: a `client`-tier user can only ever hold a Reporting role.
 *
 * See docs/permissions-architecture.md.
 */
import { prisma } from '@/lib/prisma';
import type { UserRole } from '@/lib/roles';
import {
  CLIENT_ALLOWED_SECTOR_ROLES,
  SENSITIVE_CAPABILITIES,
  canTierHoldRole,
  parseSectorRoleRef,
  sectorRoleRef,
  type Permission,
  type PermissionSubject,
  type PlatformTier,
  type ScopeMode,
  type Sector,
  type SectorRoleRef,
} from './registry';
import { legacyTierFor } from './legacy';
import { recordAudit } from './audit';

/** Thrown for an assignment the model promises cannot exist. */
export class InvalidAssignmentError extends Error {}

const USER_PERMISSION_SELECT = {
  id: true,
  role: true,
  scopeMode: true,
  accountKeys: true,
  sectorRoles: { select: { sector: true, role: true } },
  capabilityGrants: { select: { capability: true, effect: true, scopeKey: true } },
} as const;

function parseAccountKeys(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Build the real subject for a user from their stored assignments.
 *
 * Note this reads `User.accountKeys` straight from the database, which is NOT
 * org-expanded the way a session's copy is (`authOptions.jwt` runs
 * `expandAccountKeysWithDescendants`). Pass `expandAccountKeys` when the answer
 * has to honour an organization-level grant — the default is left un-expanded so
 * this stays a cheap single query for the common "what roles does this user
 * hold" case.
 *
 * Capability grants can be scoped to one account, but `PermissionSubject` is
 * account-agnostic, so a subject is only valid for the account it was loaded
 * for: pass `accountKey` to fold in that account's scoped grants. Without it,
 * only global grants apply — under-granting rather than leaking one account's
 * exception across the whole fleet.
 */
export async function loadSubject(
  userId: string,
  options: {
    expandAccountKeys?: (keys: string[]) => Promise<string[]>;
    /** Fold in grants scoped to this account, alongside the global ones. */
    accountKey?: string;
  } = {},
): Promise<PermissionSubject | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: USER_PERMISSION_SELECT,
  });
  if (!user) return null;

  let accountKeys = parseAccountKeys(user.accountKeys);
  if (options.expandAccountKeys && accountKeys.length > 0) {
    accountKeys = await options.expandAccountKeys(accountKeys);
  }

  const allows: Permission[] = [];
  const denies: Permission[] = [];
  for (const grant of user.capabilityGrants) {
    const isGlobal = grant.scopeKey === CAPABILITY_SCOPE_ALL;
    const appliesHere = isGlobal || grant.scopeKey === options.accountKey;
    if (!appliesHere) continue;
    const capability = grant.capability as Permission;
    (grant.effect === 'deny' ? denies : allows).push(capability);
  }

  return {
    tier: legacyTierFor(user.role as UserRole),
    sectorRoles: user.sectorRoles.map((r) => sectorRoleRef(r.sector as Sector, r.role)),
    allows,
    denies,
    scopeMode: (user.scopeMode === 'all' ? 'all' : 'listed') satisfies ScopeMode,
    accountKeys,
  };
}

/** The tier a user resolves to today, derived from the legacy `role` column. */
export async function tierForUser(userId: string): Promise<PlatformTier | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  return user ? legacyTierFor(user.role as UserRole) : null;
}

export type SectorRoleAssignment = { sector: Sector; role: string };

export async function listSectorRoles(userId: string): Promise<SectorRoleAssignment[]> {
  const rows = await prisma.userSectorRole.findMany({
    where: { userId },
    select: { sector: true, role: true },
    orderBy: { sector: 'asc' },
  });
  return rows.map((r) => ({ sector: r.sector as Sector, role: r.role }));
}

/**
 * Assign (or replace) a user's role in one sector.
 *
 * Rejects a role the tier may not hold, so "client with a Studio grant" can't be
 * persisted by any caller. The resolver ignores such a row anyway, but a stored
 * row that silently does nothing is a trap for whoever reads the table next.
 */
export async function setSectorRole(
  userId: string,
  ref: SectorRoleRef | string,
  options: { grantedById?: string } = {},
): Promise<void> {
  const parsed = parseSectorRoleRef(ref);
  if (!parsed) throw new InvalidAssignmentError(`Unknown sector role: ${ref}`);

  const tier = await tierForUser(userId);
  if (!tier) throw new InvalidAssignmentError(`No such user: ${userId}`);

  if (!canTierHoldRole(tier, parsed.sector, parsed.role)) {
    throw new InvalidAssignmentError(
      `A ${tier}-tier user cannot hold ${ref} — ` +
        `clients may only hold ${CLIENT_ALLOWED_SECTOR_ROLES.join(' or ')}.`,
    );
  }

  await prisma.userSectorRole.upsert({
    where: { userId_sector: { userId, sector: parsed.sector } },
    create: {
      userId,
      sector: parsed.sector,
      role: parsed.role,
      grantedById: options.grantedById ?? null,
    },
    update: { role: parsed.role, grantedById: options.grantedById ?? null },
  });
}

/** Remove a user's role in one sector, revoking access to it entirely. */
export async function clearSectorRole(userId: string, sector: Sector): Promise<void> {
  await prisma.userSectorRole.deleteMany({ where: { userId, sector } });
}

/**
 * Replace a user's whole set of sector roles in one transaction — the shape the
 * Users screen saves in, where an omitted sector means "no access".
 *
 * Validates every ref against the tier BEFORE writing anything, so a form that
 * submits one bad row can't leave the user half-updated.
 */
export async function setUserSectorRoles(
  userId: string,
  refs: (SectorRoleRef | string)[],
  options: { grantedById?: string } = {},
): Promise<void> {
  const tier = await tierForUser(userId);
  if (!tier) throw new InvalidAssignmentError(`No such user: ${userId}`);

  const wanted = new Map<Sector, string>();
  for (const ref of refs) {
    const parsed = parseSectorRoleRef(ref);
    if (!parsed) throw new InvalidAssignmentError(`Unknown sector role: ${ref}`);
    if (!canTierHoldRole(tier, parsed.sector, parsed.role)) {
      throw new InvalidAssignmentError(
        `A ${tier}-tier user cannot hold ${ref} — ` +
          `clients may only hold ${CLIENT_ALLOWED_SECTOR_ROLES.join(' or ')}.`,
      );
    }
    if (wanted.has(parsed.sector)) {
      throw new InvalidAssignmentError(
        `Two roles given for the ${parsed.sector} sector — a user holds at most one.`,
      );
    }
    wanted.set(parsed.sector, parsed.role);
  }

  const existing = await prisma.userSectorRole.findMany({
    where: { userId },
    select: { sector: true, role: true },
  });

  const drop = existing
    .filter((row) => wanted.get(row.sector as Sector) === undefined)
    .map((row) => row.sector);

  const upserts = [...wanted.entries()]
    // Skip rows already correct, so `updatedAt` only moves on a real change.
    .filter(([sector, role]) => existing.find((e) => e.sector === sector)?.role !== role)
    .map(([sector, role]) =>
      prisma.userSectorRole.upsert({
        where: { userId_sector: { userId, sector } },
        create: { userId, sector, role, grantedById: options.grantedById ?? null },
        update: { role, grantedById: options.grantedById ?? null },
      }),
    );

  if (drop.length === 0 && upserts.length === 0) return;

  await prisma.$transaction([
    ...(drop.length
      ? [prisma.userSectorRole.deleteMany({ where: { userId, sector: { in: drop } } })]
      : []),
    ...upserts,
  ]);
}

/**
 * Drop every role a user's tier may no longer hold. Call after changing
 * `User.role` — demoting someone to `client` must not leave Studio and Projects
 * rows behind, even though the resolver would ignore them.
 */
export async function pruneSectorRolesForTier(userId: string): Promise<number> {
  const tier = await tierForUser(userId);
  if (!tier) return 0;

  const rows = await prisma.userSectorRole.findMany({
    where: { userId },
    select: { id: true, sector: true, role: true },
  });
  const illegal = rows
    .filter((r) => !canTierHoldRole(tier, r.sector as Sector, r.role))
    .map((r) => r.id);
  if (illegal.length === 0) return 0;

  const { count } = await prisma.userSectorRole.deleteMany({
    where: { id: { in: illegal } },
  });
  return count;
}

// ── Sensitive capabilities ─────────────────────────────────────────────────

/**
 * The stored `scopeKey` for "everywhere in the user's scope".
 *
 * An empty string rather than null: Postgres treats NULLs as distinct in a
 * UNIQUE constraint, so a nullable `scopeKey` would happily accept both an
 * `allow` and a `deny` row for the same global capability and leave the outcome
 * to insertion order.
 */
export const CAPABILITY_SCOPE_ALL = '';

export type CapabilityGrantInput = {
  capability: Permission;
  effect?: 'allow' | 'deny';
  /** Account key, or `CAPABILITY_SCOPE_ALL` / omitted for everywhere. */
  scopeKey?: string | null;
  grantedById?: string;
  reason?: string;
};

/**
 * Grant or deny a sensitive capability.
 *
 * Restricted to `SENSITIVE_CAPABILITIES`: everything else is conferred by a
 * sector role, and allowing per-user grants of ordinary permissions would make
 * the effective-access question unanswerable from the roles table.
 */
export async function setCapabilityGrant(
  userId: string,
  input: CapabilityGrantInput,
): Promise<void> {
  if (!SENSITIVE_CAPABILITIES.includes(input.capability)) {
    throw new InvalidAssignmentError(
      `${input.capability} is conferred by a sector role, not granted per user.`,
    );
  }

  const scopeKey = input.scopeKey ?? CAPABILITY_SCOPE_ALL;
  const effect = input.effect ?? 'allow';

  await prisma.userCapabilityGrant.upsert({
    where: { userId_capability_scopeKey: { userId, capability: input.capability, scopeKey } },
    create: {
      userId,
      capability: input.capability,
      effect,
      scopeKey,
      grantedById: input.grantedById ?? null,
      reason: input.reason ?? null,
    },
    update: {
      effect,
      grantedById: input.grantedById ?? null,
      reason: input.reason ?? null,
    },
  });
}

export async function revokeCapabilityGrant(
  userId: string,
  capability: Permission,
  scopeKey: string = CAPABILITY_SCOPE_ALL,
): Promise<void> {
  await prisma.userCapabilityGrant.deleteMany({ where: { userId, capability, scopeKey } });
}

/** The global capabilities a user currently holds. */
export async function listCapabilities(userId: string): Promise<Permission[]> {
  const rows = await prisma.userCapabilityGrant.findMany({
    where: { userId, effect: 'allow', scopeKey: CAPABILITY_SCOPE_ALL },
    select: { capability: true },
  });
  const held = new Set(rows.map((r) => r.capability));
  // Registry order, so the UI and the saved array are stable.
  return SENSITIVE_CAPABILITIES.filter((c) => held.has(c));
}

/**
 * Replace a user's whole set of global capability grants — the shape the Users
 * screen saves in, where an unticked box means "revoke".
 *
 * Every add and removal is written to the audit trail. That is the point of the
 * capability tier: `blast.send` appearing on someone's account should be a fact
 * with a name and a timestamp attached, not something that quietly came along
 * with a role.
 *
 * Only touches `scopeKey = ''` rows. Per-account exceptions and `deny` rows are
 * managed separately and would be destroyed by a blanket replace.
 */
export async function setUserCapabilities(
  userId: string,
  capabilities: string[],
  options: { actor?: { id: string; email: string }; reason?: string } = {},
): Promise<void> {
  const wanted = new Set<Permission>();
  for (const raw of capabilities) {
    const capability = raw as Permission;
    if (!SENSITIVE_CAPABILITIES.includes(capability)) {
      throw new InvalidAssignmentError(
        `${raw} is conferred by a sector role, not granted per user.`,
      );
    }
    wanted.add(capability);
  }

  const tier = await tierForUser(userId);
  if (!tier) throw new InvalidAssignmentError(`No such user: ${userId}`);
  // A client holds only Reporting roles, and no sensitive capability belongs to
  // Reporting — so granting one would be meaningless at best.
  if (tier === 'client' && wanted.size > 0) {
    throw new InvalidAssignmentError(
      'Client users cannot hold sensitive capabilities.',
    );
  }

  const existing = await prisma.userCapabilityGrant.findMany({
    where: { userId, effect: 'allow', scopeKey: CAPABILITY_SCOPE_ALL },
    select: { capability: true },
  });
  const held = new Set(existing.map((r) => r.capability));

  const added = [...wanted].filter((c) => !held.has(c));
  const removed = [...held].filter((c) => !wanted.has(c as Permission)) as Permission[];
  if (added.length === 0 && removed.length === 0) return;

  await prisma.$transaction([
    ...(removed.length > 0
      ? [
          prisma.userCapabilityGrant.deleteMany({
            where: {
              userId,
              scopeKey: CAPABILITY_SCOPE_ALL,
              effect: 'allow',
              capability: { in: removed },
            },
          }),
        ]
      : []),
    ...added.map((capability) =>
      prisma.userCapabilityGrant.create({
        data: {
          userId,
          capability,
          effect: 'allow',
          scopeKey: CAPABILITY_SCOPE_ALL,
          grantedById: options.actor?.id ?? null,
          reason: options.reason ?? null,
        },
      }),
    ),
  ]);

  if (!options.actor) return;
  for (const capability of added) {
    void recordAudit({
      kind: 'grant',
      actor: options.actor,
      subjectId: userId,
      permission: capability,
      detail: options.reason ?? null,
    });
  }
  for (const capability of removed) {
    void recordAudit({
      kind: 'revoke',
      actor: options.actor,
      subjectId: userId,
      permission: capability,
      detail: options.reason ?? null,
    });
  }
}
