import { getAuthSession } from '@/lib/api-auth';
import { can } from '@/lib/permissions/registry';
import { subjectFromSession } from '@/lib/permissions/require';

/**
 * Server-side gate for the Ad Generator (page route + APIs).
 *
 * WHAT THIS REPLACES. The gate used to be `AD_GENERATOR_ENABLED || signed in`,
 * which bypassed the permission registry entirely — so a client reached the page
 * while `studio.adgen.view` said `management`, and the two disagreed about who
 * was entitled to it. That access was accidental, not designed: it worked only
 * because the list page never happens to call one of the routes that DOES check
 * the capability. The env flag also meant enabling the tool for an environment
 * enabled it for everyone in it.
 *
 * WHY IT ASKS THE REGISTRY DIRECTLY, ahead of the sector rollout.
 * `requirePermission` routes through `isEnforced()`, and Studio enforcement is
 * still behind `PERMISSIONS_ENFORCE_STUDIO`. Until that flips, the LEGACY bucket
 * is authoritative — and the legacy buckets are coarse
 * (developer/elevated/management/authenticated), so they cannot express the
 * entitlement this gate now has to enforce: a client who may see their OEM
 * offers and nothing else in Studio. `management` locks them out and
 * `authenticated` is the accidental state this replaces.
 *
 * So the registry decides here, deliberately, for this one gate. Every other
 * Studio route keeps its `requirePermission` call and flips with the sector.
 * When `PERMISSIONS_ENFORCE_STUDIO` goes on, this becomes redundant rather than
 * wrong — the two agree by construction, since both read `studio.adgen.view`.
 *
 * Returns false rather than throwing, because callers 404 on it: an
 * unauthorized visitor should not learn the route exists.
 */
export async function adGeneratorAllowed(): Promise<boolean> {
  const session = await getAuthSession();
  if (!session?.user) return false;
  return can(subjectFromSession(session), 'studio.adgen.view');
}
