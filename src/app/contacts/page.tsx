'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { ContactsTable } from '@/components/contacts/contacts-table';
import type { Contact } from '@/lib/contacts/types';
import { ContactsToolbar, ContactsAccountFilter } from '@/components/contacts/contacts-toolbar';
import { AddContactModal } from '@/components/contacts/add-contact-modal';
import {
  UserGroupIcon,
  ArrowUpTrayIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';

interface SingleAccountResponse {
  contacts: Contact[];
  meta: { total: number };
}

// Concurrency for per-account fan-out. Each account = one /api/contacts
// call; 8 in flight keeps total round-trip time low even with 30+
// sub-accounts without overwhelming the dev server or pg pool.
const ADMIN_CONTACTS_FETCH_CONCURRENCY = 8;

export default function ContactsPage() {
  const { isAdmin, accountKey, accounts } = useAccount();

  if (isAdmin) {
    return <AdminContactsView />;
  }

  const assignedKeys = Object.keys(accounts);
  const activeKey = accountKey || assignedKeys[0] || '';

  return <AccountContactsView accountKey={activeKey} />;
}

// ── Shared Filter Logic Hook ──
//
// The /contacts page is now a flat list filtered by sub-account + text
// search. Presets, saved audiences, and the filter builder live on
// /contacts/segments where they're first-class entities instead of
// inline pills.

function useContactFilters(rawContacts: Contact[], initialAccountFilter = '') {
  const [search, setSearch] = useState('');
  const [accountFilters, setAccountFilters] = useState<string[]>(
    initialAccountFilter ? [initialAccountFilter] : [],
  );

  useEffect(() => {
    if (!initialAccountFilter) return;
    setAccountFilters((current) => (current.length > 0 ? current : [initialAccountFilter]));
  }, [initialAccountFilter]);

  const filtered = useMemo(() => {
    let result = rawContacts;

    if (accountFilters.length > 0) {
      result = result.filter((c) => Boolean(c._accountKey && accountFilters.includes(c._accountKey)));
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((c) =>
        (c.fullName || `${c.firstName} ${c.lastName}`).toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.phone?.includes(q) ||
        c.tags?.some((t) => t.toLowerCase().includes(q)) ||
        `${c.vehicleYear} ${c.vehicleMake} ${c.vehicleModel}`.toLowerCase().includes(q),
      );
    }

    return result;
  }, [rawContacts, accountFilters, search]);

  return {
    search,
    setSearch,
    accountFilters,
    setAccountFilters,
    filtered,
  };
}

// ── Admin View ──

function AdminContactsView() {
  const { accounts: accountMap } = useAccount();
  const subHref = useSubaccountHref();
  const searchParams = useSearchParams();
  const requestedAccount = searchParams.get('account') || '';

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);

  const availableAccounts = useMemo(
    () =>
      Object.entries(accountMap)
        .map(([key, account]) => ({
          key,
          dealer: account.dealer || key,
          storefrontImage: account.storefrontImage,
          logos: account.logos,
          city: account.city,
          state: account.state,
        }))
        .sort((a, b) => a.dealer.localeCompare(b.dealer)),
    [accountMap],
  );

  const accountOptions = availableAccounts;

  const presetAccountFilter = useMemo(
    () => (availableAccounts.some((account) => account.key === requestedAccount) ? requestedAccount : ''),
    [availableAccounts, requestedAccount],
  );

  const filters = useContactFilters(contacts, presetAccountFilter);
  const accountKeysToFetch = useMemo(() => {
    const selectedKeys = filters.accountFilters.length > 0
      ? filters.accountFilters
      : availableAccounts.map((account) => account.key);
    return [...new Set(selectedKeys)];
  }, [availableAccounts, filters.accountFilters]);

  const fetchData = useCallback(async () => {
    if (accountKeysToFetch.length === 0) {
      setContacts([]);
      setFetchError('Select at least one sub-account to load contacts.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setFetchError(null);

    // Fan out per-account fetches in chunks. The aggregate endpoint
    // (/api/contacts/aggregate) is reachable but has been observed to
    // return empty contacts arrays in the admin rollup case — until
    // that's diagnosed, the per-account path is the reliable rollup
    // mechanism. Each call uses ?all=true so we get every contact for
    // each sub-account (capped at MAX_FETCH_ALL=5000 per account in
    // listContactsForAccount, which is plenty for an agency tenant).
    const nextContacts: Contact[] = [];
    const failures: string[] = [];
    for (let i = 0; i < accountKeysToFetch.length; i += ADMIN_CONTACTS_FETCH_CONCURRENCY) {
      const chunk = accountKeysToFetch.slice(i, i + ADMIN_CONTACTS_FETCH_CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map(async (key) => {
          const res = await fetch(`/api/contacts?accountKey=${encodeURIComponent(key)}&all=true&includeMessaging=true`);
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            const message = typeof body.error === 'string' ? body.error : `Failed to fetch contacts for ${key}`;
            throw new Error(message);
          }
          const data: SingleAccountResponse = await res.json();
          return {
            key,
            dealer: accountMap[key]?.dealer || key,
            contacts: data.contacts || [],
          };
        }),
      );

      for (const result of settled) {
        if (result.status === 'rejected') {
          failures.push(result.reason instanceof Error ? result.reason.message : 'Failed to fetch contacts');
          continue;
        }

        for (const contact of result.value.contacts) {
          nextContacts.push({
            ...contact,
            _accountKey: result.value.key,
            _dealer: result.value.dealer,
          });
        }
      }
    }

    setContacts(nextContacts);
    if (failures.length === 0) {
      setFetchError(null);
    } else if (failures.length === accountKeysToFetch.length) {
      setFetchError(failures[0]);
    } else {
      setFetchError(`${failures.length} sub-account fetches failed. Showing partial results.`);
    }
    setLoading(false);
  }, [accountKeysToFetch, accountMap]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshTick]);

  return (
    <div>
      <div className="page-sticky-header mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <UserGroupIcon className="w-7 h-7 text-[var(--primary)]" />
            <div>
              <h2 className="text-2xl font-bold">Contacts</h2>
              <p className="text-[var(--muted-foreground)] mt-1">
                Contact data across all accounts
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <ContactsAccountFilter
              values={filters.accountFilters}
              onChange={filters.setAccountFilters}
              accounts={accountOptions}
            />
            <Link
              href={subHref('/contacts/import')}
              className="inline-flex items-center gap-1.5 px-2 h-10 text-sm text-[var(--foreground)] hover:text-[var(--primary)] transition-colors"
            >
              <ArrowUpTrayIcon className="w-4 h-4" />
              Import Contacts
            </Link>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              disabled={filters.accountFilters.length !== 1}
              title={
                filters.accountFilters.length === 1
                  ? 'Add a single contact to this sub-account'
                  : 'Filter to a single sub-account to enable'
              }
              className="flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <PlusIcon className="w-4 h-4" />
              Add Contact
            </button>
          </div>
        </div>
      </div>

      <ContactsToolbar
        search={filters.search}
        onSearchChange={filters.setSearch}
        hasAccountFilter={filters.accountFilters.length > 1}
        totalCount={contacts.length}
        filteredCount={filters.filtered.length}
        loading={loading}
        onRefresh={() => {
          setRefreshTick((value) => value + 1);
        }}
      />

      {showAddModal && filters.accountFilters.length === 1 && (
        <AddContactModal
          accountKey={filters.accountFilters[0]}
          onClose={() => setShowAddModal(false)}
          onCreated={() => setRefreshTick((value) => value + 1)}
        />
      )}

      <ContactsTable
        contacts={filters.filtered}
        loading={loading}
        error={fetchError}
        showAccountColumn
        onMutated={() => setRefreshTick((value) => value + 1)}
      />
    </div>
  );
}

// ── Account View ──

function AccountContactsView({
  accountKey,
}: {
  accountKey: string;
}) {
  const subHref = useSubaccountHref();
  const searchParams = useSearchParams();
  const requestedAccount = searchParams.get('account') || '';
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const fetchData = useCallback(async () => {
    if (!accountKey) {
      setContacts([]);
      setFetchError('No account selected');
      setLoading(false);
      return;
    }

    setLoading(true);
    setFetchError(null);

    try {
      const res = await fetch(
        `/api/contacts?accountKey=${encodeURIComponent(accountKey)}&all=true&includeMessaging=true`,
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed for ${accountKey}`);
      }
      const data: SingleAccountResponse = await res.json();
      const all: Contact[] = (data.contacts || []).map((c) => ({
        ...c,
        _accountKey: accountKey,
      }));
      setContacts(all);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch contacts');
      setContacts([]);
    }
    setLoading(false);
  }, [accountKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const presetAccountFilter = useMemo(
    () => (requestedAccount === accountKey ? requestedAccount : ''),
    [accountKey, requestedAccount],
  );

  const filters = useContactFilters(contacts, presetAccountFilter);

  return (
    <div>
      <div className="page-sticky-header mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <UserGroupIcon className="w-7 h-7 text-[var(--primary)]" />
            <div>
              <h2 className="text-2xl font-bold">Contacts</h2>
              <p className="text-[var(--muted-foreground)] mt-1">
                Your contact database
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Link
              href={subHref('/contacts/import')}
              className="inline-flex items-center gap-1.5 px-2 h-10 text-sm text-[var(--foreground)] hover:text-[var(--primary)] transition-colors"
            >
              <ArrowUpTrayIcon className="w-4 h-4" />
              Import Contacts
            </Link>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              disabled={!accountKey}
              className="flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <PlusIcon className="w-4 h-4" />
              Add Contact
            </button>
          </div>
        </div>
      </div>

      <ContactsToolbar
        search={filters.search}
        onSearchChange={filters.setSearch}
        hasAccountFilter={false}
        totalCount={contacts.length}
        filteredCount={filters.filtered.length}
        loading={loading}
        onRefresh={fetchData}
      />

      {showAddModal && accountKey && (
        <AddContactModal
          accountKey={accountKey}
          onClose={() => setShowAddModal(false)}
          onCreated={fetchData}
        />
      )}

      <ContactsTable
        contacts={filters.filtered}
        loading={loading}
        error={fetchError}
        showAccountColumn={false}
        accountKey={accountKey}
        onMutated={fetchData}
      />
    </div>
  );
}
