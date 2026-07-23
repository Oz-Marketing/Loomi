'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useAccount } from '@/contexts/account-context';
import { orgSlugToId } from '@/lib/account-slugs';

/**
 * Organization scope layout — the URL counterpart to the sub-account layout.
 * `/org/<slug>/…` hydrates the shared account context into org (roll-up) mode
 * from the URL slug, so switching orgs is real navigation (deep-linkable,
 * back/forward, triggers a load) instead of a cookie-only context flip.
 */
export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { organizations, organizationsLoaded, setAccount, account, organizationId, userRole } = useAccount();
  const syncedRef = useRef(false);

  const resolvedId = orgSlugToId(slug, organizations);

  // Sync context from the URL slug. Mirrors the sub-account layout: when we
  // arrive from an agency route the context is still in admin mode and needs
  // hydrating; once the user explicitly leaves org mode we don't fight it.
  useEffect(() => {
    if (!organizationsLoaded || !resolvedId) return;
    if (account.mode === 'admin' && syncedRef.current) return;
    if (organizationId !== resolvedId) {
      setAccount({ mode: 'org', organizationId: resolvedId });
    }
    syncedRef.current = true;
  }, [organizationsLoaded, resolvedId, account.mode, organizationId, setAccount]);

  // Clients never operate at the org scope; bounce them home.
  useEffect(() => {
    if (!organizationsLoaded) return;
    if (userRole === 'client') {
      router.replace('/dashboard');
      return;
    }
    if (!resolvedId) {
      router.replace('/dashboard');
    }
  }, [organizationsLoaded, resolvedId, userRole, router]);

  if (!resolvedId) {
    // Still loading the org list, or slug is invalid (redirecting).
    return organizationsLoaded ? null : (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--primary)]" />
      </div>
    );
  }

  // Only render the page once the shared context is actually in this org's
  // scope, so pages (and the settings tab guard) never see a stale mode.
  if (organizationId !== resolvedId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--primary)]" />
      </div>
    );
  }

  return <>{children}</>;
}
