// Who may READ a blast, for the routes that hand one out.
//
// The mutating routes have always limited an admin with an account list to
// those accounts; the read routes only checked the client role. So an
// account-scoped admin could open any other account's blast — its audience
// definition, its content, its deliverability report — by id, and list every
// account's blasts. One rule for both now, written here once.

export interface ScopedUser {
  role: string;
  accountKeys?: string[] | null;
}

/**
 * The accounts a user is confined to, or null when they're unrestricted.
 *
 * Clients are always confined (an empty list confines them to nothing).
 * Admins are confined only when they carry an account list; an admin with
 * none is agency staff. Developers and super admins are never confined.
 */
export function confinedAccountKeys(user: ScopedUser): string[] | null {
  if (user.role === 'client') return user.accountKeys ?? [];
  if (user.role === 'admin' && (user.accountKeys?.length ?? 0) > 0) {
    return user.accountKeys ?? [];
  }
  return null;
}

/**
 * May this user see a blast stamped with `blastAccountKeys`?
 *
 * A confined admin also sees blasts with no account at all — the mutating
 * routes let them edit those, so hiding them from a read would only break the
 * builder. Clients never see an account-less blast: it belongs to nobody they
 * represent.
 */
export function canReadBlast(user: ScopedUser, blastAccountKeys: string[]): boolean {
  const confined = confinedAccountKeys(user);
  if (confined === null) return true;
  if (blastAccountKeys.length === 0) return user.role !== 'client';
  const allowed = new Set(confined);
  return blastAccountKeys.some((key) => allowed.has(key));
}

/** May this user act on (preflight, count, send for) one specific account? */
export function canUseAccount(user: ScopedUser, accountKey: string): boolean {
  const confined = confinedAccountKeys(user);
  return confined === null || confined.includes(accountKey);
}
