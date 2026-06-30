'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckIcon,
  ChevronUpDownIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  ListBulletIcon,
  NoSymbolIcon,
  TagIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { Contact, ContactAccountRef } from '@/lib/contacts/types';
import { AccountAvatar } from '@/components/account-avatar';
import BulkActionDock, { type BulkActionDockItem } from '@/components/bulk-action-dock';
import { AddToListModal, DndModal, TagsModal } from '@/components/contacts/bulk-action-modals';
import { toast } from '@/lib/toast';

type SortKey = 'fullName' | 'email' | 'dateAdded' | '_dealer' | 'vehicleMake' | 'source';
type SortDir = 'asc' | 'desc';

interface ContactsTableProps {
  contacts: Contact[];
  loading: boolean;
  error: string | null;
  showAccountColumn?: boolean;
  /** For account-scoped views, pass the accountKey for detail navigation. */
  accountKey?: string;
  /**
   * Optional extras tacked onto the bulk-action dock alongside the
   * built-in actions. Use this for surface-specific actions like
   * "Remove from list" on the list detail page. They render between
   * Export and Delete in the dock.
   */
  extraBulkActions?: (ctx: BulkActionContext) => BulkActionDockItem[];
  /**
   * Called after any successful bulk mutation (or after extra-action
   * mutations the host triggered itself) so the parent can refetch.
   */
  onMutated?: () => void;
}

export interface BulkActionContext {
  /**
   * Selected contact IDs grouped by their accountKey. Multi-account
   * selections fan out to one API call per account on the client.
   */
  selectionByAccount: Record<string, string[]>;
  totalSelected: number;
  /** True when the selection spans exactly one account. */
  singleAccountKey: string | null;
  /** Clears the selection state on the table — call after a successful action. */
  clearSelection: () => void;
}

// ── Helpers ──

function daysUntil(dateStr: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatRelativeDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 0) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const PAGE_SIZE = 50;

// ── CSV export helpers ──

const CSV_EXPORT_COLUMNS: { key: keyof Contact | 'tags'; label: string }[] = [
  { key: 'fullName', label: 'Full Name' },
  { key: 'firstName', label: 'First Name' },
  { key: 'lastName', label: 'Last Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'address1', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'postalCode', label: 'Postal Code' },
  { key: 'country', label: 'Country' },
  { key: 'source', label: 'Source' },
  { key: 'tags', label: 'Tags' },
  { key: 'dateAdded', label: 'Date Added' },
  { key: 'vehicleYear', label: 'Vehicle Year' },
  { key: 'vehicleMake', label: 'Vehicle Make' },
  { key: 'vehicleModel', label: 'Vehicle Model' },
];

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsv(contacts: Contact[]): string {
  const headerLine = CSV_EXPORT_COLUMNS.map((c) => csvEscape(c.label)).join(',');
  const lines = contacts.map((c) =>
    CSV_EXPORT_COLUMNS.map((col) => {
      if (col.key === 'tags') return csvEscape((c.tags ?? []).join('; '));
      const raw = (c as unknown as Record<string, unknown>)[col.key];
      return csvEscape(raw == null ? '' : String(raw));
    }).join(','),
  );
  return [headerLine, ...lines].join('\n');
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Main Component ──

export function ContactsTable({
  contacts,
  loading,
  error,
  showAccountColumn,
  accountKey,
  extraBulkActions,
  onMutated,
}: ContactsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('fullName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(0);

  // Sort
  const sorted = [...contacts].sort((a, b) => {
    // Date-added sorts chronologically; missing/invalid dates always sort
    // last regardless of direction so blanks don't bubble to the top.
    if (sortKey === 'dateAdded') {
      const aTime = a.dateAdded ? new Date(a.dateAdded).getTime() : NaN;
      const bTime = b.dateAdded ? new Date(b.dateAdded).getTime() : NaN;
      const aMissing = Number.isNaN(aTime);
      const bMissing = Number.isNaN(bTime);
      if (aMissing || bMissing) {
        if (aMissing && bMissing) return 0;
        return aMissing ? 1 : -1;
      }
      const cmp = aTime - bTime;
      return sortDir === 'asc' ? cmp : -cmp;
    }

    let aVal = '';
    let bVal = '';
    switch (sortKey) {
      case 'fullName':
        aVal = (a.fullName || `${a.firstName} ${a.lastName}`).toLowerCase();
        bVal = (b.fullName || `${b.firstName} ${b.lastName}`).toLowerCase();
        break;
      case 'email':
        aVal = (a.email || '').toLowerCase();
        bVal = (b.email || '').toLowerCase();
        break;
      case '_dealer':
        aVal = (a._dealer || '').toLowerCase();
        bVal = (b._dealer || '').toLowerCase();
        break;
      case 'vehicleMake':
        aVal = `${a.vehicleYear} ${a.vehicleMake} ${a.vehicleModel}`.toLowerCase();
        bVal = `${b.vehicleYear} ${b.vehicleMake} ${b.vehicleModel}`.toLowerCase();
        break;
      case 'source':
        aVal = (a.source || '').toLowerCase();
        bVal = (b.source || '').toLowerCase();
        break;
    }
    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // Paginate
  const totalContacts = sorted.length;
  const totalPages = Math.ceil(totalContacts / PAGE_SIZE);
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(0);
  }

  // ── Selection ──

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Prune selections that no longer exist in the contacts feed (e.g.
  // after a filter narrows the list, or after a bulk delete refetch).
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const visibleIds = new Set(contacts.map((c) => c.id));
    let mutated = false;
    const next = new Set<string>();
    for (const id of selectedIds) {
      if (visibleIds.has(id)) next.add(id);
      else mutated = true;
    }
    if (mutated) setSelectedIds(next);
  }, [contacts, selectedIds]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const pageIds = paged.map((c) => c.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected = pageIds.some((id) => selectedIds.has(id));

  // Cross-page selection: when the user selects the page checkbox, surface
  // a "Select all N contacts" affordance so they can grab every contact in
  // the current filtered set, not just the visible page.
  const allFilteredIds = sorted.map((c) => c.id);
  const allFilteredSelected =
    allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.has(id));
  const hasMultiplePages = totalPages > 1;

  function togglePageSelection() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedIds(new Set(allFilteredIds));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // Bucketed selection — bulk API operates one account at a time.
  const selectionByAccount = useMemo(() => {
    const map: Record<string, string[]> = {};
    const byId = new Map(contacts.map((c) => [c.id, c]));
    for (const id of selectedIds) {
      const contact = byId.get(id);
      if (!contact) continue;
      const key = contact._accountKey || accountKey || '';
      if (!key) continue;
      (map[key] = map[key] || []).push(id);
    }
    return map;
  }, [selectedIds, contacts, accountKey]);

  const selectionAccountKeys = Object.keys(selectionByAccount);
  const singleAccountKey = selectionAccountKeys.length === 1 ? selectionAccountKeys[0] : null;
  const totalSelected = selectedIds.size;

  // ── Bulk action handlers ──

  const [activeModal, setActiveModal] = useState<null | 'list' | 'addTags' | 'removeTags' | 'dnd'>(null);
  const [busy, setBusy] = useState(false);

  async function runBulk(
    action: 'addToList' | 'addTags' | 'removeTags' | 'setDnd' | 'delete',
    buildPayload: (accountKey: string, ids: string[]) => Record<string, unknown> | undefined,
    successLabel: (totalAffected: number) => string,
  ) {
    if (selectionAccountKeys.length === 0) return;
    setBusy(true);
    try {
      const results = await Promise.allSettled(
        selectionAccountKeys.map(async (key) => {
          const ids = selectionByAccount[key];
          const payload = buildPayload(key, ids);
          const res = await fetch('/api/contacts/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountKey: key, ids, action, payload }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(typeof data.error === 'string' ? data.error : 'Bulk action failed');
          }
          return typeof data.affected === 'number' ? data.affected : 0;
        }),
      );

      const failures = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      const successes = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<number>[];
      const totalAffected = successes.reduce((acc, r) => acc + r.value, 0);

      if (totalAffected > 0) toast.success(successLabel(totalAffected));
      if (failures.length > 0) {
        const first = failures[0].reason instanceof Error ? failures[0].reason.message : 'Bulk action failed';
        toast.error(
          failures.length === results.length
            ? first
            : `${failures.length} of ${results.length} account batches failed: ${first}`,
        );
      }
      clearSelection();
      setActiveModal(null);
      onMutated?.();
    } finally {
      setBusy(false);
    }
  }

  function handleExportCsv() {
    if (selectedIds.size === 0) return;
    const selected = contacts.filter((c) => selectedIds.has(c.id));
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`contacts-${stamp}.csv`, buildCsv(selected));
    toast.success(`Exported ${selected.length.toLocaleString()} contacts.`);
  }

  async function handleDelete() {
    if (selectedIds.size === 0) return;
    const n = selectedIds.size;
    if (
      !confirm(
        `Permanently delete ${n.toLocaleString()} ${n === 1 ? 'contact' : 'contacts'}? This can't be undone.`,
      )
    ) {
      return;
    }
    await runBulk('delete', () => undefined, (count) => `Deleted ${count.toLocaleString()} contacts.`);
  }

  // Tag actions need to know the modal's input tags. We capture them
  // via the modal's onApply callback, which calls runBulk with the
  // chosen tags as the payload.
  async function applyAddTags(tags: string[]) {
    await runBulk(
      'addTags',
      () => ({ tags }),
      (count) => `Tagged ${count.toLocaleString()} contacts.`,
    );
  }
  async function applyRemoveTags(tags: string[]) {
    await runBulk(
      'removeTags',
      () => ({ tags }),
      (count) => `Untagged ${count.toLocaleString()} contacts.`,
    );
  }
  async function applyDnd(patch: { email?: boolean; sms?: boolean }) {
    await runBulk(
      'setDnd',
      () => ({ dnd: patch }),
      (count) => `Updated DND for ${count.toLocaleString()} contacts.`,
    );
  }
  async function applyAddToList(listId: string) {
    await runBulk(
      'addToList',
      () => ({ listId }),
      (count) => `Added ${count.toLocaleString()} contacts to the list.`,
    );
  }

  // ── Bulk action dock items ──

  // The first dock action is context-aware:
  //   • Default → "Select page" (selects every visible row)
  //   • Page already selected & more pages exist → "Select all N" (extends to the
  //     whole filtered set across pages)
  //   • Everything selected → "Deselect all" (clears selection entirely)
  //   • Page selected on a single-page list → "Deselect page"
  const selectAllAction = allFilteredSelected
    ? {
        label: 'Deselect all',
        onClick: clearSelection,
      }
    : allPageSelected && hasMultiplePages
      ? {
          label: `Select all ${totalContacts.toLocaleString()}`,
          onClick: selectAllFiltered,
        }
      : allPageSelected
        ? {
            label: 'Deselect page',
            onClick: togglePageSelection,
          }
        : {
            label: 'Select page',
            onClick: togglePageSelection,
          };

  const builtInActions: BulkActionDockItem[] = [
    {
      id: 'select-all',
      label: selectAllAction.label,
      icon: <CheckIcon className="w-4 h-4" />,
      onClick: selectAllAction.onClick,
    },
    {
      id: 'add-to-list',
      label: 'Add to list',
      icon: <ListBulletIcon className="w-4 h-4" />,
      onClick: () => setActiveModal('list'),
      disabled: busy || singleAccountKey === null,
    },
    {
      id: 'add-tags',
      label: 'Add tags',
      icon: <TagIcon className="w-4 h-4" />,
      onClick: () => setActiveModal('addTags'),
      disabled: busy,
    },
    {
      id: 'remove-tags',
      label: 'Remove tags',
      icon: <TagIcon className="w-4 h-4 rotate-90" />,
      onClick: () => setActiveModal('removeTags'),
      disabled: busy,
    },
    {
      id: 'dnd',
      label: 'Set DND',
      icon: <NoSymbolIcon className="w-4 h-4" />,
      onClick: () => setActiveModal('dnd'),
      disabled: busy,
    },
    {
      id: 'export',
      label: 'Export CSV',
      icon: <ArrowDownTrayIcon className="w-4 h-4" />,
      onClick: handleExportCsv,
    },
  ];

  const extras = extraBulkActions
    ? extraBulkActions({
        selectionByAccount,
        totalSelected,
        singleAccountKey,
        clearSelection,
      })
    : [];

  const dockActions: BulkActionDockItem[] = [
    ...builtInActions,
    ...extras,
    {
      id: 'delete',
      label: 'Delete',
      icon: <TrashIcon className="w-4 h-4" />,
      onClick: handleDelete,
      disabled: busy,
      danger: true,
    },
  ];

  return (
    <div>
      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && contacts.length === 0 && (
        <div className="text-center py-16 text-[var(--muted-foreground)]">
          <ArrowPathIcon className="w-5 h-5 animate-spin mx-auto mb-2" />
          <p className="text-sm">Loading contacts...</p>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && contacts.length === 0 && (
        <div className="text-center py-16 border border-dashed border-[var(--border)] rounded-xl">
          <p className="text-[var(--muted-foreground)] text-sm font-medium">No contacts yet</p>
          <p className="text-[var(--muted-foreground)] text-xs mt-1">
            Import a CSV from the toolbar to get started.
          </p>
        </div>
      )}

      {/* Table */}
      {paged.length > 0 && (
        <div className="overflow-x-auto glass-table rounded-xl">
          <table className="w-full min-w-[940px]">
            <thead>
              <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    aria-label={allPageSelected ? 'Deselect page' : 'Select page'}
                    checked={allPageSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = somePageSelected && !allPageSelected;
                    }}
                    onChange={togglePageSelection}
                    className="h-4 w-4 rounded border-[var(--border)] cursor-pointer accent-[var(--primary)]"
                  />
                </th>
                <SortHeader label="Name" sortKey="fullName" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Email" sortKey="email" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                <th className="text-left px-4 py-3 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">Phone</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">Address</th>
                <SortHeader label="Vehicle" sortKey="vehicleMake" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                <th className="text-left px-4 py-3 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">Tags</th>
                <SortHeader label="Source" sortKey="source" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Added" sortKey="dateAdded" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                {showAccountColumn && (
                  <SortHeader label="Sub-Account" sortKey="_dealer" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                )}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {/* Cross-page selection banner — appears when the page checkbox is
                  ticked and the filtered set spans multiple pages. */}
              {hasMultiplePages && allPageSelected && (
                <tr className="bg-[var(--primary)]/5 border-b border-[var(--border)]">
                  <td
                    colSpan={showAccountColumn ? 10 : 9}
                    className="px-4 py-2.5 text-center text-xs text-[var(--muted-foreground)]"
                  >
                    {allFilteredSelected ? (
                      <>
                        All{' '}
                        <span className="font-semibold text-[var(--foreground)]">
                          {totalContacts.toLocaleString()}
                        </span>{' '}
                        contacts are selected.{' '}
                        <button
                          type="button"
                          onClick={clearSelection}
                          className="text-[var(--primary)] hover:underline font-medium"
                        >
                          Clear selection
                        </button>
                      </>
                    ) : (
                      <>
                        All{' '}
                        <span className="font-semibold text-[var(--foreground)]">
                          {pageIds.length}
                        </span>{' '}
                        contacts on this page are selected.{' '}
                        <button
                          type="button"
                          onClick={selectAllFiltered}
                          className="text-[var(--primary)] hover:underline font-medium"
                        >
                          Select all {totalContacts.toLocaleString()} contacts
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )}
              {paged.map((contact) => (
                <ContactRow
                  key={`${contact._accountKey || 'account'}:${contact.id}`}
                  contact={contact}
                  showAccountColumn={showAccountColumn}
                  accountKey={accountKey || contact._accountKey || ''}
                  isSelected={selectedIds.has(contact.id)}
                  onToggleSelect={() => toggleSelect(contact.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pr-24 text-xs text-[var(--muted-foreground)]">
          <span>
            {page * PAGE_SIZE + 1}&ndash;{Math.min((page + 1) * PAGE_SIZE, totalContacts)} of {totalContacts.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1.5 rounded hover:bg-[var(--muted)] disabled:opacity-30 transition-colors"
            >
              <ChevronLeftIcon className="w-4 h-4" />
            </button>
            <span className="px-2">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="p-1.5 rounded hover:bg-[var(--muted)] disabled:opacity-30 transition-colors"
            >
              <ChevronRightIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Bulk action dock */}
      {totalSelected > 0 && (
        <BulkActionDock
          count={totalSelected}
          itemLabel={totalSelected === 1 ? 'contact' : 'contacts'}
          actions={dockActions}
          onClose={clearSelection}
        />
      )}

      {/* Modals */}
      {activeModal === 'list' && singleAccountKey && (
        <AddToListModal
          accountKey={singleAccountKey}
          selectedCount={totalSelected}
          onApply={applyAddToList}
          onClose={() => setActiveModal(null)}
        />
      )}
      {activeModal === 'addTags' && (
        <TagsModal
          mode="add"
          selectedCount={totalSelected}
          onApply={applyAddTags}
          onClose={() => setActiveModal(null)}
        />
      )}
      {activeModal === 'removeTags' && (
        <TagsModal
          mode="remove"
          selectedCount={totalSelected}
          onApply={applyRemoveTags}
          onClose={() => setActiveModal(null)}
        />
      )}
      {activeModal === 'dnd' && (
        <DndModal
          selectedCount={totalSelected}
          onApply={applyDnd}
          onClose={() => setActiveModal(null)}
        />
      )}
    </div>
  );
}

// ── Sort Header ──

function SortHeader({
  label,
  sortKey,
  currentKey,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = currentKey === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      className="text-left px-4 py-3 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider cursor-pointer hover:text-[var(--foreground)] transition-colors select-none"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          dir === 'asc' ? (
            <ChevronUpIcon className="w-3 h-3" />
          ) : (
            <ChevronDownIcon className="w-3 h-3" />
          )
        ) : (
          <ChevronUpDownIcon className="w-3 h-3 opacity-40" />
        )}
      </span>
    </th>
  );
}

// ── Contact Row ──

function ContactRow({
  contact,
  showAccountColumn,
  accountKey,
  isSelected,
  onToggleSelect,
}: {
  contact: Contact;
  showAccountColumn?: boolean;
  accountKey: string;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  const router = useRouter();
  const vehicleStr = [contact.vehicleYear, contact.vehicleMake, contact.vehicleModel]
    .filter(Boolean)
    .join(' ');
  const detailAccountKey = contact._accountKey || accountKey;
  const canOpenDetail = Boolean(detailAccountKey);

  // Alert badges
  const alerts: { label: string; color: string }[] = [];
  if (contact.nextServiceDate) {
    const d = daysUntil(contact.nextServiceDate);
    if (d !== null && d < 0) {
      alerts.push({ label: 'Service overdue', color: 'bg-red-500/15 text-red-400' });
    }
  }
  if (contact.leaseEndDate) {
    const d = daysUntil(contact.leaseEndDate);
    if (d !== null && d >= 0 && d <= 90) {
      alerts.push({ label: `Lease: ${d}d`, color: 'bg-amber-500/15 text-amber-400' });
    }
  }
  if (contact.warrantyEndDate) {
    const d = daysUntil(contact.warrantyEndDate);
    if (d !== null && d >= 0 && d <= 90) {
      alerts.push({ label: `Warranty: ${d}d`, color: 'bg-amber-500/15 text-amber-400' });
    }
  }

  return (
    <tr
      onClick={() => {
        if (!detailAccountKey) return;
        router.push(`/contacts/${encodeURIComponent(contact.id)}?accountKey=${encodeURIComponent(detailAccountKey)}`);
      }}
      className={`border-b border-[var(--border)] transition-colors ${
        isSelected ? 'bg-[var(--primary)]/8' : ''
      } ${canOpenDetail ? 'hover:bg-[var(--muted)]/50 cursor-pointer' : 'cursor-default'}`}
    >
      {/* Checkbox */}
      <td className="px-3 py-3">
        <input
          type="checkbox"
          aria-label={`Select ${contact.fullName || contact.firstName || contact.email || 'contact'}`}
          checked={isSelected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded border-[var(--border)] cursor-pointer accent-[var(--primary)]"
        />
      </td>
      {/* Name */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold bg-[var(--primary)]/10 text-[var(--primary)] flex-shrink-0">
            {(contact.firstName || contact.fullName || contact.email || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {contact.firstName || contact.fullName?.split(' ')[0] || 'Unknown'}
            </p>
            {(contact.lastName || (contact.fullName && contact.fullName.includes(' '))) && (
              <p className="text-xs text-[var(--muted-foreground)] truncate">
                {contact.lastName || contact.fullName?.split(' ').slice(1).join(' ')}
              </p>
            )}
            {alerts.length > 0 && (
              <div className="flex gap-1 mt-0.5">
                {alerts.map((a, i) => (
                  <span key={i} className={`text-[8px] px-1.5 py-0.5 rounded-full font-medium ${a.color}`}>
                    {a.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </td>
      {/* Email */}
      <td className="px-4 py-3 text-sm text-[var(--muted-foreground)] truncate max-w-[200px]">
        {contact.email || '—'}
      </td>
      {/* Phone */}
      <td className="px-4 py-3 text-sm text-[var(--muted-foreground)] whitespace-nowrap">
        {contact.phone || '—'}
      </td>
      {/* Address */}
      <td className="px-4 py-3 text-sm text-[var(--muted-foreground)] truncate max-w-[180px]">
        {[contact.address1, contact.city, contact.state].filter(Boolean).join(', ') || '—'}
      </td>
      {/* Vehicle */}
      <td className="px-4 py-3 text-sm text-[var(--muted-foreground)] truncate max-w-[180px]">
        {vehicleStr || '—'}
      </td>
      {/* Tags */}
      <td className="px-4 py-3">
        {contact.tags && contact.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1 max-w-[160px]">
            {contact.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] truncate max-w-[100px]">
                {tag}
              </span>
            ))}
            {contact.tags.length > 3 && (
              <span className="text-[9px] text-[var(--muted-foreground)]">+{contact.tags.length - 3}</span>
            )}
          </div>
        ) : (
          <span className="text-sm text-[var(--muted-foreground)]">—</span>
        )}
      </td>
      {/* Source */}
      <td className="px-4 py-3 text-sm text-[var(--muted-foreground)] truncate max-w-[120px]">
        {contact.source || '—'}
      </td>
      {/* Date Added */}
      <td className="px-4 py-3 text-sm text-[var(--muted-foreground)] whitespace-nowrap">
        {contact.dateAdded ? formatRelativeDate(contact.dateAdded) : '—'}
      </td>
      {/* Account — avatar+name for single membership, stacked avatars
          with hover tooltips for 2+. Mirrors the pattern in
          components/settings/users-tab.tsx so the two admin tables
          share visual language. */}
      {showAccountColumn && (
        <td className="px-4 py-3 max-w-[180px]">
          <SubAccountCell accounts={contact._accounts} fallbackDealer={contact._dealer} />
        </td>
      )}
      {/* Expand indicator */}
      <td className="px-3 py-3">
        <ChevronRightIcon className={`w-4 h-4 ${canOpenDetail ? 'text-[var(--muted-foreground)]' : 'text-[var(--muted)]'}`} />
      </td>
    </tr>
  );
}

// ── Sub-Account Cell ──
//
// Renders the Sub-Account column for the admin view. One sub-account →
// small avatar + dealer name. Multiple sub-accounts (same contact lives
// in multiple rooftops, dedupe-merged upstream) → stacked avatars with
// per-avatar hover tooltips for dealer name + city/state + key. Mirrors
// the agency-style stack used by components/settings/users-tab.tsx so
// the two admin tables share visual language.
//
// Click handling: the parent <tr> still routes to the primary sub-
// account's contact detail page. Avatars themselves are non-navigable
// in this v1 to keep the row's single click target predictable.

const MAX_AVATARS_VISIBLE = 4;

function SubAccountCell({
  accounts,
  fallbackDealer,
}: {
  accounts: ContactAccountRef[] | undefined;
  fallbackDealer: string | undefined;
}) {
  // No dedup ran (pre-merge data, or single-account views that don't
  // populate _accounts). Fall back to plain dealer text so we don't
  // break per-account views.
  if (!accounts || accounts.length === 0) {
    return <span className="text-sm font-medium truncate block">{fallbackDealer || '—'}</span>;
  }

  // Single sub-account — show avatar + name inline. Most readable form
  // for the common case where dedup didn't merge anything.
  if (accounts.length === 1) {
    const acc = accounts[0];
    return (
      <div className="flex items-center gap-2 min-w-0">
        <span className="inline-flex rounded-full bg-[var(--background)] p-[1px] shadow-sm flex-shrink-0">
          <AccountAvatar
            name={acc.dealer}
            accountKey={acc.key}
            storefrontImage={acc.storefrontImage || null}
            logos={acc.logos || undefined}
            size={28}
            className="rounded-full"
            alt={`${acc.dealer} (${acc.key})`}
          />
        </span>
        <span className="text-sm font-medium truncate">{acc.dealer}</span>
      </div>
    );
  }

  // 2+ sub-accounts — stacked avatars with hover tooltips.
  const visible = accounts.slice(0, MAX_AVATARS_VISIBLE);
  const extra = accounts.length - visible.length;

  return (
    <div className="account-avatar-stack flex items-center pl-2">
      {visible.map((acc) => {
        const cityState = [acc.city, acc.state].filter(Boolean).join(', ') || 'Location unavailable';
        const industry = acc.category || 'Unknown industry';
        return (
          <span
            key={acc.key}
            aria-label={`${acc.dealer} • ${cityState} • ${industry} • Key: ${acc.key}`}
            className="relative inline-flex items-center group account-avatar-stack-item"
          >
            <span className="pointer-events-none absolute bottom-full left-1/2 z-[90] mb-2 hidden -translate-x-1/2 group-hover:block">
              <span className="relative block account-tooltip-popover rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 shadow-xl whitespace-nowrap">
                <span className="block text-[11px] font-medium leading-4 text-[var(--foreground)]">
                  {acc.dealer}
                </span>
                <span className="block text-[10px] leading-4 text-[var(--muted-foreground)]">
                  {cityState}
                </span>
                <span className="block text-[10px] leading-4 text-[var(--muted-foreground)]">
                  {industry}
                </span>
                <span className="mt-1 block text-[10px] font-mono leading-4 text-[var(--muted-foreground)]">
                  Key: {acc.key}
                </span>
                <span className="absolute left-1/2 top-full -translate-x-1/2 w-0 h-0 border-x-[6px] border-x-transparent border-t-[7px] border-t-[var(--background)]" />
              </span>
            </span>

            <span className="inline-flex rounded-full bg-[var(--background)] p-[1px] shadow-sm">
              <AccountAvatar
                name={acc.dealer}
                accountKey={acc.key}
                storefrontImage={acc.storefrontImage || null}
                logos={acc.logos || undefined}
                size={28}
                className="rounded-full"
                alt={`${acc.dealer} (${acc.key})`}
              />
            </span>
          </span>
        );
      })}

      {extra > 0 && (
        <span
          title={`${extra} more sub-account${extra === 1 ? '' : 's'}: ${accounts.slice(MAX_AVATARS_VISIBLE).map((a) => a.dealer).join(', ')}`}
          className="account-avatar-stack-item inline-flex items-center justify-center w-[30px] h-[30px] rounded-full border border-[var(--background)] bg-[var(--background)] text-[10px] font-medium text-[var(--muted-foreground)] shadow-sm"
        >
          +{extra}
        </span>
      )}
    </div>
  );
}
