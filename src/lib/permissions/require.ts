/**
 * Server-side permission enforcement. The replacement for `requireRole(...)`.
 *
 *   const { session, error } = await requirePermission('studio.campaigns.publish', {
 *     accountKey,
 *   });
 *   if (error) return error;
 *
 * PHASE 0 BEHAVIOUR (where we are now): every check delegates to the legacy role
 * bucket recorded in `./legacy.ts`, so migrating a route from `requireRole` to
 * `requirePermission` changes nothing at runtime. That is the point — all 242
 * call sites can move first, and semantics flip later, per sector, behind the
 * flags below.
 *
 * See docs/permissions-architecture.md.
 */
import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import type { UserRole } from '@/lib/roles';
import {
  can,
  parseSectorRoleRef,
  type Permission,
  type PermissionSubject,
  type ScopeMode,
  type Sector,
  type SectorRoleRef,
} from './registry';
import { LEGACY_GUARD, legacyCan, legacySectorRolesFor, legacyTierFor } from './legacy';

/**
 * Per-sector enforcement flags. Each sector switches from legacy role buckets to
 * real permission resolution independently, so a mistake is contained to one
 * surface instead of locking everyone out of Loomi.
 *
 * Off unless explicitly `'true'`, matching `src/lib/feature-flags.ts`.
 *
 * Rollout order is Projects → Studio → Agency → Reporting: smallest and
 * staff-only first, and Reporting last because it is the only sector clients
 * enter, so it's the only one where a mistake is externally visible.
 */
export const SECTOR_ENFORCEMENT: Record<Sector, boolean> = {
  projects: process.env.PERMISSIONS_ENFORCE_PROJECTS === 'true',
  studio: process.env.PERMISSIONS_ENFORCE_STUDIO === 'true',
  agency: process.env.PERMISSIONS_ENFORCE_AGENCY === 'true',
  reporting: process.env.PERMISSIONS_ENFORCE_REPORTING === 'true',
};

/**
 * Which sector's flag governs a permission. Sensitive capabilities are
 * cross-sector, so they follow their own flag rather than any one sector's.
 */
function governingSector(permission: Permission): Sector | null {
  const dot = permission.indexOf('.');
  const prefix = permission.slice(0, dot);
  switch (prefix) {
    case 'agency':
    case 'studio':
    case 'reporting':
    case 'projects':
      return prefix;
    default:
      // blast.send, finance.*, contacts.pii.export, user.impersonate, ...
      return null;
  }
}

export const CAPABILITY_ENFORCEMENT =
  process.env.PERMISSIONS_ENFORCE_CAPABILITIES === 'true';

function isEnforced(permission: Permission): boolean {
  const sector = governingSector(permission);
  return sector ? SECTOR_ENFORCEMENT[sector] : CAPABILITY_ENFORCEMENT;
}

/**
 * Build a subject from a session.
 *
 * The sector roles and capability grants ride on the JWT (see
 * `AUTH_USER_SELECT` and the refresh block in `src/lib/auth.ts`), so this is a
 * pure function — no database hit on a guarded request. They refresh on the
 * same five-minute cycle as `role`.
 *
 * The legacy mapping is only a FALLBACK, for a token minted before sector
 * roles were added to it. Getting this wrong is subtle and expensive: deriving
 * roles from `role` would mean every hand-assignment made in Settings → Users
 * was silently ignored the moment enforcement flipped, so a user narrowed to
 * `studio.designer` would still resolve as `studio.lead`.
 */
export function subjectFromSession(session: {
  user: {
    role: UserRole;
    accountKeys?: string[];
    sectorMode?: ScopeMode;
    sectorRoles?: string[];
    capabilities?: string[];
  };
}): PermissionSubject {
  const role = session.user.role;
  const accountKeys = session.user.accountKeys ?? [];

  // `allow:blast.send@youngHonda` — effect, capability, and the account it
  // applies to (empty = everywhere).
  //
  // Scoped grants are kept SEPARATE from global ones rather than flattened.
  // Flattening would turn a grant deliberately limited to one rooftop into a
  // grant on every account the user can reach — the opposite of what the person
  // issuing it asked for.
  const allows: Permission[] = [];
  const denies: Permission[] = [];
  const scopedAllows: Record<string, Permission[]> = {};
  const scopedDenies: Record<string, Permission[]> = {};

  for (const entry of session.user.capabilities ?? []) {
    const [effect, rest] = entry.split(':', 2);
    if (!rest) continue;
    const at = rest.lastIndexOf('@');
    const capability = (at === -1 ? rest : rest.slice(0, at)) as Permission;
    const scopeKey = at === -1 ? '' : rest.slice(at + 1);
    const isDeny = effect === 'deny';

    if (!scopeKey) {
      (isDeny ? denies : allows).push(capability);
      continue;
    }
    const bucket = isDeny ? scopedDenies : scopedAllows;
    (bucket[scopeKey] ??= []).push(capability);
  }

  // `undefined` means the token predates this field — fall back to the legacy
  // mapping so a deploy doesn't lock anyone out mid-session. An EMPTY ARRAY is
  // a real answer: every sector role was revoked, and the user gets nothing.
  const sectorRoles = (session.user.sectorRoles ??
    legacySectorRolesFor(role)) as SectorRoleRef[];

  const legacyUnrestricted =
    role === 'developer' || role === 'super_admin' || role === 'admin';

  return {
    tier: legacyTierFor(role),
    sectorRoles,
    allows,
    denies,
    scopedAllows,
    scopedDenies,
    scopeMode: session.user.sectorMode ?? (legacyUnrestricted ? 'all' : 'listed'),
    accountKeys,
  };
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export function forbidden(permission?: Permission) {
  return NextResponse.json(
    {
      error: 'Forbidden',
      // Naming the missing permission turns "why am I 403ing" from a debugging
      // session into a glance. Safe to expose: it's a capability name, not data.
      ...(permission ? { requiredPermission: permission } : {}),
    },
    { status: 403 },
  );
}

export type PermissionCheckOptions = {
  /** Restrict to one account. Omit for account-agnostic checks. */
  accountKey?: string;
};

/**
 * Some routes genuinely serve two sectors. `GET /api/contacts` backs both the
 * Studio contact list and the Reporting surface's Contacts page, so it has to
 * admit a Studio role OR a Reporting one — guarding it with either alone would
 * lock out half its callers.
 *
 * Passing an array to `requirePermission` means ANY of them suffices. When a
 * route needs several at once, use `requireAllPermissions` — an all-of form
 * spelled differently on purpose, so a bare array always means the same thing.
 */
export type PermissionRequirement = Permission | Permission[];

function asList(requirement: PermissionRequirement): Permission[] {
  return Array.isArray(requirement) ? requirement : [requirement];
}

/**
 * The legacy bucket an ANY-of requirement resolves to: the most permissive of
 * its members, because passing any one of them is enough. Used by the guard
 * below and mirrored by the migration codemod.
 */
const BUCKET_RANK: Record<string, number> = {
  authenticated: 3,
  management: 2,
  elevated: 1,
  developer: 0,
};

type AuthedSession = NonNullable<Awaited<ReturnType<typeof getAuthSession>>>;

/**
 * Discriminated on `error`: when it's null the session and subject are
 * guaranteed. On a 403 the session is still handed back (a 403 means "signed in
 * but not allowed", and callers log who it was), so the error branch keeps them
 * nullable rather than forcing them to null.
 */
type RequireResult =
  | { session: AuthedSession; subject: PermissionSubject; error: null }
  | {
      session: AuthedSession | null;
      subject: PermissionSubject | null;
      error: NextResponse;
    };

/**
 * The single guard every route should use.
 *
 * Returns `error` as a ready-to-return response, matching the shape of
 * `requireRole` and `requireReportingAccess` so migration is mechanical.
 */
export async function requirePermission(
  requirement: PermissionRequirement,
  options: PermissionCheckOptions = {},
): Promise<RequireResult> {
  const session = await getAuthSession();
  if (!session?.user) return { session: null, subject: null, error: unauthorized() };

  const subject = subjectFromSession(session);
  const denied = firstUnmet(session, subject, [requirement], options);
  if (denied) return { session, subject, error: forbidden(denied) };

  return { session, subject, error: null };
}

/**
 * Every requirement must be met. Each element may itself be an ANY-of array.
 *
 * This is how a sensitive capability layers on top of a sector role. Sending a
 * blast needs `studio.email.edit` to reach the campaign AND `blast.send` to put
 * it on the wire:
 *
 *   requireAllPermissions(['studio.email.edit', 'blast.send'])
 *
 * Both matter. `blast.send` alone would admit someone holding the grant but no
 * Studio role; `studio.email.edit` alone is the status quo the capability
 * exists to tighten.
 */
export async function requireAllPermissions(
  requirements: PermissionRequirement[],
  options: PermissionCheckOptions = {},
): Promise<RequireResult> {
  const session = await getAuthSession();
  if (!session?.user) return { session: null, subject: null, error: unauthorized() };

  const subject = subjectFromSession(session);
  const denied = firstUnmet(session, subject, requirements, options);
  if (denied) return { session, subject, error: forbidden(denied) };

  return { session, subject, error: null };
}

/**
 * Flag-aware single-permission check, for callers that need a boolean rather
 * than a 403 — the reporting guard uses it for `canViewSpend`.
 *
 * Goes through the same enforcement-flag logic as `requirePermission`, so a
 * capability still resolves via its legacy bucket until its flag is on. Calling
 * `can()` from the registry directly would skip that and enforce early.
 */
export function hasPermission(
  session: { user: Parameters<typeof subjectFromSession>[0]['user'] },
  subject: PermissionSubject,
  requirement: PermissionRequirement,
  options: PermissionCheckOptions = {},
): boolean {
  return firstUnmet(session as AuthedSession, subject, [requirement], options) === null;
}

/**
 * The first requirement the subject fails, or null if they pass all of them.
 * Returns the permission to name in the 403 so the caller knows what's missing.
 */
function firstUnmet(
  session: AuthedSession,
  subject: PermissionSubject,
  requirements: PermissionRequirement[],
  options: PermissionCheckOptions,
): Permission | null {
  for (const requirement of requirements) {
    const wanted = asList(requirement);

    // ANY-of within a single requirement. Each alternative is evaluated under
    // its own sector's enforcement flag, so a half-rolled-out migration can't
    // accidentally close a route that the other half still opens.
    const met = wanted.some((permission) =>
      isEnforced(permission)
        ? can(subject, permission, options.accountKey)
        : // Phase 0: the legacy bucket is authoritative. Account scope is still
          // checked, because that half was never the broken part.
          legacyCan(session.user.role, permission) &&
          scopeAllowsLegacy(session.user, options.accountKey),
    );

    if (!met) {
      // Report the most permissive of the alternatives — the one the caller was
      // most likely meant to have.
      return [...wanted].sort(
        (a, b) => BUCKET_RANK[LEGACY_GUARD[b]] - BUCKET_RANK[LEGACY_GUARD[a]],
      )[0];
    }
  }
  return null;
}

/**
 * Legacy scope check, preserving today's semantics exactly: developer and
 * super_admin are unrestricted, everyone else is limited to their (already
 * org-expanded) keys.
 */
function scopeAllowsLegacy(
  user: { role: UserRole; accountKeys?: string[] },
  accountKey?: string,
): boolean {
  if (user.role === 'developer' || user.role === 'super_admin') return true;
  const keys = user.accountKeys ?? [];
  if (!accountKey) return true;
  // An empty list is "unrestricted" for admin today (see auth.ts:419, which
  // normally prevents it reaching here) and "nothing" for a client.
  if (keys.length === 0) return user.role === 'admin';
  return keys.includes(accountKey);
}

/**
 * Assert a tier/sector pairing is legal before writing a `UserSectorRole`.
 * Throws rather than returning false — a caller that ignores this would be
 * persisting the one state the model promises can't exist.
 */
export function assertAssignableSectorRole(
  tier: PermissionSubject['tier'],
  ref: string,
): void {
  const parsed = parseSectorRoleRef(ref);
  if (!parsed) throw new Error(`Unknown sector role: ${ref}`);
  if (tier === 'client' && parsed.sector !== 'reporting') {
    throw new Error(
      `A client-tier user cannot hold ${ref} — clients may only hold reporting roles.`,
    );
  }
}
