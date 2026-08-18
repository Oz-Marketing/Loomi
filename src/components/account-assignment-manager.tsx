'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AccountData } from '@/contexts/account-context';
import { AccountAvatar } from '@/components/account-avatar';
import { formatAccountCityState } from '@/lib/account-resolvers';
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';

const ACCOUNTS_PAGE_SIZE = 10;
const PREVIEW_ACCOUNTS_LIMIT = 10;

type AccountSortField = 'dealer' | 'location' | 'key';
type AccountSortDirection = 'asc' | 'desc';

interface AccountAssignmentManagerProps {
  accounts: Record<string, AccountData>;
  accountsLoaded: boolean;
  selectedKeys: string[];
  onChange: (keys: string[]) => void;
  description: string;
  disabled?: boolean;
}

interface AccountRow {
  key: string;
  dealer: string;
  location: string;
  industry: string;
  storefrontImage: string | null;
  logos?: { light?: string; dark?: string; white?: string; black?: string } | null;
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

function normalizeRow(accountKey: string, account: AccountData): AccountRow {
  return {
    key: accountKey,
    dealer: typeof account.dealer === 'string' && account.dealer.trim() ? account.dealer.trim() : accountKey,
    location: formatAccountCityState(account) || 'Location unavailable',
    industry: typeof account.category === 'string' && account.category.trim() ? account.category.trim() : 'General',
    storefrontImage: account.storefrontImage || null,
    logos: account.logos || null,
  };
}

export function AccountAssignmentManager({
  accounts,
  accountsLoaded,
  selectedKeys,
  onChange,
  description,
  disabled = false,
}: AccountAssignmentManagerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showAssignedOnly, setShowAssignedOnly] = useState(false);
  const [sortField, setSortField] = useState<AccountSortField>('dealer');
  const [sortDirection, setSortDirection] = useState<AccountSortDirection>('asc');

  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const allRows = useMemo(() => Object.entries(accounts).map(([key, account]) => normalizeRow(key, account)), [accounts]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setShowAssignedOnly(false);
      setPage(1);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  useEffect(() => {
    setPage(1);
  }, [search, showAssignedOnly]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allRows.filter((row) => {
      if (showAssignedOnly && !selectedSet.has(row.key)) return false;
      if (!query) return true;

      return (
        row.dealer.toLowerCase().includes(query)
        || row.location.toLowerCase().includes(query)
        || row.industry.toLowerCase().includes(query)
        || row.key.toLowerCase().includes(query)
      );
    });
  }, [allRows, search, selectedSet, showAssignedOnly]);

  const sortedRows = useMemo(() => {
    const direction = sortDirection === 'asc' ? 1 : -1;
    return [...filteredRows].sort((rowA, rowB) => {
      let valueA = '';
      let valueB = '';

      if (sortField === 'dealer') {
        valueA = rowA.dealer;
        valueB = rowB.dealer;
      } else if (sortField === 'location') {
        valueA = rowA.location;
        valueB = rowB.location;
      } else {
        valueA = rowA.key;
        valueB = rowB.key;
      }

      const compare = valueA.localeCompare(valueB);
      if (compare !== 0) return compare * direction;
      return rowA.dealer.localeCompare(rowB.dealer) * direction;
    });
  }, [filteredRows, sortDirection, sortField]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / ACCOUNTS_PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageStart = (page - 1) * ACCOUNTS_PAGE_SIZE;
  const pagedRows = sortedRows.slice(pageStart, pageStart + ACCOUNTS_PAGE_SIZE);
  const showingStart = sortedRows.length === 0 ? 0 : pageStart + 1;
  const showingEnd = Math.min(pageStart + ACCOUNTS_PAGE_SIZE, sortedRows.length);
  const visiblePages = getVisiblePages(page, totalPages);
  const filteredSelectedCount = filteredRows.reduce((total, row) => total + (selectedSet.has(row.key) ? 1 : 0), 0);
  const allFilteredSelected = filteredRows.length > 0 && filteredSelectedCount === filteredRows.length;

  const previewRows = useMemo(
    () => allRows.filter((row) => selectedSet.has(row.key)).slice(0, PREVIEW_ACCOUNTS_LIMIT),
    [allRows, selectedSet],
  );

  const sortIndicator = (field: AccountSortField) => {
    if (sortField !== field) return '↕';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  const toggleSort = (field: AccountSortField) => {
    if (sortField === field) {
      setSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setPage(1);
  };

  const normalizeSelection = (selection: Set<string>) => {
    const orderedKeys = allRows
      .filter((row) => selection.has(row.key))
      .map((row) => row.key);

    for (const accountKey of selection) {
      if (!accounts[accountKey]) {
        orderedKeys.push(accountKey);
      }
    }

    return orderedKeys;
  };

  const toggleAccount = (accountKey: string) => {
    if (disabled) return;

    const next = new Set(selectedKeys);
    if (next.has(accountKey)) {
      next.delete(accountKey);
    } else {
      next.add(accountKey);
    }
    onChange(normalizeSelection(next));
  };

  const handleSelectAllFiltered = () => {
    if (disabled || filteredRows.length === 0) return;

    const next = new Set(selectedKeys);
    for (const row of filteredRows) {
      next.add(row.key);
    }
    onChange(normalizeSelection(next));
  };

  const handleClearAll = () => {
    if (disabled || selectedKeys.length === 0) return;
    onChange([]);
  };

  return (
    <>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 p-3.5 space-y-2.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">
              {selectedKeys.length} assigned account{selectedKeys.length === 1 ? '' : 's'}
            </p>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{description}</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={disabled}
            className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--input)] text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Manage
          </button>
        </div>

        {!accountsLoaded ? (
          <p className="text-xs text-[var(--muted-foreground)]">Loading accounts...</p>
        ) : selectedKeys.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">No accounts selected</p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {previewRows.map((row) => (
              <span
                key={row.key}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-[11px] text-[var(--muted-foreground)] max-w-[180px]"
                title={`${row.dealer} • ${row.location} • ${row.industry} • Key: ${row.key}`}
              >
                <AccountAvatar
                  name={row.dealer}
                  accountKey={row.key}
                  storefrontImage={row.storefrontImage}
                  logos={row.logos}
                  size={16}
                  className="rounded-full"
                />
                <span className="truncate">{row.dealer}</span>
              </span>
            ))}
            {selectedKeys.length > previewRows.length && (
              <span className="text-[11px] text-[var(--muted-foreground)]">
                +{selectedKeys.length - previewRows.length} more
              </span>
            )}
          </div>
        )}
      </div>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[190] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-overlay-in"
          onClick={() => setOpen(false)}
        >
          <div
            className="glass-modal w-full max-w-5xl max-h-[86vh] flex flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 p-5 border-b border-[var(--border)]">
              <div>
                <h3 className="text-lg font-semibold text-[var(--foreground)]">Manage Assigned Accounts</h3>
                <p className="text-xs text-[var(--muted-foreground)] mt-1">{description}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-b border-[var(--border)] flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-64">
                <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search accounts..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
                />
              </div>

              <label className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-1.5 bg-[var(--input)] text-xs text-[var(--muted-foreground)]">
                <input
                  type="checkbox"
                  checked={showAssignedOnly}
                  onChange={(event) => setShowAssignedOnly(event.target.checked)}
                  className="h-3.5 w-3.5 rounded border-[var(--border)] bg-[var(--card)]"
                />
                Show assigned only
              </label>

              <button
                type="button"
                onClick={handleSelectAllFiltered}
                disabled={disabled || !accountsLoaded || filteredRows.length === 0 || allFilteredSelected}
                className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--input)] text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Select all filtered
              </button>

              <button
                type="button"
                onClick={handleClearAll}
                disabled={disabled || selectedKeys.length === 0}
                className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--input)] text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Clear all
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 min-h-0">
              {!accountsLoaded ? (
                <p className="text-sm text-[var(--muted-foreground)] text-center py-8">Loading accounts...</p>
              ) : allRows.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)] text-center py-8">No accounts available</p>
              ) : filteredRows.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)] text-center py-8">
                  {search ? 'No accounts match your search' : 'No assigned accounts in this view'}
                </p>
              ) : (
                <>
                  <div className="glass-table overflow-hidden">
                    <table className="w-full min-w-[760px]">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
                          <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                            <button
                              type="button"
                              onClick={() => toggleSort('dealer')}
                              className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors"
                            >
                              Account
                              <span className="text-[10px]">{sortIndicator('dealer')}</span>
                            </button>
                          </th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                            <button
                              type="button"
                              onClick={() => toggleSort('location')}
                              className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors"
                            >
                              Location
                              <span className="text-[10px]">{sortIndicator('location')}</span>
                            </button>
                          </th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                            <button
                              type="button"
                              onClick={() => toggleSort('key')}
                              className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors"
                            >
                              Key
                              <span className="text-[10px]">{sortIndicator('key')}</span>
                            </button>
                          </th>
                          <th className="w-20 px-3 py-2 text-right text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                            Selected
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedRows.map((row) => {
                          const selected = selectedSet.has(row.key);
                          return (
                            <tr
                              key={row.key}
                              onClick={() => toggleAccount(row.key)}
                              className={`border-b border-[var(--border)] last:border-b-0 transition-colors ${
                                selected ? 'bg-[var(--primary)]/10' : 'hover:bg-[var(--muted)]/50'
                              } ${disabled ? '' : 'cursor-pointer'}`}
                            >
                              <td className="px-3 py-2 align-middle">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <AccountAvatar
                                    name={row.dealer}
                                    accountKey={row.key}
                                    storefrontImage={row.storefrontImage}
                                    logos={row.logos}
                                    size={30}
                                    className="rounded-md border border-[var(--border)]"
                                  />
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-[var(--foreground)] truncate">{row.dealer}</p>
                                    <p className="text-[11px] text-[var(--muted-foreground)] truncate">{row.industry}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-2 align-middle text-sm text-[var(--muted-foreground)]">
                                {row.location}
                              </td>
                              <td className="px-3 py-2 align-middle">
                                <span className="text-xs font-mono text-[var(--muted-foreground)]">{row.key}</span>
                              </td>
                              <td className="px-3 py-2 align-middle text-right">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={() => toggleAccount(row.key)}
                                  disabled={disabled}
                                  className="h-4 w-4 rounded border-[var(--border)] bg-[var(--card)]"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between mt-3">
                    <p className="text-xs text-[var(--muted-foreground)]">
                      Showing {showingStart}-{showingEnd} of {sortedRows.length}
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
                        onClick={() => setPage((previous) => Math.max(1, previous - 1))}
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
                        onClick={() => setPage((previous) => Math.min(totalPages, previous + 1))}
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
                </>
              )}
            </div>

            <div className="p-4 border-t border-[var(--border)] flex items-center justify-between gap-3">
              <p className="text-xs text-[var(--muted-foreground)]">Selections save immediately to the form.</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--input)] text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
