/**
 * Playbooks — which accounts an audit request may actually read.
 *
 * Lifted out of the route so the rule can be tested without a database or a
 * session. The audit enumerates configuration for every key it is handed, so
 * this function is the whole boundary between "what the caller asked for" and
 * "what the caller is allowed to see" — the sort of thing that should fail a
 * test rather than a penetration report.
 *
 * Pure. No prisma, no next-auth.
 */

import { filterAccountKeysByAccess, type UserRole } from '@/lib/roles';

export interface AuditScopeInput {
  /** Every account key that exists, in the order the payload should render. */
  allAccountKeys: string[];
  role: UserRole;
  /** The session's own account grants. Empty means unrestricted for some roles. */
  sessionAccountKeys: string[];
  /** Raw `accountKeys` query param — comma-separated, possibly absent. */
  requestedParam: string | null;
}

/** Split the query param the way a browser sends it: commas, stray spaces, blanks. */
export function parseRequestedKeys(param: string | null): string[] {
  return (param ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

/**
 * The keys an audit may read.
 *
 * Scope is a request INPUT; access is not. The requested keys are intersected
 * with what the session may see and never trusted on their own, so a
 * hand-written query string cannot reach a rooftop the caller otherwise
 * couldn't open.
 *
 * An empty or absent param means "everything I may see" — the all-accounts
 * overview (docs/account-scope.md). That default is why the CLIENT must not
 * fire while its account context is still settling: an empty list there would
 * silently widen a one-account selection to the whole roster.
 */
export function resolveAuditScope(input: AuditScopeInput): string[] {
  const allowed = filterAccountKeysByAccess(
    input.allAccountKeys,
    input.role,
    input.sessionAccountKeys,
  );
  const requested = parseRequestedKeys(input.requestedParam);
  if (requested.length === 0) return allowed;
  // Filter the ALLOWED list rather than the requested one, so ordering stays
  // the payload's own and an unknown key drops out instead of appearing.
  const wanted = new Set(requested);
  return allowed.filter((key) => wanted.has(key));
}
