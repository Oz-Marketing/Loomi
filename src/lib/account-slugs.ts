import type { AccountData, OrganizationData } from '@/contexts/account-context';

// ── Organization routing ──
// Org scope is URL-based on the studio surface, mirroring `/subaccount/<slug>`.
// The URL uses the org's slug (falling back to its key when a slug is unset).

/** Top-level studio pages that exist under `/org/<slug>`. Others fall back to
 *  the org dashboard on switch (org is a read/manage scope, not for account-
 *  level authoring like campaign-builder or flow editing). */
export const ORG_ROUTE_ROOTS = new Set(['dashboard', 'contacts', 'templates', 'settings']);

/** URL segment for an organization. */
export function orgSlugFor(org: Pick<OrganizationData, 'slug' | 'key'>): string {
  return org.slug || org.key;
}

/** Resolve an `/org/<slug>` segment back to an organization id. */
export function orgSlugToId(
  slug: string,
  organizations: Record<string, OrganizationData>,
): string | null {
  for (const org of Object.values(organizations)) {
    if (orgSlugFor(org) === slug) return org.id;
  }
  return null;
}

/** Build an org URL path. */
export function orgPath(slug: string, page: string = 'dashboard'): string {
  const normalizedPage = page.startsWith('/') ? page.slice(1) : page;
  return `/org/${slug}/${normalizedPage}`;
}

/** True when a pathname is an org route. */
export function isOrgRoute(pathname: string): boolean {
  return pathname.startsWith('/org/');
}

/** Extract the slug from an org pathname. */
export function extractOrgSlug(pathname: string): string | null {
  const match = pathname.match(/^\/org\/([^/]+)/);
  return match?.[1] ?? null;
}

/** Strip a `/subaccount/<slug>` OR `/org/<slug>` prefix, returning the
 *  equivalent top-level (agency) path. */
export function stripScopePrefix(pathname: string): string {
  return pathname.replace(/^\/(subaccount|org)\/[^/]+/, '') || '/';
}

/** Convert an accountKey to a URL slug using the loaded accounts map. */
export function accountKeyToSlug(
  accountKey: string,
  accounts: Record<string, AccountData>,
): string | null {
  return accounts[accountKey]?.slug ?? null;
}

/** Convert a URL slug back to an accountKey. */
export function slugToAccountKey(
  slug: string,
  accounts: Record<string, AccountData>,
): string | null {
  for (const [key, data] of Object.entries(accounts)) {
    if (data.slug === slug) return key;
  }
  return null;
}

/** Build a sub-account URL path. */
export function subaccountPath(slug: string, page: string = 'dashboard'): string {
  const normalizedPage = page.startsWith('/') ? page.slice(1) : page;
  return `/subaccount/${slug}/${normalizedPage}`;
}

/** Check if a pathname is a sub-account route. */
export function isSubaccountRoute(pathname: string): boolean {
  return pathname.startsWith('/subaccount/');
}

/** Extract the page portion from a sub-account pathname (e.g. "contacts"). */
export function extractSubaccountPage(pathname: string): string | null {
  const match = pathname.match(/^\/subaccount\/[^/]+\/(.+)$/);
  return match?.[1] ?? null;
}

/** Extract the slug from a sub-account pathname. */
export function extractSlugFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/subaccount\/([^/]+)/);
  return match?.[1] ?? null;
}

/**
 * Strip the `/subaccount/[slug]` prefix from a pathname, returning
 * the equivalent top-level route path. Returns the original pathname
 * if it's not a sub-account route.
 */
export function stripSubaccountPrefix(pathname: string): string {
  return pathname.replace(/^\/subaccount\/[^/]+/, '') || '/';
}

/**
 * Map a top-level admin pathname to the equivalent page name for
 * sub-account routing. Handles the root-to-dashboard mapping.
 */
export function pathnameToPage(pathname: string): string {
  const stripped = stripSubaccountPrefix(pathname);
  if (stripped === '/' || stripped === '/dashboard') return 'dashboard';
  return stripped.replace(/^\//, '');
}
