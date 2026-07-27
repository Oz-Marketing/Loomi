'use client';

/**
 * Agency View dashboard — the admin landing page for the platform-management
 * tier. Unlike the sub-account / org home (the AI campaign builder), the agency
 * doesn't run campaigns; it manages the shared template library, organizations,
 * and every sub-account. So this is an overview + jump-off, not a builder.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BuildingOffice2Icon,
  BuildingStorefrontIcon,
  BookOpenIcon,
  Cog6ToothIcon,
  ArrowRightIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { orgSlugFor } from '@/lib/account-slugs';

export function AgencyDashboard() {
  const { organizations, accounts, userName } = useAccount();
  const [templateCount, setTemplateCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/templates?scope=library')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown[]) => { if (!cancelled) setTemplateCount(Array.isArray(data) ? data.length : 0); })
      .catch(() => { if (!cancelled) setTemplateCount(0); });
    return () => { cancelled = true; };
  }, []);

  const orgList = useMemo(
    () => Object.values(organizations).sort((a, b) => a.name.localeCompare(b.name)),
    [organizations],
  );
  const orgCount = orgList.length;
  const accountCount = Object.keys(accounts).length;
  // Sub-accounts not attached to any org (standalone clients).
  const standaloneCount = Object.values(accounts).filter((a) => !a.organizationId).length;

  const stats: { label: string; value: string; href: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { label: 'Organizations', value: String(orgCount), href: '/settings/organizations', icon: BuildingOffice2Icon },
    { label: 'Sub-Accounts', value: String(accountCount), href: '/settings/subaccounts', icon: BuildingStorefrontIcon },
    { label: 'Library Templates', value: templateCount === null ? '—' : String(templateCount), href: '/templates', icon: BookOpenIcon },
  ];

  return (
    <div className="animate-fade-in-up pt-4 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--foreground)]">
          {userName ? `Welcome back, ${userName.split(' ')[0]}.` : 'Agency View'}
        </h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Manage the platform, the shared template library, and every client.
        </p>
      </div>

      {/* Platform stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="glass-section-card rounded-2xl border border-[var(--border)] p-5 transition-colors hover:border-[var(--primary)]/40 group"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-lg bg-[var(--primary)]/15 flex items-center justify-center">
                <s.icon className="w-5 h-5 text-[var(--primary)]" />
              </div>
              <ArrowRightIcon className="w-4 h-4 text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="mt-4 text-3xl font-bold tabular-nums text-[var(--foreground)]">{s.value}</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{s.label}</p>
          </Link>
        ))}
      </div>

      {/* Organizations overview */}
      <section className="glass-section-card rounded-2xl border border-[var(--border)] p-5 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Organizations</h2>
          <Link href="/settings/organizations" className="text-xs font-medium text-[var(--primary)] hover:underline">
            Manage →
          </Link>
        </div>
        {orgList.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)] py-6 text-center">
            No organizations yet. Create one in Settings → Organizations, or promote a sub-account into a group.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {orgList.map((org) => (
              <Link
                key={org.id}
                href={`/org/${orgSlugFor(org)}/dashboard`}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[var(--border)] hover:bg-[var(--muted)] transition-colors"
              >
                <div className="w-8 h-8 rounded-md bg-[var(--primary)]/15 flex items-center justify-center flex-shrink-0">
                  <BuildingOffice2Icon className="w-4 h-4 text-[var(--primary)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--foreground)] truncate">{org.name}</p>
                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    {org.accountKeys.length} sub-account{org.accountKeys.length === 1 ? '' : 's'}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Footer quick links */}
      <div className="flex flex-wrap items-center gap-2 mt-6 text-xs">
        <span className="text-[var(--muted-foreground)]">Quick links:</span>
        <Link href="/templates" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] transition-colors">
          <BookOpenIcon className="w-3.5 h-3.5" /> Template Library
        </Link>
        <Link href="/settings/subaccounts" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] transition-colors">
          <BuildingStorefrontIcon className="w-3.5 h-3.5" /> Sub-Accounts{standaloneCount > 0 ? ` (${standaloneCount} standalone)` : ''}
        </Link>
        <Link href="/settings" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] transition-colors">
          <Cog6ToothIcon className="w-3.5 h-3.5" /> Settings
        </Link>
      </div>
    </div>
  );
}
