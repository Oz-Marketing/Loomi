'use client';

import { usePathname } from 'next/navigation';
import { useAccount } from '@/contexts/account-context';
import { accountKeyToSlug, isSubaccountRoute, extractSlugFromPath } from '@/lib/account-slugs';

/**
 * Prefixes a path with the active sub-account slug.
 *
 * This once distinguished roll-up pages (which had to stay under `/org/<slug>`)
 * from operational ones. With Organizations retired there's a single URL scheme
 * — a group is just an account — so it now behaves identically to
 * `useSubaccountHref`, kept as a separate export only so the roll-up call sites
 * don't need touching.
 */
export function useScopedHref(): (path: string) => string {
  const pathname = usePathname();
  const { accountKey, accounts } = useAccount();

  const urlSlug = isSubaccountRoute(pathname) ? extractSlugFromPath(pathname) : null;
  const slug = urlSlug || (accountKey ? accountKeyToSlug(accountKey, accounts) : null);

  return (path: string): string => {
    if (!slug) return path;
    if (path.startsWith('/subaccount/')) return path;
    return `/subaccount/${slug}${path.startsWith('/') ? path : `/${path}`}`;
  };
}
