import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions, type UserRole } from '@/lib/auth';
import { hasUnrestrictedAccountAccess } from '@/lib/roles';
import { getOrgChildKeys } from '@/lib/services/organizations';

export async function getAuthSession() {
  return getServerSession(authOptions);
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export async function requireAuth() {
  const session = await getAuthSession();
  if (!session?.user) return { session: null, error: unauthorized() };
  return { session, error: null };
}

export async function requireRole(...roles: UserRole[]) {
  const session = await getAuthSession();
  if (!session?.user) return { session: null, error: unauthorized() };
  if (!roles.includes(session.user.role)) return { session, error: forbidden() };
  return { session, error: null };
}

/**
 * Compute the account-scope filter for a session.
 *
 * - `null` = no scoping (developer / super_admin can see all accounts)
 * - `string[]` = scoped to these account keys (admin / client roles)
 *
 * Service-layer queries treat `null` as "no filter" and an array as
 * "WHERE accountKey IN (…)". Used by feature APIs that need to enforce
 * per-account access.
 */
export function getAccountScope(session: {
  user: { role: UserRole; accountKeys?: string[] };
}): string[] | null {
  if (session.user.role === 'developer' || session.user.role === 'super_admin') {
    return null;
  }
  return session.user.accountKeys ?? [];
}

/** True when the session can access the given accountKey under its scope. */
export function canAccessAccount(
  scope: string[] | null,
  accountKey: string,
): boolean {
  return !scope || scope.length === 0 || scope.includes(accountKey);
}

/** True when the session can read/author templates for the given organization.
 *  Unrestricted roles pass; scoped users pass when they share any of the org's
 *  child rooftops (org grants are expanded to child accountKeys at session build). */
export async function canAccessOrg(
  session: { user: { role: UserRole; accountKeys?: string[] } },
  orgId: string,
): Promise<boolean> {
  const accountKeys = session.user.accountKeys ?? [];
  if (hasUnrestrictedAccountAccess(session.user.role, accountKeys)) return true;
  const childKeys = await getOrgChildKeys(orgId);
  return childKeys.some((k) => accountKeys.includes(k));
}
