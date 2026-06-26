import { getAuthSession } from '@/lib/api-auth';
import { AD_GENERATOR_ENABLED } from '@/lib/feature-flags';

/**
 * Server-side gate for the Ad Generator (page route + APIs).
 *
 * The tool is still a WIP, so it's only reachable when:
 *   - the env flag is on (e.g. staging, for broad internal testing), OR
 *   - the signed-in user is a developer (any environment, incl. production).
 *
 * Everyone else gets a 404 — and the sidebar already shows a non-clickable
 * "Soon" chip for non-developers. Reads the session, so this is server-only.
 */
export async function adGeneratorAllowed(): Promise<boolean> {
  if (AD_GENERATOR_ENABLED) return true;
  const session = await getAuthSession();
  return session?.user?.role === 'developer';
}
