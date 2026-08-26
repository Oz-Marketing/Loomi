/**
 * Canonical-URL rules for public landing pages.
 *
 * A published LP is reachable at up to four URLs:
 *   - studio.loomilm.com/lp/<slug>        (always)
 *   - <custom-domain>/<slug>              (account has a verified domain)
 *   - <custom-domain>/                    (that LP is the domain's home)
 *   - <custom-domain>/lp/<slug>           (middleware passes /lp/* through)
 *
 * Exactly one of those is the address we want indexed, linked and
 * reported on. These helpers decide which, and are pure so the choice is
 * testable without a database or a request — the callers (the LP service
 * and the public route) supply the domain row and the query string.
 */

/** The fields of an AccountDomain that bear on URL construction. */
export interface CanonicalDomain {
  hostname: string;
  homeLandingPageId: string | null;
}

/** Query-string shape Next.js hands a server component. Declared
 *  structurally rather than imported so this module stays free of any
 *  dependency on the forms tree. */
export type QueryParams = Record<string, string | string[] | undefined>;

/**
 * The canonical public URL for one landing page.
 *
 * `studioUrl` is the already-built fallback (`<studio host>/lp/<slug>`),
 * used when the account has no verified domain — including for library
 * templates, which have no owning account at all.
 *
 * Custom domains are always https: Cloudflare for SaaS issues the
 * certificate during verification, so a verified hostname is by
 * definition one we can serve over TLS.
 */
export function canonicalLandingPageUrl(args: {
  studioUrl: string;
  slug: string;
  pageId: string;
  domain: CanonicalDomain | null;
}): string {
  const { studioUrl, slug, pageId, domain } = args;
  if (!domain) return studioUrl;
  // The domain home lives at `/`, matching how middleware rewrites the
  // root path to the `__home__` sentinel. Serving it as `/<slug>` too
  // would be a second address for the same page.
  return domain.homeLandingPageId === pageId
    ? `https://${domain.hostname}/`
    : `https://${domain.hostname}/${slug}`;
}

/**
 * Carry an incoming query string onto a redirect target.
 *
 * Non-negotiable for the canonical redirect: `?utm_*` is how a visit gets
 * attributed, and it's captured at first touch. Dropping the query on the
 * hop would make every redirected visit look like direct traffic and
 * silently break campaign reporting. `note_`/`meta_` params prefill
 * embedded form fields, so losing those changes what the visitor sees.
 */
export function withQuery(target: string, params: QueryParams): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    // Repeated params (`?meta_vin=a&meta_vin=b`) arrive as an array.
    // Preserve every occurrence rather than collapsing to the first, so
    // the target sees exactly the query the visitor arrived with.
    for (const v of Array.isArray(value) ? value : [value]) qs.append(key, v);
  }
  const query = qs.toString();
  if (!query) return target;
  return `${target}${target.includes('?') ? '&' : '?'}${query}`;
}
