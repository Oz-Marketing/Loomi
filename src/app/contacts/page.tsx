'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { ContactsTable } from '@/components/contacts/contacts-table';
import type { Contact, ContactAccountRef } from '@/lib/contacts/types';
import type { PagedSortKey } from '@/lib/contacts/queries';
import { ContactsToolbar, ContactsAccountFilter } from '@/components/contacts/contacts-toolbar';
import { AddContactModal } from '@/components/contacts/add-contact-modal';
import { FilterBuilder } from '@/components/contacts/filter-builder';
import { ActiveFilterBar } from '@/components/contacts/active-filter-bar';
import { useContactFilter } from '@/components/contacts/use-contact-filter';
import { useFilterableFields } from '@/hooks/use-filterable-fields';
import type { FilterDefinition } from '@/lib/smart-list-types';
import {
  UserGroupIcon,
  ArrowUpTrayIcon,
  FunnelIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';

interface SingleAccountResponse {
  contacts: Contact[];
  meta: { total: number };
}

/**
 * GET /api/contacts/paged — one deduped page across several accounts.
 * POST /api/segments/contacts returns the same shape plus the segment
 * metadata, so one type covers both the filtered and unfiltered fetch.
 */
interface PagedContactsResponse {
  contacts: (Contact & { _accountKeys?: string[] })[];
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
    pageCount?: number;
    /** Members of the filter before the text search narrowed it. */
    segmentTotal?: number;
    segment?: { id: string; name: string } | null;
    accountErrors?: Array<{ accountKey: string; error: string }>;
  };
}

/** Everything the filtered fetch returns beyond the rows themselves. */
interface FilterMeta {
  segmentTotal: number | null;
  accountErrors: Array<{ accountKey: string; error: string }>;
}

const EMPTY_FILTER_META: FilterMeta = { segmentTotal: null, accountErrors: [] };

/**
 * Request one page of contacts, filtered or not.
 *
 * The filtered call is a POST because the segment has to be RESOLVED
 * server-side first — per account, against that account's field
 * catalogue — and a filter definition does not fit in a query string.
 * Both return the same envelope so the callers below differ only in
 * which body they hand over.
 */
async function fetchContactsPage(opts: {
  accountKeys: string[];
  page: number;
  pageSize: number;
  search: string;
  sort: PagedSortKey;
  dir: 'asc' | 'desc';
  segmentId?: string | null;
  definition?: FilterDefinition | null;
  signal?: AbortSignal;
}): Promise<PagedContactsResponse> {
  const filtered = Boolean(opts.segmentId || opts.definition);

  const res = filtered
    ? await fetch('/api/segments/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: opts.signal,
        body: JSON.stringify({
          accountKeys: opts.accountKeys,
          page: opts.page,
          pageSize: opts.pageSize,
          search: opts.search,
          sort: opts.sort,
          dir: opts.dir,
          ...(opts.segmentId
            ? { segmentId: opts.segmentId }
            : { definition: opts.definition }),
        }),
      })
    : await fetch(
        `/api/contacts/paged?${new URLSearchParams({
          accountKeys: opts.accountKeys.join(','),
          page: String(opts.page),
          pageSize: String(opts.pageSize),
          sort: opts.sort,
          dir: opts.dir,
          ...(opts.search ? { search: opts.search } : {}),
        }).toString()}`,
        { signal: opts.signal },
      );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.error === 'string' ? body.error : 'Failed to fetch contacts');
  }
  return res.json();
}

// Rows per page in the group view. Matches the table's own PAGE_SIZE so the
// pager's row-range label lines up with what the server actually returned.
const CONTACTS_PAGE_SIZE = 50;

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

export default function ContactsPage() {
  const { isRollup, accountKey, accounts, scopedAccountKeys } = useAccount();

  // A group (an account with rooftops beneath it) uses the fan-out/union view,
  // restricted to itself plus its descendants; a leaf account falls through to
  // the single-account view. The unrestricted fan-out belonged to agency scope,
  // which is retired.
  if (isRollup) {
    return <AdminContactsView restrictKeys={scopedAccountKeys} groupAccountKey={accountKey} />;
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

function AdminContactsView({
  restrictKeys,
  groupAccountKey,
}: { restrictKeys?: string[]; groupAccountKey?: string | null } = {}) {
  const { accounts: accountMap } = useAccount();
  const subHref = useSubaccountHref();
  const searchParams = useSearchParams();
  const requestedAccount = searchParams.get('account') || '';

  const [contacts, setContacts] = useState<Contact[]>([]);
  // Distinct PEOPLE matching the current scope + search, across every page —
  // reported by the server, not derived from what's loaded.
  const [serverTotal, setServerTotal] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [filterMeta, setFilterMeta] = useState<FilterMeta>(EMPTY_FILTER_META);

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

  // Search + account filter now drive a SERVER query, so they live here rather
  // than in useContactFilters (which filters an in-memory array — still right
  // for the single-account view below, whose set is bounded).
  const [search, setSearch] = useState('');
  const [accountFilters, setAccountFilters] = useState<string[]>(
    presetAccountFilter ? [presetAccountFilter] : [],
  );
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<PagedSortKey>('dateAdded');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    if (!presetAccountFilter) return;
    setAccountFilters((current) => (current.length > 0 ? current : [presetAccountFilter]));
  }, [presetAccountFilter]);

  // Typing shouldn't fire a query per character.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const accountKeysToFetch = useMemo(() => {
    const selectedKeys = accountFilters.length > 0
      ? accountFilters
      : availableAccounts.map((account) => account.key);
    return [...new Set(selectedKeys)];
  }, [availableAccounts, accountFilters]);

  const scopeKey = accountKeysToFetch.join(',');

  // Segment / ad-hoc filter narrowing this list. Resolved server-side —
  // see /api/segments/contacts.
  const contactFilter = useContactFilter(
    accountKeysToFetch,
    // Owner of a segment saved from here: the one rooftop in view if the
    // list is narrowed to one, otherwise the GROUP whose roll-up this is.
    //
    // Not null. Null means org-wide — visible in every account on the
    // platform and deletable only by a developer or super admin (see the
    // scope check in POST /api/audiences). Nobody saving a filter off a
    // group's contact list is asking for that, and a privileged user
    // would have got it silently.
    accountFilters.length === 1
      ? accountFilters[0]!
      : groupAccountKey ?? null,
  );
  // Custom fields differ per rooftop, so a roll-up filter offers the
  // built-ins only — the same rule the segment builder applies.
  const { fields: filterFields } = useFilterableFields(
    accountFilters.length === 1 ? accountFilters[0] : null,
  );

  // Any change to what's being asked for resets to the first page — otherwise
  // a narrower filter can leave you stranded on page 40 of 3.
  useEffect(() => {
    setPage(0);
  }, [scopeKey, debouncedSearch, sortKey, sortDir, contactFilter.filterKey]);

  // Guards against a slower, earlier request overwriting a newer one. On first
  // paint the scope hasn't resolved yet (context defaults to admin), so an
  // unrestricted fetch across every account can be in flight when the scoped
  // one starts — and being larger, it often lands last. Without this, a group
  // account would show contacts from outside the group.
  const fetchGenerationRef = useRef(0);
  // Cancels the previous request when a newer one starts. The generation guard
  // below already stops a late response from clobbering fresher state, but the
  // request itself still ran — and in React's dev StrictMode (and on any fast
  // filter change) that doubles the query load for a result nobody reads.
  const abortRef = useRef<AbortController | null>(null);

  // Pulled out so the fetch's dependency list names one value rather
  // than the whole hook result (which is a fresh object every render).
  const activeFilter = contactFilter.filter;

  const fetchData = useCallback(async () => {
    const generation = ++fetchGenerationRef.current;
    const isStale = () => generation !== fetchGenerationRef.current;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (accountKeysToFetch.length === 0) {
      setContacts([]);
      setServerTotal(0);
      setPageCount(0);
      setFetchError('Select at least one account to load contacts.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setFetchError(null);

    // ONE request for ONE page, deduped across rooftops by the server.
    //
    // This used to fan out a `?all=true` request per account — up to 5,000
    // contacts each, 8 concurrent — merge ~200k records in the browser, and
    // then render 50 of them. It also built those payloads 8-at-a-time in a
    // server process pm2 restarts at 512MB RSS, so opening this page at group
    // scope could take the whole site down. See /api/contacts/paged.
    try {
      const data = await fetchContactsPage({
        accountKeys: accountKeysToFetch,
        page,
        pageSize: CONTACTS_PAGE_SIZE,
        search: debouncedSearch,
        sort: sortKey,
        dir: sortDir,
        segmentId: activeFilter?.segmentId ?? null,
        definition: activeFilter?.segmentId ? null : activeFilter?.definition ?? null,
        signal: controller.signal,
      });
      if (isStale()) return;

      // The server returns which accounts each person belongs to; the avatar
      // stack needs the dealer names and logos, which only the client has.
      setContacts(
        (data.contacts || []).map((c) => {
          const refs = (c._accountKeys || []).map((key) => buildAccountRef(key, accountMap));
          refs.sort((a, b) => a.dealer.localeCompare(b.dealer));
          return {
            ...c,
            _accountKey: refs[0]?.key,
            _dealer: refs[0]?.dealer,
            _accounts: refs,
          };
        }),
      );
      setServerTotal(data.meta?.total ?? 0);
      setPageCount(data.meta?.pageCount ?? 0);
      setFilterMeta({
        segmentTotal:
          typeof data.meta?.segmentTotal === 'number' ? data.meta.segmentTotal : null,
        accountErrors: data.meta?.accountErrors ?? [],
      });
      setFetchError(null);
    } catch (err) {
      // An abort is this component superseding itself, not a failure — leave
      // the existing rows and the spinner to the request that replaced us.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (isStale()) return;
      setContacts([]);
      setServerTotal(0);
      setPageCount(0);
      setFilterMeta(EMPTY_FILTER_META);
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch contacts');
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [
    accountKeysToFetch,
    accountMap,
    page,
    sortKey,
    sortDir,
    debouncedSearch,
    activeFilter,
  ]);

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
              values={accountFilters}
              onChange={setAccountFilters}
              accounts={accountOptions}
            />
            <button
              type="button"
              onClick={contactFilter.openBuilder}
              title="Build a filter across these contacts, then save it as a segment"
              className={`flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border transition-colors ${
                activeFilter
                  ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/10'
                  : 'border-[var(--border)] hover:border-[var(--primary)]/40'
              }`}
            >
              <FunnelIcon className="w-4 h-4" />
              Filter
            </button>
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
              disabled={accountFilters.length !== 1}
              title={
                accountFilters.length === 1
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

      {activeFilter && (
        <ActiveFilterBar
          filter={activeFilter}
          fields={filterFields}
          matchCount={serverTotal}
          segmentTotal={filterMeta.segmentTotal ?? undefined}
          searchActive={Boolean(debouncedSearch)}
          loading={loading || contactFilter.resolvingSegment}
          accountErrors={filterMeta.accountErrors}
          exporting={contactFilter.exporting}
          onEdit={contactFilter.openBuilder}
          onClear={contactFilter.clear}
          onExport={contactFilter.runExport}
          onSaveAsSegment={
            // A saved segment is already saved; only an ad-hoc filter
            // needs the action.
            activeFilter.segmentId ? undefined : contactFilter.openBuilder
          }
        />
      )}

      {contactFilter.builderOpen && (
        <FilterBuilder
          initialDefinition={activeFilter?.definition ?? undefined}
          fields={filterFields}
          onApply={contactFilter.applyDefinition}
          onSave={contactFilter.saveAsSegment}
          onClose={contactFilter.closeBuilder}
        />
      )}

      <ContactsToolbar
        search={search}
        onSearchChange={setSearch}
        hasAccountFilter={accountFilters.length > 1}
        totalCount={serverTotal}
        // Search and account filter are applied server-side now, so the
        // "matching" count IS the server total — there is no separate
        // client-filtered subset to report.
        filteredCount={serverTotal}
        loading={loading}
        onRefresh={() => {
          setRefreshTick((value) => value + 1);
        }}
      />

      {showAddModal && accountFilters.length === 1 && (
        <AddContactModal
          accountKey={accountFilters[0]}
          onClose={() => setShowAddModal(false)}
          onCreated={() => setRefreshTick((value) => value + 1)}
        />
      )}

      <ContactsTable
        contacts={contacts}
        loading={loading}
        error={fetchError}
        showAccountColumn
        onMutated={() => setRefreshTick((value) => value + 1)}
        emptyReason={activeFilter ? 'filtered' : 'unfiltered'}
        serverPagination={{
          page,
          pageSize: CONTACTS_PAGE_SIZE,
          pageCount,
          total: serverTotal,
          sortKey,
          sortDir,
          onPageChange: setPage,
          onSortChange: (key, dir) => {
            setSortKey(key as PagedSortKey);
            setSortDir(dir);
          },
        }}
      />
    </div>
  );
}

// ── Account View ──
//
// Two modes, deliberately.
//
// UNFILTERED it keeps its original shape: fetch the account's contacts
// once and let the table search, sort and page them in the browser. The
// set is bounded and everything stays instant.
//
// FILTERED (a segment opened from the segments page, or an ad-hoc filter
// built here) it switches to server paging, because segment membership
// is resolved in Postgres over the WHOLE roster — not over whatever
// subset the browser happens to be holding. That is the difference
// between "558 members" and "558 of the first 5,000 rows".

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
  const [refreshTick, setRefreshTick] = useState(0);

  const accountKeys = useMemo(() => (accountKey ? [accountKey] : []), [accountKey]);
  const contactFilter = useContactFilter(accountKeys, accountKey || null);
  const activeFilter = contactFilter.filter;
  const { fields: filterFields } = useFilterableFields(accountKey || null);

  // ── Filtered mode state (server paging) ───────────────────
  const [filterMeta, setFilterMeta] = useState<FilterMeta>(EMPTY_FILTER_META);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [sortKey, setSortKey] = useState<PagedSortKey>('dateAdded');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [serverSearch, setServerSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(serverSearch.trim()), 300);
    return () => clearTimeout(id);
  }, [serverSearch]);

  // Any change to what is being asked for starts again at page one.
  useEffect(() => {
    setPage(0);
  }, [contactFilter.filterKey, debouncedSearch, sortKey, sortDir]);

  // Guards a slower earlier request from overwriting a newer one, and
  // cancels the request it superseded — same reasoning as the roll-up.
  const fetchGenerationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // ONE fetcher that branches, rather than two the effect chooses
  // between: with two, the filtered fetcher's identity changed whenever
  // paging or sort state moved, and the effect re-ran the UNFILTERED
  // fetch for a value it does not use.
  const fetchData = useCallback(async () => {
    if (!accountKey) {
      setContacts([]);
      setFetchError('No account selected');
      setLoading(false);
      return;
    }

    const generation = ++fetchGenerationRef.current;
    const isStale = () => generation !== fetchGenerationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setFetchError(null);

    try {
      if (activeFilter) {
        const data = await fetchContactsPage({
          accountKeys: [accountKey],
          page,
          pageSize: CONTACTS_PAGE_SIZE,
          search: debouncedSearch,
          sort: sortKey,
          dir: sortDir,
          segmentId: activeFilter.segmentId ?? null,
          definition: activeFilter.segmentId ? null : activeFilter.definition,
          signal: controller.signal,
        });
        if (isStale()) return;

        setContacts(
          (data.contacts || []).map((c) => ({ ...c, _accountKey: accountKey })),
        );
        setFilteredTotal(data.meta?.total ?? 0);
        setPageCount(data.meta?.pageCount ?? 0);
        setFilterMeta({
          segmentTotal:
            typeof data.meta?.segmentTotal === 'number' ? data.meta.segmentTotal : null,
          accountErrors: data.meta?.accountErrors ?? [],
        });
      } else {
        const res = await fetch(
          `/api/contacts?accountKey=${encodeURIComponent(accountKey)}&all=true&includeMessaging=true`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Failed for ${accountKey}`);
        }
        const data: SingleAccountResponse = await res.json();
        if (isStale()) return;
        const all: Contact[] = (data.contacts || []).map((c) => ({
          ...c,
          _accountKey: accountKey,
        }));
        setContacts(all);
        setServerTotal(data.meta?.total ?? all.length);
        setFilterMeta(EMPTY_FILTER_META);
      }
      setFetchError(null);
    } catch (err) {
      // An abort is this component superseding itself, not a failure.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (isStale()) return;
      setContacts([]);
      setServerTotal(0);
      setFilteredTotal(0);
      setPageCount(0);
      setFilterMeta(EMPTY_FILTER_META);
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch contacts');
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [accountKey, activeFilter, page, debouncedSearch, sortKey, sortDir]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshTick]);

  const presetAccountFilter = useMemo(
    () => (requestedAccount === accountKey ? requestedAccount : ''),
    [accountKey, requestedAccount],
  );

  const filters = useContactFilters(contacts, presetAccountFilter);

  // The search box drives client-side filtering when unfiltered and a
  // server query when filtered — one input, so the two never disagree
  // about what is being searched.
  const search = activeFilter ? serverSearch : filters.search;
  const onSearchChange = activeFilter ? setServerSearch : filters.setSearch;
  const rows = activeFilter ? contacts : filters.filtered;
  const refresh = () => setRefreshTick((value) => value + 1);

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
            <button
              type="button"
              onClick={contactFilter.openBuilder}
              title="Build a filter across these contacts, then save it as a segment"
              className={`flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border transition-colors ${
                activeFilter
                  ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/10'
                  : 'border-[var(--border)] hover:border-[var(--primary)]/40'
              }`}
            >
              <FunnelIcon className="w-4 h-4" />
              Filter
            </button>
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

      {activeFilter && (
        <ActiveFilterBar
          filter={activeFilter}
          fields={filterFields}
          matchCount={filteredTotal}
          segmentTotal={filterMeta.segmentTotal ?? undefined}
          searchActive={Boolean(debouncedSearch)}
          loading={loading || contactFilter.resolvingSegment}
          accountErrors={filterMeta.accountErrors}
          exporting={contactFilter.exporting}
          onEdit={contactFilter.openBuilder}
          onClear={contactFilter.clear}
          onExport={contactFilter.runExport}
          onSaveAsSegment={
            activeFilter.segmentId ? undefined : contactFilter.openBuilder
          }
        />
      )}

      {contactFilter.builderOpen && (
        <FilterBuilder
          initialDefinition={activeFilter?.definition ?? undefined}
          fields={filterFields}
          onApply={contactFilter.applyDefinition}
          onSave={contactFilter.saveAsSegment}
          onClose={contactFilter.closeBuilder}
        />
      )}

      <ContactsToolbar
        search={search}
        onSearchChange={onSearchChange}
        hasAccountFilter={false}
        totalCount={activeFilter ? filterMeta.segmentTotal ?? filteredTotal : serverTotal}
        filteredCount={activeFilter ? filteredTotal : filters.filtered.length}
        loading={loading}
        onRefresh={refresh}
      />

      {showAddModal && accountKey && (
        <AddContactModal
          accountKey={accountKey}
          onClose={() => setShowAddModal(false)}
          onCreated={refresh}
        />
      )}

      <ContactsTable
        contacts={rows}
        loading={loading}
        error={fetchError}
        showAccountColumn={false}
        accountKey={accountKey}
        onMutated={refresh}
        emptyReason={activeFilter ? 'filtered' : 'unfiltered'}
        // Only in filtered mode: `contacts` is then one server page, not
        // the whole set, so the table must not slice it again.
        serverPagination={
          activeFilter
            ? {
                page,
                pageSize: CONTACTS_PAGE_SIZE,
                pageCount,
                total: filteredTotal,
                sortKey,
                sortDir,
                onPageChange: setPage,
                onSortChange: (key, dir) => {
                  setSortKey(key as PagedSortKey);
                  setSortDir(dir);
                },
              }
            : undefined
        }
      />
    </div>
  );
}
