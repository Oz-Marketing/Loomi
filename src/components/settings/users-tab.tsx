'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useAccount, type AccountData } from '@/contexts/account-context';
import { toast } from '@/lib/toast';
import PrimaryButton from '@/components/primary-button';
import { UserAvatar } from '@/components/user-avatar';
import { AccountAvatar } from '@/components/account-avatar';
import { roleDisplayName } from '@/lib/roles';
import { formatAccountCityState } from '@/lib/account-resolvers';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';

interface User {
  id: string;
  name: string;
  title: string | null;
  email: string;
  avatarUrl: string | null;
  role: string;
  accountKeys: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

const roleColors: Record<string, string> = {
  developer: 'text-purple-400 bg-purple-500/10',
  super_admin: 'text-amber-400 bg-amber-500/10',
  admin: 'text-blue-400 bg-blue-500/10',
  client: 'text-green-400 bg-green-500/10',
};

type UserSortField = 'name' | 'email' | 'role' | 'accounts' | 'lastLogin';
type UserSortDirection = 'asc' | 'desc';

function getVisiblePages(currentPage: number, totalPages: number, maxVisible = 5): number[] {
  if (totalPages <= maxVisible) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const halfWindow = Math.floor(maxVisible / 2);
  let start = Math.max(1, currentPage - halfWindow);
  let end = start + maxVisible - 1;

  if (end > totalPages) {
    end = totalPages;
    start = Math.max(1, end - maxVisible + 1);
  }

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function formatLastLoginDate(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function resolveAccountSummary(accountKey: string, account: AccountData | null | undefined): {
  dealer: string;
  cityState: string;
  industry: string;
} {
  const dealer = typeof account?.dealer === 'string' && account.dealer.trim()
    ? account.dealer.trim()
    : accountKey;
  const cityState = formatAccountCityState(account)
    || 'Location unavailable';
  const industry = typeof account?.category === 'string' && account.category.trim()
    ? account.category.trim()
    : 'Unknown industry';

  return { dealer, cityState, industry };
}

export function UsersTab() {
  const router = useRouter();
  const { isAccount, accountKey, accounts, userRole } = useAccount();
  const canEditUsers = userRole === 'developer' || userRole === 'super_admin';
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<UserSortField>('name');
  const [sortDirection, setSortDirection] = useState<UserSortDirection>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    fetch('/api/users')
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          throw new Error(data?.error || 'Failed to load users');
        }
        if (!Array.isArray(data)) {
          throw new Error('Unexpected users response');
        }
        return data as User[];
      })
      .then(setUsers)
      .catch((err: unknown) => {
        setUsers([]);
        toast.error(err instanceof Error ? err.message : 'Failed to load users');
      })
      .finally(() => setLoading(false));
  }, []);

  const scopedUsers = useMemo(() => {
    if (!isAccount || !accountKey) return users;
    return users.filter((user) => user.accountKeys.includes(accountKey));
  }, [users, isAccount, accountKey]);

  const filteredUsers = useMemo(() => {
    if (!search) return scopedUsers;

    const q = search.toLowerCase();
    return scopedUsers.filter((u) => (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q) ||
      (u.title || '').toLowerCase().includes(q)
    ));
  }, [scopedUsers, search]);

  const sortedUsers = useMemo(() => {
    const direction = sortDirection === 'asc' ? 1 : -1;
    const sorted = [...filteredUsers];

    sorted.sort((a, b) => {
      let compareValue = 0;

      if (sortField === 'name') {
        compareValue = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      } else if (sortField === 'email') {
        compareValue = a.email.toLowerCase().localeCompare(b.email.toLowerCase());
      } else if (sortField === 'role') {
        compareValue = a.role.toLowerCase().localeCompare(b.role.toLowerCase());
      } else if (sortField === 'accounts') {
        compareValue = a.accountKeys.length - b.accountKeys.length;
      } else if (sortField === 'lastLogin') {
        const aLastLogin = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
        const bLastLogin = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
        compareValue = aLastLogin - bLastLogin;
      }

      if (compareValue === 0) {
        compareValue = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      }

      return compareValue * direction;
    });

    return sorted;
  }, [filteredUsers, sortDirection, sortField]);

  const totalPages = Math.max(1, Math.ceil(sortedUsers.length / pageSize));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pageStart = (page - 1) * pageSize;
  const pagedUsers = sortedUsers.slice(pageStart, pageStart + pageSize);
  const visiblePages = getVisiblePages(page, totalPages);
  const showingStart = sortedUsers.length === 0 ? 0 : pageStart + 1;
  const showingEnd = Math.min(pageStart + pageSize, sortedUsers.length);

  const toggleSort = (field: UserSortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setPage(1);
  };

  const sortIndicator = (field: UserSortField) => {
    if (sortField !== field) return '\u2195';
    return sortDirection === 'asc' ? '\u2191' : '\u2193';
  };

  const titleActionsEl = typeof document !== 'undefined' ? document.getElementById('settings-title-actions') : null;

  return (
    <div>
      {/* Portal action button into the settings title bar */}
      {canEditUsers && titleActionsEl && createPortal(
        <PrimaryButton
          onClick={() => router.push('/settings/users/new')}
        >
          <PlusIcon className="w-4 h-4" />
          Add User
        </PrimaryButton>,
        titleActionsEl,
      )}

      <div className="mb-4">
        <div className="relative w-52">
          <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--foreground)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search users..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>

      <div className="glass-table account-tooltip-table">
        <div className="users-table-scroll">
        <table className="w-full min-w-[900px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
              <th className="w-12 px-3 py-2"></th>
              <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                <button type="button" onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                  Name
                  <span className="text-[10px]">{sortIndicator('name')}</span>
                </button>
              </th>
              <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                <button type="button" onClick={() => toggleSort('email')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                  Email
                  <span className="text-[10px]">{sortIndicator('email')}</span>
                </button>
              </th>
              <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                <button type="button" onClick={() => toggleSort('role')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                  Role
                  <span className="text-[10px]">{sortIndicator('role')}</span>
                </button>
              </th>
              <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                <button type="button" onClick={() => toggleSort('accounts')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                  Sub-Accounts
                  <span className="text-[10px]">{sortIndicator('accounts')}</span>
                </button>
              </th>
              <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                <button type="button" onClick={() => toggleSort('lastLogin')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                  Last Login
                  <span className="text-[10px]">{sortIndicator('lastLogin')}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">Loading...</td>
              </tr>
            ) : sortedUsers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
                  {search
                    ? 'No users match your search'
                    : isAccount
                      ? 'No users are assigned to this sub-account'
                      : 'No users found'}
                </td>
              </tr>
            ) : (
              pagedUsers.map(user => (
                <tr
                  key={user.id}
                  onClick={canEditUsers ? () => router.push(`/settings/users/${user.id}`) : undefined}
                  className={`border-b border-[var(--border)] last:border-b-0 transition-colors ${canEditUsers ? 'hover:bg-[var(--muted)]/50 cursor-pointer' : ''}`}
                >
                  <td className="px-3 py-2 align-middle">
                    <div className="flex items-center justify-center h-full">
                      <UserAvatar
                        name={user.name}
                        email={user.email}
                        avatarUrl={user.avatarUrl}
                        size={36}
                        className="w-9 h-9 rounded-full object-cover flex-shrink-0 border border-[var(--border)]"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--foreground)] truncate">{user.name}</p>
                      {user.title && (
                        <p className="text-xs text-[var(--muted-foreground)] truncate">{user.title}</p>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-middle text-sm text-[var(--muted-foreground)]">{user.email}</td>
                  <td className="px-3 py-2 align-middle">
                    <span className={`text-[10px] font-medium uppercase tracking-wider rounded px-1.5 py-0.5 ${roleColors[user.role] || ''}`}>
                      {roleDisplayName(user.role)}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-middle text-sm text-[var(--muted-foreground)]">
                    {user.accountKeys.length === 0 ? (
                      <span className="text-xs opacity-50">All sub-accounts</span>
                    ) : (
                      <div className="account-avatar-stack flex items-center pl-2">
                        {user.accountKeys.slice(0, 4).map((acctKey) => {
                          const account = accounts[acctKey] || null;
                          const summary = resolveAccountSummary(acctKey, account);

                          return (
                            <span
                              key={acctKey}
                              aria-label={`${summary.dealer} \u2022 ${summary.cityState} \u2022 ${summary.industry} \u2022 Key: ${acctKey}`}
                              className="relative inline-flex items-center group account-avatar-stack-item"
                            >
                              <span className="pointer-events-none absolute bottom-full left-1/2 z-[90] mb-2 hidden -translate-x-1/2 group-hover:block">
                                <span className="relative block account-tooltip-popover rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 shadow-xl whitespace-nowrap">
                                  <span className="block text-[11px] font-medium leading-4 text-[var(--foreground)]">
                                    {summary.dealer}
                                  </span>
                                  <span className="block text-[10px] leading-4 text-[var(--muted-foreground)]">
                                    {summary.cityState}
                                  </span>
                                  <span className="block text-[10px] leading-4 text-[var(--muted-foreground)]">
                                    {summary.industry}
                                  </span>
                                  <span className="mt-1 block text-[10px] font-mono leading-4 text-[var(--muted-foreground)]">
                                    Key: {acctKey}
                                  </span>
                                  <span className="absolute left-1/2 top-full -translate-x-1/2 w-0 h-0 border-x-[6px] border-x-transparent border-t-[7px] border-t-[var(--background)]" />
                                </span>
                              </span>

                              <span className="inline-flex rounded-full bg-[var(--background)] p-[1px] shadow-sm">
                                <AccountAvatar
                                  name={summary.dealer}
                                  accountKey={acctKey}
                                  storefrontImage={account?.storefrontImage || null}
                                  logos={account?.logos}
                                  size={32}
                                  className="rounded-full"
                                  alt={`${summary.dealer} (${acctKey})`}
                                />
                              </span>
                            </span>
                          );
                        })}

                        {user.accountKeys.length > 4 && (
                          <span
                            title={`${user.accountKeys.length - 4} more sub-account${user.accountKeys.length - 4 === 1 ? '' : 's'}`}
                            className="account-avatar-stack-item inline-flex items-center justify-center w-[34px] h-[34px] rounded-full border border-[var(--background)] bg-[var(--background)] text-[10px] font-medium text-[var(--muted-foreground)] shadow-sm"
                          >
                            +{user.accountKeys.length - 4}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-middle text-sm text-[var(--muted-foreground)]">
                    {formatLastLoginDate(user.lastLoginAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      {!loading && sortedUsers.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--muted-foreground)]">Show</span>
            <div className="w-20">
              <SearchableSelect
                value={String(pageSize)}
                onChange={(v) => {
                  setPageSize(Number(v));
                  setPage(1);
                }}
                options={[10, 20, 50, 100].map((n) => ({ value: String(n), label: String(n) }))}
                searchable={false}
              />
            </div>
            <span className="text-xs text-[var(--muted-foreground)]">
              · {showingStart}-{showingEnd} of {sortedUsers.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="px-2 py-1 text-xs rounded-md border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--muted)] transition-colors"
            >
              First
            </button>
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page === 1}
              className="px-2 py-1 text-xs rounded-md border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--muted)] transition-colors"
            >
              Prev
            </button>
            {visiblePages.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                onClick={() => setPage(pageNumber)}
                className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                  pageNumber === page
                    ? 'bg-[var(--primary)]/10 text-[var(--primary)] border-[var(--primary)] font-medium'
                    : 'border-[var(--border)] hover:bg-[var(--muted)]'
                }`}
              >
                {pageNumber}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={page === totalPages}
              className="px-2 py-1 text-xs rounded-md border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--muted)] transition-colors"
            >
              Next
            </button>
            <button
              type="button"
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              className="px-2 py-1 text-xs rounded-md border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--muted)] transition-colors"
            >
              Last
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
