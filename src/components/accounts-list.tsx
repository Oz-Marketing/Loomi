'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  PlusIcon,
  XMarkIcon,
  TrashIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { AccountAvatar } from '@/components/account-avatar';
import { UserAvatar } from '@/components/user-avatar';
import { UserPicker, type UserPickerUser } from '@/components/user-picker';
import { OemMultiSelect } from '@/components/oem-multi-select';
import { formatAccountCityState } from '@/lib/account-resolvers';
import { industryHasBrands, brandsForIndustry } from '@/lib/oems';
import { useAccount, type AccountData } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';

type CreateMode = null | 'manual';
type SortDirection = 'asc' | 'desc';
type AccountSortField = 'dealer' | 'category' | 'location' | 'rep';

interface AccountsListProps {
  listPath?: string;
  detailBasePath?: string;
}

const CATEGORY_SUGGESTIONS = ['Automotive', 'Powersports', 'Ecommerce', 'Healthcare', 'Real Estate', 'Hospitality', 'Retail', 'General'];
const ACCOUNTS_PAGE_SIZE = 10;

/** Convert a display name to camelCase slug, e.g. "Young Ford Ogden" → "youngFordOgden" */
function toCamelCaseSlug(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join('');
}

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

export function AccountsList({
  listPath: _listPath = '/subaccounts',
  detailBasePath = '/subaccounts',
}: AccountsListProps) {
  void _listPath;
  const router = useRouter();
  const { confirm } = useLoomiDialog();
  const { userRole } = useAccount();
  const canManageAccounts = userRole === 'developer' || userRole === 'super_admin';
  const [accounts, setAccounts] = useState<Record<string, AccountData> | null>(null);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<AccountSortField>('dealer');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(1);

  // Create account state
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [newKey, setNewKey] = useState('');
  const [newDealer, setNewDealer] = useState('');
  const [newCategory, setNewCategory] = useState('General');
  const [newOems, setNewOems] = useState<string[]>([]);
  const [newRepId, setNewRepId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Users for account rep picker (fetched when creation modal opens)
  const [repUsers, setRepUsers] = useState<UserPickerUser[]>([]);

  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then(data => setAccounts(data))
      .catch(err => console.error(err));
  }, []);

  // Fetch users for rep picker when creation modal opens
  useEffect(() => {
    if (createMode) {
      fetch('/api/users')
        .then(r => r.json())
        .then((data: Array<{ id: string; name: string; title?: string | null; email: string; avatarUrl?: string | null; role?: string }>) => {
          // Exclude developers from rep list (they shouldn't be account reps)
          const eligible = data
            .filter(u => u.role !== 'developer')
            .map(u => ({ id: u.id, name: u.name, title: u.title, email: u.email, avatarUrl: u.avatarUrl }));
          setRepUsers(eligible);
        })
        .catch(() => setRepUsers([]));
    }
  }, [createMode]);

  const resetCreate = () => {
    setCreateMode(null);
    setNewKey('');
    setNewDealer('');
    setNewCategory('General');
    setNewOems([]);
    setNewRepId(null);
    setCreating(false);
  };

  /** Create account — simplified: name + industry + optional brand, then redirect to detail page */
  const handleCreateManual = async () => {
    if (!newKey.trim() || !newDealer.trim() || creating) return;
    setCreating(true);
    try {
      const hasBrands = industryHasBrands(newCategory);
      const selectedOems = hasBrands ? newOems : [];
      const accountBody: Record<string, unknown> = {
        key: newKey.trim(),
        dealer: newDealer.trim(),
        category: newCategory,
        oems: selectedOems.length > 0 ? selectedOems : undefined,
        oem: selectedOems[0] || undefined,
        accountRepId: newRepId || undefined,
      };

      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accountBody),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to create'); setCreating(false); return; }

      toast.success('Sub-account created!');
      resetCreate();
      // Redirect to the new account's detail page
      router.push(`${detailBasePath}/${newKey.trim()}`);
    } catch {
      toast.error('Failed to create sub-account');
    }
    setCreating(false);
  };


  const handleDelete = async (key: string) => {
    const confirmed = await confirm({
      title: 'Delete Sub-account',
      message: `Delete sub-account "${accounts?.[key]?.dealer || key}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/accounts?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); toast.error(d.error || 'Failed to delete'); return; }
      setAccounts(prev => {
        if (!prev) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch {
      toast.error('Failed to delete account');
    }
  };

  const allEntries = useMemo(() => Object.entries(accounts || {}), [accounts]);
  const filteredEntries = useMemo(() => {
    if (!search) return allEntries;

    const q = search.toLowerCase();
    return allEntries.filter(([key, account]) => (
      (account.dealer || '').toLowerCase().includes(q) ||
      key.toLowerCase().includes(q) ||
      (account.category || '').toLowerCase().includes(q) ||
      (account.city || '').toLowerCase().includes(q) ||
      (account.state || '').toLowerCase().includes(q) ||
      (account.accountRep?.name || '').toLowerCase().includes(q)
    ));
  }, [allEntries, search]);

  const sortedEntries = useMemo(() => {
    const direction = sortDirection === 'asc' ? 1 : -1;
    const sorted = [...filteredEntries];

    sorted.sort(([keyA, accountA], [keyB, accountB]) => {
      const dealerA = (accountA.dealer || keyA).toLowerCase();
      const dealerB = (accountB.dealer || keyB).toLowerCase();

      let compareValue = 0;

      if (sortField === 'dealer') {
        compareValue = dealerA.localeCompare(dealerB);
      } else if (sortField === 'category') {
        compareValue = (accountA.category || '').toLowerCase().localeCompare((accountB.category || '').toLowerCase());
      } else if (sortField === 'location') {
        compareValue = (formatAccountCityState(accountA) || '').toLowerCase().localeCompare((formatAccountCityState(accountB) || '').toLowerCase());
      } else if (sortField === 'rep') {
        compareValue = (accountA.accountRep?.name || '').toLowerCase().localeCompare((accountB.accountRep?.name || '').toLowerCase());
      }

      if (compareValue === 0) {
        compareValue = dealerA.localeCompare(dealerB);
      }

      return compareValue * direction;
    });

    return sorted;
  }, [filteredEntries, sortDirection, sortField]);

  const totalPages = Math.max(1, Math.ceil(sortedEntries.length / ACCOUNTS_PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pageStart = (page - 1) * ACCOUNTS_PAGE_SIZE;
  const pagedEntries = sortedEntries.slice(pageStart, pageStart + ACCOUNTS_PAGE_SIZE);
  const visiblePages = getVisiblePages(page, totalPages);
  const showingStart = sortedEntries.length === 0 ? 0 : pageStart + 1;
  const showingEnd = Math.min(pageStart + ACCOUNTS_PAGE_SIZE, sortedEntries.length);

  const toggleSort = (field: AccountSortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setPage(1);
  };

  const sortIndicator = (field: AccountSortField) => {
    if (sortField !== field) return '↕';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  const showManualBrands = industryHasBrands(newCategory);

  if (!accounts) return <div className="text-[var(--muted-foreground)]">Loading...</div>;

  const titleActionsEl = typeof document !== 'undefined' ? document.getElementById('settings-title-actions') : null;

  return (
    <div>
      {/* Portal action button into the settings title bar */}
      {canManageAccounts && titleActionsEl && createPortal(
        <button
          onClick={() => setCreateMode('manual')}
          className="flex items-center gap-1.5 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <PlusIcon className="w-4 h-4" /> New Sub-Account
        </button>,
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
            placeholder="Search sub-accounts..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>

      {/* ─── Add Account Modal ─── */}
      {createMode && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-overlay-in">
          <div className="glass-modal w-full max-w-lg mx-4">

            {/* ── Manual Create (simplified: Name + Industry + Brand) ── */}
            {createMode === 'manual' && (
              <div className="p-6">
                <div className="flex items-center gap-3 mb-6">
                  <h3 className="text-lg font-semibold flex-1">Create Sub-Account</h3>
                  <button onClick={resetCreate} className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]">
                    <XMarkIcon className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Sub-Account Name *</label>
                    <input
                      type="text"
                      value={newDealer}
                      onChange={(e) => {
                        setNewDealer(e.target.value);
                        setNewKey(toCamelCaseSlug(e.target.value));
                      }}
                      className="w-full bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
                      placeholder="e.g. Young Ford Ogden"
                      autoFocus
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Slug</label>
                      <input
                        type="text"
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                        className="w-full bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--muted-foreground)]"
                        placeholder="auto-generated"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Industry</label>
                      <select
                        value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value)}
                        className="w-full bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
                      >
                        {CATEGORY_SUGGESTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  {showManualBrands && (
                    <div>
                      <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Brands</label>
                      <OemMultiSelect
                        value={newOems}
                        onChange={setNewOems}
                        options={brandsForIndustry(newCategory)}
                        placeholder="Select brands..."
                        maxSelections={8}
                      />
                    </div>
                  )}

                  {/* Account Rep picker */}
                  <div>
                    <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Account Rep</label>
                    <div className="flex items-center gap-2">
                      <UserPicker
                        value={newRepId}
                        onChange={setNewRepId}
                        users={repUsers}
                        placeholder="Assign a rep..."
                      />
                    </div>
                    {repUsers.length === 0 && (
                      <p className="text-[10px] text-[var(--muted-foreground)] mt-1">
                        No eligible users found.{' '}
                        <Link
                          href="/users/new"
                          className="text-[var(--primary)] hover:underline"
                        >
                          Create a new user
                        </Link>
                      </p>
                    )}
                    {repUsers.length > 0 && !newRepId && (
                      <p className="text-[10px] text-[var(--muted-foreground)] mt-1">
                        Don&apos;t see the right person?{' '}
                        <Link
                          href="/users/new"
                          className="text-[var(--primary)] hover:underline"
                        >
                          Create a new user
                        </Link>
                      </p>
                    )}
                  </div>
                </div>

                <p className="text-[11px] text-[var(--muted-foreground)] mt-4">
                  You&apos;ll be taken to the account detail page to add business details, logos, and sending credentials.
                </p>

                <div className="flex items-center gap-2 mt-4">
                  <button
                    onClick={handleCreateManual}
                    disabled={!newKey.trim() || !newDealer.trim() || creating}
                    className="flex-1 px-4 py-2.5 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    {creating ? 'Creating...' : 'Create Sub-Account'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}

      {/* ─── Account Table ─── */}
      {sortedEntries.length === 0 ? (
        <div className="text-center py-16 text-[var(--muted-foreground)]">
          <p className="text-sm">{search ? 'No sub-accounts match your search.' : 'No sub-accounts yet.'}</p>
          <p className="text-xs mt-1">
            {search ? 'Try a different search term.' : 'Click &quot;New Sub-Account&quot; to get started.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto glass-table">
          <table className="w-full min-w-[700px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
                <th className="w-12 px-3 py-2"></th>
                <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                  <button type="button" onClick={() => toggleSort('dealer')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                    Sub-Account Name
                    <span className="text-[10px]">{sortIndicator('dealer')}</span>
                  </button>
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                  <button type="button" onClick={() => toggleSort('category')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                    Industry
                    <span className="text-[10px]">{sortIndicator('category')}</span>
                  </button>
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                  <button type="button" onClick={() => toggleSort('location')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                    Location
                    <span className="text-[10px]">{sortIndicator('location')}</span>
                  </button>
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                  <button type="button" onClick={() => toggleSort('rep')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                    Account Rep
                    <span className="text-[10px]">{sortIndicator('rep')}</span>
                  </button>
                </th>
                <th className="w-10 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {pagedEntries.map(([key, account]) => {
                const cityState = formatAccountCityState(account) || '';
                return (
                  <tr
                    key={key}
                    onClick={() => router.push(`${detailBasePath}/${key}`)}
                    className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--muted)]/50 transition-colors cursor-pointer"
                  >
                    <td className="px-3 py-2 align-middle">
                      <div className="flex items-center justify-center h-full">
                        <AccountAvatar
                          name={account.dealer}
                          accountKey={key}
                          storefrontImage={account.storefrontImage}
                          logos={account.logos}
                          size={36}
                          className="w-9 h-9 rounded-md object-cover flex-shrink-0 border border-[var(--border)]"
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <span className="text-sm font-medium">{account.dealer}</span>
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <span className="text-xs text-[var(--muted-foreground)] bg-[var(--muted)] px-2 py-0.5 rounded-full">
                        {account.category || 'General'}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {cityState || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-middle">
                      {account.accountRep ? (
                        <Link
                          href={`/settings/users/${account.accountRep.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-2 group"
                        >
                          <UserAvatar
                            name={account.accountRep.name}
                            email={account.accountRep.email}
                            avatarUrl={account.accountRep.avatarUrl}
                            size={28}
                            className="w-7 h-7 rounded-full object-cover flex-shrink-0 border border-[var(--border)]"
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-[var(--foreground)] truncate group-hover:text-[var(--primary)] transition-colors">
                              {account.accountRep.name}
                            </p>
                            <p className="text-[10px] text-[var(--muted-foreground)] truncate leading-tight">
                              {account.accountRep.email}
                            </p>
                          </div>
                        </Link>
                      ) : (
                        <span className="text-xs text-[var(--muted-foreground)]">—</span>
                      )}
                    </td>
                    {canManageAccounts && (
                      <td className="px-3 py-2 align-middle">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(key); }}
                          className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Delete sub-account"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {sortedEntries.length > 0 && (
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-[var(--muted-foreground)]">
            Showing {showingStart}-{showingEnd} of {sortedEntries.length}
          </p>
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
                    ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
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
