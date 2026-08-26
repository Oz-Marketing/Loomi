import { getAuthSession } from '@/lib/api-auth';
import { PLAYBOOKS_ENABLED } from '@/lib/feature-flags';
import { hasPermission, subjectFromSession } from '@/lib/permissions/require';

/**
 * Server-side gate for Playbooks (page route + API).
 *
 * Two independent conditions, and both must hold:
 *
 *  1. **Permission.** `agency.subaccounts.view` — the same guard every Playbooks
 *     route already applies via `requirePermission`. It used to be a separate
 *     `MANAGEMENT_ROLES.includes(session.user.role)` test, which meant one door
 *     was guarded by two different permission models that could drift apart
 *     silently. `hasPermission` goes through the same enforcement flags as the
 *     routes, so migrating the agency sector later moves this gate with it —
 *     calling `can()` from the registry directly would enforce early and lock
 *     people out ahead of the rollout.
 *
 *  2. **The env flag**, with a developer bypass so it can be exercised in
 *     production before it ships.
 *
 * Phase 0 is an internal operations view of every account's configuration, so a
 * client role must never reach it — that falls out of (1), since
 * `agency.subaccounts.view` is staff-only.
 *
 * Runs server-side, so a direct URL can't route around the hidden nav link.
 */
export async function playbooksAllowed(): Promise<boolean> {
  const session = await getAuthSession();
  if (!session?.user) return false;

  const subject = subjectFromSession(session);
  if (!hasPermission(session, subject, 'agency.subaccounts.view')) return false;

  return PLAYBOOKS_ENABLED || session.user.role === 'developer';
}
