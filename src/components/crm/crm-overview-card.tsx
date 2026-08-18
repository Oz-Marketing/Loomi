'use client';

import Link from 'next/link';
import {
  UserGroupIcon,
  ArrowRightIcon,
  LinkIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

interface AccountStat {
  dealer: string;
  contactCount: number | null;
  connected: boolean;
  error?: string;
}

interface CrmOverviewProps {
  stats: Record<string, AccountStat>;
  totalContacts: number;
  connectedAccounts: number;
  totalAccounts: number;
  loading?: boolean;
}

export function CrmOverviewCard({
  stats,
  totalContacts,
  connectedAccounts,
  totalAccounts,
  loading,
}: CrmOverviewProps) {
  const entries = Object.entries(stats).sort((a, b) => {
    // Connected accounts with contacts first, then connected without, then disconnected
    if (a[1].connected !== b[1].connected) return a[1].connected ? -1 : 1;
    const aCount = a[1].contactCount ?? -1;
    const bCount = b[1].contactCount ?? -1;
    if (aCount !== bCount) return bCount - aCount;
    return a[1].dealer.localeCompare(b[1].dealer);
  });

  if (loading) {
    return (
      <div className="animate-fade-in-up animate-stagger-6">
        <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1.5 mb-3">
          <UserGroupIcon className="w-3.5 h-3.5" />
          Contacts Overview
        </h3>
        <div className="text-center py-8 glass-card rounded-xl">
          <p className="text-sm text-[var(--muted-foreground)]">Loading contacts data...</p>
        </div>
      </div>
    );
  }

  if (totalAccounts === 0) return null;

  return (
    <div className="animate-fade-in-up animate-stagger-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1.5">
          <UserGroupIcon className="w-3.5 h-3.5" />
          Contacts Overview
        </h3>
        <div className="flex items-center gap-3 text-[10px] text-[var(--muted-foreground)]">
          <span>{totalContacts.toLocaleString()} total contacts</span>
          <span>{connectedAccounts}/{totalAccounts} connected</span>
        </div>
      </div>

      {/* Account table */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-2 border-b border-[var(--border)] text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
          <span>Account</span>
          <span className="text-right">Contacts</span>
          <span className="w-6" />
        </div>

        <div className="divide-y divide-[var(--border)]">
          {entries.map(([key, stat]) => (
            <Link
              key={key}
              href={`/accounts/${key}`}
              className="grid grid-cols-[1fr_auto_auto] gap-x-4 items-center px-3 py-2.5 hover:bg-[var(--muted)]/30 transition-colors group"
            >
              {/* Account name + status */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium truncate">{stat.dealer}</span>
                {stat.connected ? (
                  <LinkIcon className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                ) : (
                  <span className="text-[10px] text-[var(--muted-foreground)] bg-[var(--muted)] px-1.5 py-0.5 rounded-full flex-shrink-0">
                    Not connected
                  </span>
                )}
                {stat.error && (
                  <ExclamationTriangleIcon className="w-3 h-3 text-amber-400 flex-shrink-0" title={stat.error} />
                )}
              </div>

              {/* Contact count */}
              <div className="text-right">
                {stat.contactCount != null ? (
                  <span className="text-sm font-semibold">{stat.contactCount.toLocaleString()}</span>
                ) : stat.connected ? (
                  <XMarkIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] inline" />
                ) : (
                  <span className="text-[10px] text-[var(--muted-foreground)]">—</span>
                )}
              </div>

              {/* Arrow */}
              <ArrowRightIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
