'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { ContactsTable } from '@/components/contacts/contacts-table';
import type { Contact, ContactAccountRef } from '@/lib/contacts/types';
import { normalisePhone } from '@/lib/contacts/normalize';
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

/**
 * Identity key used to deduplicate contacts that appear in multiple
 * sub-accounts (e.g. one shopper who's signed up at 3 dealers under the
 * same agency). Lowercase email wins when present — emails are the
 * cleanest unique handle. Falls back to E.164-normalised phone so we
 * still catch SMS-only contacts. Returns null when the row has neither;
 * those rows stay un-merged.
 */
function contactIdentityKey(c: Contact): string | null {
  const email = (c.email || '').trim().toLowerCase();
  if (email) return `email:${email}`;
  const phone = normalisePhone(c.phone || '');
  if (phone) return `phone:${phone}`;
  return null;
}

/**
 * Pull the avatar-stack-relevant fields off the account-context dict
 * for one sub-account. Returns null when the key isn't known to the
 * client (e.g. a contact references a deleted account), in which case
 * the caller falls back to a minimal {key, dealer: key} record so the
 * avatar still renders something instead of a hole.
 */
function buildAccountRef(
  key: string,
  accountMap: Record<string, {
  dealer?: string;
  storefrontImage?: string | null;
  logos?: { light?: string; dark?: string; white?: string; black?: string } | null;
  city?: string | null;
  state?: string | null;
  category?: string | null;
}>,
): ContactAccountRef {
  const acc = accountMap[key];
  if (!acc) return { key, dealer: key };
  return {
    key,
    dealer: acc.dealer || key,
    storefrontImage: acc.storefrontImage ?? null,
    logos: acc.logos ?? null,
    city: acc.city ?? null,
    state: acc.state ?? null,
    category: acc.category ?? null,
  };
}

/**
 * Collapse contacts that share an identity key (same email or phone)
 * across sub-accounts into a single row whose `_accounts` array carries
 * every sub-account membership. Single-membership contacts still get a
 * 1-element `_accounts` array so the contacts-table can render avatars
 * uniformly regardless of cardinality.
 *
 * For each merged group the first contact (fetch order) supplies the
 * primary row data; we sort `_accounts` alphabetically by dealer name
 * and set `_accountKey`/`_dealer` to the alphabetically-first one so
 * the table's existing sort-by-dealer column behaves predictably.
 */
function mergeContactsByIdentity(
  contacts: Contact[],
  accountMap: Record<string, {
  dealer?: string;
  storefrontImage?: string | null;
  logos?: { light?: string; dark?: string; white?: string; black?: string } | null;
  city?: string | null;
  state?: string | null;
  category?: string | null;
}>,
): Contact[] {
  const groups = new Map<string, Contact[]>();
  const ungrouped: Contact[] = [];

  for (const c of contacts) {
    const k = contactIdentityKey(c);
    if (!k) {
      ungrouped.push(c);
      continue;
    }
    const arr = groups.get(k);
    if (arr) arr.push(c);
    else groups.set(k, [c]);
  }

  const out: Contact[] = [];

  for (const arr of groups.values()) {
    const first = arr[0];
    const seenKeys = new Set<string>();
    const refs: ContactAccountRef[] = [];
    for (const c of arr) {
      const key = c._accountKey || '';
      if (!key || seenKeys.has(key)) continue;
      seenKeys.add(key);
      refs.push(buildAccountRef(key, accountMap));
    }
    refs.sort((a, b) => a.dealer.localeCompare(b.dealer));
    out.push({
      ...first,
      _accountKey: refs[0]?.key || first._accountKey,
      _dealer: refs[0]?.dealer || first._dealer,
      _accounts: refs,
    });
  }

  for (const c of ungrouped) {
    const key = c._accountKey || '';
    const refs = key ? [buildAccountRef(key, accountMap)] : undefined;
    out.push({ ...c, _accounts: refs });
  }

  return out;
}

export default function ContactsPage() {
  const { isRollup, accountKey, accounts, scopedAccountKeys } = useAccount();

  // A group (an account with rooftops beneath it) uses the fan-out/union view,
  // restricted to itself plus its descendants; a leaf account falls through to
  // the single-account view. The unrestricted fan-out belonged to agency scope,
  // which is retired.
  if (isRollup) {
    return <AdminContactsView restrictKeys={scopedAccountKeys} />;
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
      // After dedupe, a contact may belong to multiple sub-accounts via
      // `_accounts`. Match if ANY membership intersects the filter, so
      // narrowing to one rooftop still shows cross-rooftop contacts that
      // also live there (with their full avatar stack visible for
      // context).
      result = result.filter((c) => {
        if (c._accounts && c._accounts.length > 0) {
          return c._accounts.some((a) => accountFilters.includes(a.key));
        }
        return Boolean(c._accountKey && accountFilters.includes(c._accountKey));
      });
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

function AdminContactsView({ restrictKeys }: { restrictKeys?: string[] } = {}) {
  const { accounts: accountMap } = useAccount();
  const subHref = useSubaccountHref();
  const searchParams = useSearchParams();
  const requestedAccount = searchParams.get('account') || '';

  const [contacts, setContacts] = useState<Contact[]>([]);
  // Sum of each fetched account's true server-side total (data.meta.total),
  // which can exceed the loaded rows (capped at MAX_FETCH_ALL per account).
  const [serverTotal, setServerTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);

  // When restrictKeys is provided (org roll-up mode), limit the fan-out to
  // those rooftops. `null` signature = unrestricted (admin); an empty-but-
  // present signature = org with no rooftops → show nothing. A stable string
  // signature keeps the memo from re-running when array identity changes but
  // contents don't.
  const restrictSignature = restrictKeys ? [...restrictKeys].sort().join('|') : null;
  const availableAccounts = useMemo(() => {
    const allowed =
      restrictSignature === null
        ? null
        : new Set(restrictSignature ? restrictSignature.split('|') : []);
    return Object.entries(accountMap)
      .filter(([key]) => !allowed || allowed.has(key))
      .map(([key, account]) => ({
        key,
        dealer: account.dealer || key,
        storefrontImage: account.storefrontImage,
        logos: account.logos,
        city: account.city,
        state: account.state,
      }))
      .sort((a, b) => a.dealer.localeCompare(b.dealer));
  }, [accountMap, restrictSignature]);

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

  // Guards against a slower, earlier fan-out overwriting a newer one. On first
  // paint the scope hasn't resolved yet (context defaults to admin), so an
  // unrestricted fetch across every account can be in flight when the scoped
  // one starts — and being larger, it often lands last. Without this, a group
  // account would show contacts from outside the group.
  const fetchGenerationRef = useRef(0);

  const fetchData = useCallback(async () => {
    const generation = ++fetchGenerationRef.current;
    const isStale = () => generation !== fetchGenerationRef.current;

    if (accountKeysToFetch.length === 0) {
      setContacts([]);
      setFetchError('Select at least one account to load contacts.');
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
    let totalSum = 0;
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
            total: data.meta?.total ?? (data.contacts?.length || 0),
          };
        }),
      );

      for (const result of settled) {
        if (result.status === 'rejected') {
          failures.push(result.reason instanceof Error ? result.reason.message : 'Failed to fetch contacts');
          continue;
        }

        totalSum += result.value.total;
        for (const contact of result.value.contacts) {
          nextContacts.push({
            ...contact,
            _accountKey: result.value.key,
            _dealer: result.value.dealer,
          });
        }
      }
    }
    // A newer fan-out started while this one was in flight — drop these
    // results rather than clobbering the newer (correctly-scoped) ones.
    if (isStale()) return;

    setServerTotal(totalSum);

    // Dedupe contacts that exist in multiple sub-accounts (one shopper
    // signed up at multiple rooftops). Merge their sub-account
    // membership into `_accounts` so the table renders one row with a
    // stacked avatar instead of N duplicate rows.
    setContacts(mergeContactsByIdentity(nextContacts, accountMap));
    if (failures.length === 0) {
      setFetchError(null);
    } else if (failures.length === accountKeysToFetch.length) {
      setFetchError(failures[0]);
    } else {
      setFetchError(`${failures.length} account fetches failed. Showing partial results.`);
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
                  ? 'Add a single contact to this account'
                  : 'Filter to a single account to enable'
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
        totalCount={serverTotal}
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
  // True server-side row count for the account (data.meta.total), which can
  // exceed the loaded list (capped at MAX_FETCH_ALL). Drives the "loaded /
  // total" count so the toolbar never implies the account has only 5,000.
  const [serverTotal, setServerTotal] = useState(0);
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
      setServerTotal(data.meta?.total ?? all.length);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch contacts');
      setContacts([]);
      setServerTotal(0);
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
        totalCount={serverTotal}
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
