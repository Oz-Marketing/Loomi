import { getAuthSession } from '@/lib/api-auth';
import { AD_GENERATOR_ENABLED } from '@/lib/feature-flags';

/**
 * Server-side gate for the Ad Generator (page route + APIs).
 *
 * The tool is now public: any signed-in user may reach it. Individual write
 * routes still enforce their own role checks (e.g. `requireRole` for creating
 * templates / disclaimer rules), and account-scoped data is filtered per the
 * caller's account access — so "public" here just means "authenticated".
 * Unauthenticated requests get a 404. Reads the session, so this is server-only.
 */
export async function adGeneratorAllowed(): Promise<boolean> {
  if (AD_GENERATOR_ENABLED) return true;
  const session = await getAuthSession();
  return Boolean(session?.user);
}
