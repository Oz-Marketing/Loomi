// The account keys a request may resolve a segment against.
//
// Same shape as /api/contacts/paged: read every account, reduce it to
// what the caller's role and assignments allow, then INTERSECT with what
// they asked for. Never trust the requested keys on their own.

import { prisma } from '@/lib/prisma';
import { filterAccountKeysByAccess, type UserRole } from '@/lib/roles';

export interface ScopeResult {
  /** Everything the caller may reach. */
  allowed: string[];
  /** The intersection of `allowed` and what they asked for. */
  selected: string[];
  /** True when they named accounts and none of them were permitted. */
  deniedAll: boolean;
}

export async function resolveRequestedAccountKeys(
  requested: string[],
  role: UserRole,
  userAccountKeys: string[],
): Promise<ScopeResult> {
  // The `\\_` escape is load-bearing — see the note in aggregate/route.ts.
  // `_` is the LIKE single-char wildcard, so a bare `startsWith: '_'` would
  // match every key and `not:` would exclude every account.
  const allAccounts = await prisma.account.findMany({
    where: { key: { not: { startsWith: '\\_' } } },
    select: { key: true },
  });
  const allowed = filterAccountKeysByAccess(
    allAccounts.map((a) => a.key),
    role,
    userAccountKeys,
  );
  const allowedSet = new Set(allowed);
  const asked = [...new Set(requested.map((k) => k.trim()).filter(Boolean))];
  const selected = asked.length > 0 ? asked.filter((k) => allowedSet.has(k)) : allowed;

  return { allowed, selected, deniedAll: asked.length > 0 && selected.length === 0 };
}
