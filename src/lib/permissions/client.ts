/**
 * CLIENT-SAFE permission reads, for gating UI.
 *
 * Why this exists rather than calling `hasPermission` from a component: that
 * path consults `SECTOR_ENFORCEMENT`, which reads `PERMISSIONS_ENFORCE_*` env
 * vars. Those are deliberately NOT `NEXT_PUBLIC_`, so in the browser they are
 * all `undefined` → every sector reads as unenforced → the check silently falls
 * back to legacy role buckets and a sector role never grants anything. A UI
 * gate built on that would keep hiding a tab from the very role that was just
 * given it.
 *
 * So this asks a narrower, honest question: **does the role this user is
 * assigned include this permission, per the matrix?** No enforcement flag, no
 * legacy fallback, no account scoping.
 *
 * That makes it usable for WIDENING a gate only. It must never be the sole
 * guard on anything: the server is still the authority (`requirePermission`),
 * and the enforcement flags exist so a sector can be switched over
 * deliberately. Read this as "show the door", never as "unlock it".
 */
import {
  resolvePermissions,
  type Permission,
  type PlatformTier,
  type SectorRoleRef,
} from './registry';

/** The session shape this needs — a subset of `session.user`. */
export type ClientPermissionUser = {
  role?: string | null;
  sectorRoles?: string[] | null;
};

/**
 * Does the user's ASSIGNED sector roles include `permission`?
 *
 * `sectorRoles` being `undefined` means a token minted before the field
 * existed, and is treated as "unknown, grants nothing" — an empty array is the
 * different and meaningful case of every role deliberately revoked. Both return
 * false here; the distinction matters to the server, not to a UI gate.
 */
export function roleGrants(
  user: ClientPermissionUser | null | undefined,
  permission: Permission,
): boolean {
  const refs = user?.sectorRoles;
  if (!refs || refs.length === 0) return false;
  const granted = resolvePermissions({
    tier: (user?.role as PlatformTier) ?? 'staff',
    sectorRoles: refs as SectorRoleRef[],
    scopeMode: 'all',
    accountKeys: [],
  });
  return granted.has(permission);
}
