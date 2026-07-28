import type { AccountData } from '@/contexts/account-context';

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
