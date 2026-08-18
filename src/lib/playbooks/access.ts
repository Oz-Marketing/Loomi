import { getAuthSession } from '@/lib/api-auth';
import { PLAYBOOKS_ENABLED } from '@/lib/feature-flags';
import { MANAGEMENT_ROLES } from '@/lib/roles';

/**
 * Server-side gate for Playbooks (page route + API).
 *
 * Phase 0 is an internal operations view of every sub-account's configuration,
 * so it's staff-only regardless of the flag — a client role must never reach a
 * screen that enumerates other rooftops. On top of that it stays hidden until
 * the env flag is on, with a developer bypass so it can be exercised in prod
 * before it ships. Runs server-side, so a direct URL can't route around the
 * hidden nav link.
 */
export async function playbooksAllowed(): Promise<boolean> {
  const session = await getAuthSession();
  if (!session?.user) return false;
  if (!MANAGEMENT_ROLES.includes(session.user.role)) return false;
  return PLAYBOOKS_ENABLED || session.user.role === 'developer';
}
