'use client';

import { usePathname } from 'next/navigation';
import { useAccount } from '@/contexts/account-context';
import { accountKeyToSlug, isSubaccountRoute, extractSlugFromPath } from '@/lib/account-slugs';

/**
 * Like `useSubaccountHref`, but org-aware — for ROLL-UP pages (contacts,
 * lists, segments) that aggregate across an org's rooftops.
 *
 * The difference matters in org mode. `useSubaccountHref` deliberately resolves
 * to the org's primary ("house") sub-account, which is right for operational
 * pages (campaigns, flows, media) that act on the org's own work. But a roll-up
 * page showing every rooftop's lists must keep its links inside `/org/<slug>`,
 * otherwise clicking a list owned by rooftop B would navigate into the house
 * account and silently switch scope.
 *
 *   org mode      → /org/<orgSlug>/contacts/lists/123
 *   account mode  → /subaccount/<slug>/contacts/lists/123
 *   admin mode    → /contacts/lists/123
 */
export function useScopedHref(): (path: string) => string {
  const pathname = usePathname();
  const { accountKey, accounts, isOrg, organizationData } = useAccount();

  // Prefer the slug already in the URL — the context may not have synced yet
  // on a hard load of a scoped route.
  const onOrgRoute = pathname?.startsWith('/org/') ?? false;
  const orgSlugFromPath = onOrgRoute ? pathname.split('/')[2] || null : null;
  const orgSlug = orgSlugFromPath || organizationData?.slug || null;

  const inSubaccountRoute = isSubaccountRoute(pathname);
  const urlSlug = inSubaccountRoute ? extractSlugFromPath(pathname) : null;
  const contextSlug = accountKey ? accountKeyToSlug(accountKey, accounts) : null;
  const subSlug = urlSlug || contextSlug;

  return (path: string): string => {
    const normalized = path.startsWith('/') ? path : `/${path}`;

    if ((isOrg || onOrgRoute) && orgSlug) {
      if (path.startsWith('/org/')) return path;
      return `/org/${orgSlug}${normalized}`;
    }

    if (!subSlug) return path;
    if (path.startsWith('/subaccount/')) return path;
    return `/subaccount/${subSlug}${normalized}`;
  };
}
