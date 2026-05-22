'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronUpDownIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  CloudArrowUpIcon,
  ListBulletIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { useAccount } from '@/contexts/account-context';
import { stashPendingImportFile } from '@/lib/contacts/pending-import';
import { toast } from '@/lib/toast';
import BulkActionDock, { type BulkActionDockItem } from '@/components/bulk-action-dock';

// Lists are static, manually-curated contact rosters. The table shows
// every list visible to the current user (account-scoped on the server
// + client-side narrowing when inside a single subaccount). The
// New List modal seeds via CSV; rename is in-place via a small modal
// triggered by the pencil icon on the row.

interface ListSummary {
  id: string;
  name: string;
  description: string | null;
  accountKey: string;
  createdByUserId: string | null;
  createdByUserName: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
}

interface ListsResponse {
  lists: ListSummary[];
}

type SortKey = 'name' | 'memberCount' | 'createdAt';
type SortDir = 'asc' | 'desc';

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ListsPage() {
  const router = useRouter();
  const subHref = useSubaccountHref();
  const { isAccount, accountKey, accounts, userRole } = useAccount();

  const [lists, setLists] = useState<ListSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ListSummary | null>(null);

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  async function fetchLists() {
    setLoading(true);
    try {
      const res = await fetch('/api/contacts/lists');
      const data = (res.ok ? await res.json() : { lists: [] }) as ListsResponse;
      setLists(Array.isArray(data.lists) ? data.lists : []);
    } catch {
      setLists([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLists();
  }, []);

  const accountOptions = useMemo(() => {
    const entries = Object.entries(accounts).map(([key, account]) => ({
      key,
      dealer: account.dealer || key,
    }));
    return entries.sort((a, b) => a.dealer.localeCompare(b.dealer));
  }, [accounts]);

  const canPickAccount = !isAccount && (userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin');
  const dealerForKey = (key: string) => accounts[key]?.dealer || key;

  // Narrow to the active subaccount when inside a subaccount route.
  // Admin all-accounts view sees every list with the dealer name.
  const accountFiltered = useMemo(() => {
    if (isAccount && accountKey) return lists.filter((l) => l.accountKey === accountKey);
    return lists;
  }, [lists, isAccount, accountKey]);

  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = q
      ? accountFiltered.filter((l) =>
          l.name.toLowerCase().includes(q) ||
          (l.description ?? '').toLowerCase().includes(q) ||
          (l.createdByUserName ?? '').toLowerCase().includes(q),
        )
      : accountFiltered;
    return [...matched].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'memberCount':
          cmp = a.memberCount - b.memberCount;
          break;
        case 'createdAt':
          cmp = (a.createdAt || '').localeCompare(b.createdAt || '');
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [accountFiltered, search, sortKey, sortDir]);

  // Drop selections that fall out of the current view (filter/search/account switch).
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const visible = new Set(filteredAndSorted.map((l) => l.id));
    let mutated = false;
    const next = new Set<string>();
    for (const id of selectedIds) {
      if (visible.has(id)) next.add(id);
      else mutated = true;
    }
    if (mutated) setSelectedIds(next);
  }, [filteredAndSorted, selectedIds]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'createdAt' ? 'desc' : 'asc');
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visibleIds = filteredAndSorted.map((l) => l.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));

  function toggleAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function handleCreate(
    name: string,
    targetAccountKey: string,
    description: string,
    file: File,
  ) {
    try {
      const res = await fetch('/api/contacts/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, accountKey: targetAccountKey, description }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to create list');
      }
      const created: ListSummary = {
        ...data.list,
        memberCount: 0,
        createdByUserName: data.list.createdByUserName ?? null,
      };
      setLists((prev) => [created, ...prev]);
      setShowCreate(false);
      stashPendingImportFile(file);
      router.push(subHref(`/contacts/import?listId=${encodeURIComponent(created.id)}`));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create list');
    }
  }

  async function handleRename(list: ListSummary, newName: string, newDescription: string) {
    try {
      const res = await fetch(`/api/contacts/lists/${encodeURIComponent(list.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, description: newDescription }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to update list');
      }
      setLists((prev) =>
        prev.map((l) => (l.id === list.id ? { ...l, ...data.list } : l)),
      );
      setRenameTarget(null);
      toast.success(`List updated.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update list');
    }
  }

  async function handleDeleteOne(list: ListSummary) {
    if (!confirm(`Delete list "${list.name}"? Contacts will remain — only the list itself is removed.`)) return;
    try {
      const res = await fetch(`/api/contacts/lists/${encodeURIComponent(list.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to delete list');
      }
      setLists((prev) => prev.filter((l) => l.id !== list.id));
      toast.success(`List "${list.name}" deleted.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete list');
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length.toLocaleString()} ${ids.length === 1 ? 'list' : 'lists'}? Contacts will remain.`)) {
      return;
    }
    // Fire deletes in parallel; surface aggregate result. We don't have a
    // bulk DELETE endpoint and the lists collection is small, so N parallel
    // requests is fine for the expected scale.
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/contacts/lists/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(
          async (res) => {
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              throw new Error(typeof data.error === 'string' ? data.error : 'Failed');
            }
          },
        ),
      ),
    );
    const succeededIds = ids.filter((_, i) => results[i].status === 'fulfilled');
    const failedCount = results.length - succeededIds.length;
    if (succeededIds.length > 0) {
      setLists((prev) => prev.filter((l) => !succeededIds.includes(l.id)));
      toast.success(`Deleted ${succeededIds.length.toLocaleString()} ${succeededIds.length === 1 ? 'list' : 'lists'}.`);
    }
    if (failedCount > 0) toast.error(`${failedCount} delete${failedCount === 1 ? '' : 's'} failed.`);
    clearSelection();
  }

  const dockActions: BulkActionDockItem[] = [
    {
      id: 'delete',
      label: 'Delete',
      icon: <TrashIcon className="w-4 h-4" />,
      onClick: handleBulkDelete,
      danger: true,
    },
  ];

  return (
    <div>
      <div className="page-sticky-header mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <ListBulletIcon className="w-7 h-7 text-[var(--primary)]" />
            <div>
              <h2 className="text-2xl font-bold">Lists</h2>
              <p className="text-[var(--muted-foreground)] mt-1">
                Static, manually-curated contact rosters.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90"
            >
              <PlusIcon className="w-4 h-4" />
              New List
            </button>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-md">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)]" />
          <input
            type="text"
            placeholder="Search lists by name, description, or creator…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>

      {loading && (
        <div className="text-center py-12 text-[var(--muted-foreground)] text-sm">
          Loading lists…
        </div>
      )}

      {!loading && filteredAndSorted.length === 0 && (
        <div className="text-center py-20 border border-dashed border-[var(--border)] rounded-xl">
          <ListBulletIcon className="w-10 h-10 mx-auto text-[var(--muted-foreground)] mb-3 opacity-60" />
          <p className="text-[var(--foreground)] text-sm font-medium">
            {search ? 'No lists match your search' : 'No lists yet'}
          </p>
          {!search && (
            <p className="text-[var(--muted-foreground)] text-xs mt-1 max-w-md mx-auto">
              Click <span className="font-medium">New List</span> to create a roster — name it, then upload a CSV of contacts to populate it.
            </p>
          )}
        </div>
      )}

      {!loading && filteredAndSorted.length > 0 && (
        <div className="overflow-x-auto glass-table rounded-xl">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    aria-label={allVisibleSelected ? 'Deselect all visible' : 'Select all visible'}
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
                    }}
                    onChange={toggleAllVisible}
                    className="h-4 w-4 rounded border-[var(--border)] cursor-pointer accent-[var(--primary)]"
                  />
                </th>
                <SortHeader label="Name" sortKey="name" currentKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortHeader label="Members" sortKey="memberCount" currentKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <th className="text-left px-4 py-3 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                  Created by
                </th>
                <SortHeader label="Created" sortKey="createdAt" currentKey={sortKey} dir={sortDir} onSort={toggleSort} />
                {!isAccount && (
                  <th className="text-left px-4 py-3 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Account
                  </th>
                )}
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.map((list) => (
                <ListRow
                  key={list.id}
                  list={list}
                  href={subHref(`/contacts/lists/${list.id}`)}
                  showAccount={!isAccount}
                  dealer={!isAccount ? dealerForKey(list.accountKey) : ''}
                  selected={selectedIds.has(list.id)}
                  onToggleSelect={() => toggleSelect(list.id)}
                  onRename={() => setRenameTarget(list)}
                  onDelete={() => handleDeleteOne(list)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedIds.size > 0 && (
        <BulkActionDock
          count={selectedIds.size}
          itemLabel={selectedIds.size === 1 ? 'list' : 'lists'}
          actions={dockActions}
          onClose={clearSelection}
        />
      )}

      {showCreate && (
        <NewListModal
          accountOptions={accountOptions}
          defaultAccountKey={isAccount && accountKey ? accountKey : accountOptions[0]?.key ?? ''}
          canPickAccount={canPickAccount}
          onCreate={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}

      {renameTarget && (
        <RenameListModal
          list={renameTarget}
          onSave={(name, description) => handleRename(renameTarget, name, description)}
          onClose={() => setRenameTarget(null)}
        />
      )}
    </div>
  );
}

// ── SortHeader ──

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

// ── ListRow ──

function ListRow({
  list,
  href,
  showAccount,
  dealer,
  selected,
  onToggleSelect,
  onRename,
  onDelete,
}: {
  list: ListSummary;
  href: string;
  showAccount: boolean;
  dealer: string;
  selected: boolean;
  onToggleSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  return (
    <tr
      onClick={() => router.push(href)}
      className={`group border-b border-[var(--border)] transition-colors cursor-pointer ${
        selected ? 'bg-[var(--primary)]/8' : 'hover:bg-[var(--muted)]/50'
      }`}
    >
      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          aria-label={`Select ${list.name}`}
          checked={selected}
          onChange={onToggleSelect}
          className="h-4 w-4 rounded border-[var(--border)] cursor-pointer accent-[var(--primary)]"
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-[var(--primary)]/10 text-[var(--primary)]">
            <ListBulletIcon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{list.name}</p>
            {list.description && (
              <p className="text-[11px] text-[var(--muted-foreground)] truncate max-w-[420px]">
                {list.description}
              </p>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-sm tabular-nums">{list.memberCount.toLocaleString()}</td>
      <td className="px-4 py-3 text-sm text-[var(--muted-foreground)]">
        {list.createdByUserName || '—'}
      </td>
      <td className="px-4 py-3 text-sm text-[var(--muted-foreground)] whitespace-nowrap">
        {formatDate(list.createdAt)}
      </td>
      {showAccount && (
        <td className="px-4 py-3 text-sm font-medium truncate max-w-[150px]">{dealer || '—'}</td>
      )}
      <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={onRename}
            title="Rename list"
            className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/60"
          >
            <PencilSquareIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete list"
            className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-red-400 hover:bg-red-500/10"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Rename modal ──

function RenameListModal({
  list,
  onSave,
  onClose,
}: {
  list: ListSummary;
  onSave: (name: string, description: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(list.name);
  const [description, setDescription] = useState(list.description ?? '');
  const [submitting, setSubmitting] = useState(false);

  const dirty = name.trim() !== list.name || description.trim() !== (list.description ?? '');
  const canSubmit = name.trim().length > 0 && dirty && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSave(name.trim(), description.trim());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="glass-card glass-card-strong w-full max-w-md rounded-2xl border border-[var(--border)] p-5 space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold">Rename list</h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">
              Update the name or description. Members aren&apos;t affected.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/60"
            aria-label="Close"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={120}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
              Description <span className="text-[var(--muted-foreground)] font-normal lowercase">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 h-10 text-sm rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--muted-foreground)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── New List modal ──

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function NewListModal({
  accountOptions,
  defaultAccountKey,
  canPickAccount,
  onCreate,
  onClose,
}: {
  accountOptions: { key: string; dealer: string }[];
  defaultAccountKey: string;
  canPickAccount: boolean;
  onCreate: (name: string, accountKey: string, description: string, file: File) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedAccountKey, setSelectedAccountKey] = useState(defaultAccountKey);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    name.trim().length > 0 && selectedAccountKey.length > 0 && file !== null && !submitting;

  function handleFilePick(next: File | null) {
    if (!next) {
      setFile(null);
      setFileError(null);
      return;
    }
    if (next.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      setFileError(`File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB limit`);
      return;
    }
    setFile(next);
    setFileError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !file) return;
    setSubmitting(true);
    try {
      await onCreate(name.trim(), selectedAccountKey, description.trim(), file);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="glass-card glass-card-strong w-full max-w-md rounded-2xl border border-[var(--border)] p-5 space-y-4"
      >
        <div>
          <h3 className="text-lg font-bold">New List</h3>
          <p className="text-xs text-[var(--muted-foreground)] mt-1">
            Name the list and pick a CSV. You&apos;ll map columns next.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q4 Service Customers"
              autoFocus
              maxLength={120}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)]"
            />
          </div>

          {canPickAccount && (
            <div>
              <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                Account
              </label>
              <select
                value={selectedAccountKey}
                onChange={(e) => setSelectedAccountKey(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)]"
              >
                {accountOptions.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.dealer}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
              CSV file
            </label>
            <label
              htmlFor="new-list-csv-file"
              className={`block w-full rounded-xl border-2 border-dashed p-5 text-center cursor-pointer transition-colors ${
                file
                  ? 'border-[var(--primary)] bg-[var(--primary)]/5'
                  : 'border-[var(--border)] hover:border-[var(--muted-foreground)]'
              }`}
            >
              <CloudArrowUpIcon className="w-7 h-7 mx-auto text-[var(--muted-foreground)] mb-1.5" />
              {file ? (
                <>
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                    {(file.size / 1024).toFixed(1)} KB · click to choose a different file
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">Click to choose a CSV</p>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                    Up to 25 MB. First row should be a header.
                  </p>
                </>
              )}
              <input
                id="new-list-csv-file"
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => handleFilePick(e.target.files?.[0] ?? null)}
              />
            </label>
            {fileError && (
              <p className="text-xs text-amber-300 mt-1.5">{fileError}</p>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
              Description <span className="text-[var(--muted-foreground)] font-normal lowercase">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this list for?"
              rows={2}
              maxLength={500}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 h-10 text-sm rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--muted-foreground)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creating…' : 'Create + Continue'}
          </button>
        </div>
      </form>
    </div>
  );
}
