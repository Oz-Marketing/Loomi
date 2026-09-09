'use client';

import { useAccount } from '@/contexts/account-context';

export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { userRole } = useAccount();
  const hasAdminAccess = userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';

  if (!hasAdminAccess) {
    return (
      <div className="text-center py-16">
        <div className="w-12 h-12 rounded-full bg-[var(--muted)] flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-[var(--muted-foreground)]" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
        </div>
        <p className="text-[var(--muted-foreground)] text-sm">This page requires admin or developer access.</p>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Staff, plus the client tier — the guard for Campaigns.
 *
 * Campaigns is the one Studio surface a dealer holds, because a generate run's
 * ads and its offer email are a single deliverable and this is where they sit
 * together. Everything a client must not do is withheld elsewhere and not by
 * this guard: `/campaign-builder/new` stays `AdminOnly`, the list is filtered to
 * `source = 'automation'` server-side, and create/delete controls are hidden
 * from the tier. Reading a campaign they own is the whole grant.
 */
export function CampaignViewers({ children }: { children: React.ReactNode }) {
  const { userRole } = useAccount();
  const allowed =
    userRole === 'developer' ||
    userRole === 'super_admin' ||
    userRole === 'admin' ||
    userRole === 'client';

  if (!allowed) {
    return (
      <div className="text-center py-16">
        <div className="w-12 h-12 rounded-full bg-[var(--muted)] flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-[var(--muted-foreground)]" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
        </div>
        <p className="text-[var(--muted-foreground)] text-sm">You do not have access to this page.</p>
      </div>
    );
  }

  return <>{children}</>;
}

export function ClientOnly({ children }: { children: React.ReactNode }) {
  const { isAccount } = useAccount();

  if (!isAccount) {
    return (
      <div className="text-center py-16">
        <div className="w-12 h-12 rounded-full bg-[var(--muted)] flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-[var(--muted-foreground)]" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
          </svg>
        </div>
        <p className="text-[var(--muted-foreground)] text-sm">Select an account to access this page.</p>
        <p className="text-[var(--muted-foreground)] text-xs mt-1">Use the Account switcher in the sidebar.</p>
      </div>
    );
  }

  return <>{children}</>;
}

export function ElevatedOnly({ children }: { children: React.ReactNode }) {
  const { userRole } = useAccount();
  const hasElevatedAccess = userRole === 'developer' || userRole === 'super_admin';

  if (!hasElevatedAccess) {
    return (
      <div className="text-center py-16">
        <div className="w-12 h-12 rounded-full bg-[var(--muted)] flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-[var(--muted-foreground)]" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
        </div>
        <p className="text-[var(--muted-foreground)] text-sm">This page requires elevated access.</p>
      </div>
    );
  }

  return <>{children}</>;
}

export function DeveloperOnly({ children }: { children: React.ReactNode }) {
  const { userRole } = useAccount();

  if (userRole !== 'developer') {
    return (
      <div className="text-center py-16">
        <div className="w-12 h-12 rounded-full bg-[var(--muted)] flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-[var(--muted-foreground)]" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
        </div>
        <p className="text-[var(--muted-foreground)] text-sm">This page requires developer access.</p>
      </div>
    );
  }

  return <>{children}</>;
}
