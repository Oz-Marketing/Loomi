/**
 * Who can see a segment, and who can change it.
 *
 * ONE definition, used by the list page, the API's read scope and its
 * write gate. The ad-template Availability control learned this the hard
 * way: when the audience a control advertises is computed separately from
 * the audience the gate enforces, the two drift and a segment either
 * leaks or vanishes with nothing in the UI to explain it.
 *
 * Three tiers, and `accountKey` alone can only express two of them:
 *
 *   accountKey = null                     platform-wide (privileged)
 *   accountKey = X,  shared = false       account X only
 *   accountKey = G,  shared = true        group G AND the accounts under it
 *
 * The third is the reason `sharedWithChildren` exists. Note the direction:
 * a segment travels DOWN the hierarchy, never up. A group does not see the
 * segments its rooftops build — those are the rooftop's own working lists,
 * and surfacing them at the group turned the group's list into a dumping
 * ground of everyone else's drafts.
 */

import { ancestorKeys, type AccountEdge } from '@/lib/account-hierarchy';

/** The fields of an Audience this module reasons about.
 *
 *  `accountKey` is optional as well as nullable because the client types
 *  it that way; both absent and null mean "not scoped to one account", and
 *  every check below uses `== null` so the two behave identically. */
export interface SegmentScope {
  accountKey?: string | null;
  sharedWithChildren?: boolean | null;
}

/** Where the viewer is standing. */
export interface ViewerScope {
  /** The single account selected, or null for the all-accounts overview. */
  accountKey: string | null;
  /** `accountKey`'s ancestors, nearest first. Empty for a root account. */
  ancestors: string[];
}

/**
 * Build a viewer from the raw hierarchy. Kept here rather than at each
 * call site so "which accounts are above me" has one answer.
 */
export function viewerScope(edges: AccountEdge[], accountKey: string | null): ViewerScope {
  if (!accountKey) return { accountKey: null, ancestors: [] };
  return { accountKey, ancestors: ancestorKeys(edges, accountKey) };
}

/**
 * Can this viewer SEE the segment?
 *
 * Deliberately does not consider the user's role: role decides which
 * accounts they may stand in, this decides what is visible once they are
 * standing there. Mixing the two is how a check ends up enforcing neither.
 */
export function isSegmentVisibleTo(segment: SegmentScope, viewer: ViewerScope): boolean {
  // Platform-wide: everywhere, by definition.
  if (segment.accountKey == null) return true;
  // The all-accounts overview is the one place that sees every segment;
  // it is only reachable by privileged users (see POST /api/audiences).
  if (viewer.accountKey == null) return true;
  // Own.
  if (segment.accountKey === viewer.accountKey) return true;
  // Shared down from a group above me.
  return (
    segment.sharedWithChildren === true && viewer.ancestors.includes(segment.accountKey)
  );
}

/**
 * Is this segment one the viewer received from a group above them?
 *
 * Read-only to them: the group owns it. The UI offers Duplicate instead,
 * which writes a NEW segment owned by the viewer's account.
 */
export function isInheritedFromGroup(segment: SegmentScope, viewer: ViewerScope): boolean {
  if (segment.accountKey == null || viewer.accountKey == null) return false;
  if (segment.accountKey === viewer.accountKey) return false;
  return segment.sharedWithChildren === true && viewer.ancestors.includes(segment.accountKey);
}

/**
 * The Prisma `where` for "segments this set of accounts may read".
 *
 * `ancestors` must already be the union of every viewing account's
 * ancestors — resolved once by the caller, because it costs one query for
 * the whole hierarchy and doing it per account is the same data N times.
 */
export function segmentReadWhere(accountKeys: string[], ancestors: string[]) {
  const or: Array<Record<string, unknown>> = [
    { accountKey: null },
    { accountKey: { in: accountKeys } },
  ];
  if (ancestors.length > 0) {
    or.push({ accountKey: { in: ancestors }, sharedWithChildren: true });
  }
  return { OR: or };
}

/** Why a write was refused, so the caller can say something useful. */
export type WriteRefusal = 'org_wide_requires_privilege' | 'inherited_read_only' | 'not_in_scope';

/**
 * Can this user CHANGE the segment (edit, delete, or re-share it)?
 *
 * Ownership first, role second. A rooftop admin has every right to edit
 * their own segments and none at all to edit the group's — the shared copy
 * is the group's to change, and one rooftop editing it would silently
 * rewrite the audience for every other rooftop.
 */
export function canWriteSegment(
  segment: SegmentScope,
  user: { role: string; accountKeys: string[] },
): WriteRefusal | null {
  const isPrivileged = user.role === 'developer' || user.role === 'super_admin';
  if (isPrivileged) return null;

  // Platform-wide segments stay privileged — an unprivileged user cannot
  // create one, and must not be able to edit one either.
  if (segment.accountKey == null) return 'org_wide_requires_privilege';

  // You may only write a segment owned by an account you are assigned to.
  // An ancestor's shared segment fails here by construction: the rooftop
  // user is not assigned to the group, so its key is not in their list.
  if (!user.accountKeys.includes(segment.accountKey)) {
    return segment.sharedWithChildren ? 'inherited_read_only' : 'not_in_scope';
  }
  return null;
}
