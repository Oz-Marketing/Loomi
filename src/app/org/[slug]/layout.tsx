'use client';

import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAccount } from '@/contexts/account-context';
import { accountKeyToSlug, orgSlugToId } from '@/lib/account-slugs';

/**
 * Legacy `/org/<slug>/…` redirector.
 *
 * Organizations have collapsed into the account hierarchy: a group like Young
 * Automotive Group is now just an Account whose rooftops point at it, so it has
 * a normal sub-account URL and a normal sub-account nav. There's no separate
 * org scope left to hydrate — this layout only forwards old links (bookmarks,
 * saved reports) to the group's account route, preserving the sub-path.
 *
 * Resolution mirrors the migration: the account sharing the org's key, else the
 * org's designated primary ("house") account. Unresolvable → /dashboard.
 */
// `children` is intentionally never rendered — this layout always redirects,
// so the legacy org pages beneath it never mount.
export default function OrgLayout(_props: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { organizations, organizationsLoaded, accounts, accountsLoaded } = useAccount();

  useEffect(() => {
    if (!organizationsLoaded || !accountsLoaded) return;

    // Everything after /org/<slug> — e.g. "/contacts/lists".
    const rest = pathname.replace(new RegExp(`^/org/${slug}`), '') || '/dashboard';

    const orgId = orgSlugToId(slug, organizations);
    const org = orgId ? Object.values(organizations).find((o) => o.id === orgId) : null;

    const targetKey =
      (org && accounts[org.key] ? org.key : null) ??
      (org?.primaryAccountKey && accounts[org.primaryAccountKey] ? org.primaryAccountKey : null);

    if (!targetKey) {
      // No org (already migrated away) — the slug may already be the group
      // account's own slug, which is the common case post-migration.
      const direct = Object.keys(accounts).find((k) => accountKeyToSlug(k, accounts) === slug);
      router.replace(direct ? `/subaccount/${slug}${rest}` : '/dashboard');
      return;
    }

    router.replace(`/subaccount/${accountKeyToSlug(targetKey, accounts)}${rest}`);
  }, [organizationsLoaded, accountsLoaded, organizations, accounts, slug, pathname, router]);

  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--primary)]" />
    </div>
  );
}
