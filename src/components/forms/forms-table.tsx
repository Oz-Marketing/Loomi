'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronUpDownIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  EllipsisHorizontalIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { AccountAvatar } from '@/components/account-avatar';
import BulkActionDock, { type BulkActionDockItem } from '@/components/bulk-action-dock';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';

// ── Types ──

export interface FormsTableRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  submissionCount: number;
  accountKey?: string;
  dealer?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BulkActionContext {
  selectedIds: string[];
  totalSelected: number;
  clearSelection: () => void;
}

interface FormsTableProps {
  forms: FormsTableRow[];
  loading?: boolean;
  accountMeta: Record<
    string,
    {
      dealer: string;
      logos?: { light?: string; dark?: string; white?: string; black?: string };
      storefrontImage?: string;
      category?: string;
    }
  >;
  /** Hide the Sub-Account column when the list is already account-scoped. */
  showAccountColumn: boolean;
  /** When set, renders a publish toggle in its own column (sub-account view).
   *  Hidden in admin view since publishing happens on the form's overview. */
  onTogglePublish?: (form: FormsTableRow, nextStatus: 'published' | 'draft') => void;
  updatingFormIds?: string[];
  emptyState: { title: string; subtitle: string };
  /** Wires the checkbox column + BulkActionDock. */
  bulkActions?: (ctx: BulkActionContext) => BulkActionDockItem[];
  /** Row 3-dot menu — caller owns the actual handlers. The row itself
   *  is clickable to the overview, so the menu only needs Edit + Delete. */
  onRowEdit?: (form: FormsTableRow) => void;
  onRowDelete?: (form: FormsTableRow) => void;
}

type SortKey =
  | 'name'
  | 'status'
  | 'submissionCount'
  | 'updatedAt'
  | 'createdAt'
  | 'dealer';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 25;

// ── Helpers ──

function formatRelativeDate(iso?: string): string {
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

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-zinc-500/15 text-zinc-400',
  published: 'bg-green-500/15 text-green-400',
};

// ── Main ──

export function FormsTable({
  forms,
  loading = false,
  accountMeta,
  showAccountColumn,
  onTogglePublish,
  updatingFormIds = [],
  emptyState,
  bulkActions,
  onRowEdit,
  onRowDelete,
}: FormsTableProps) {
  const [search, setSearch] = React.useState('');
  const [sortKey, setSortKey] = React.useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = React.useState<SortDir>('desc');
  const [page, setPage] = React.useState(1);

  // Bulk selection state — only used when the caller wires bulkActions.
  const bulkEnabled = !!bulkActions;
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const clearSelection = React.useCallback(() => setSelectedIds(new Set()), []);

  const filtered = React.useMemo(() => {
    if (!search.trim()) return forms;
    const q = search.trim().toLowerCase();
    return forms.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.slug.toLowerCase().includes(q) ||
        (f.dealer ?? '').toLowerCase().includes(q),
    );
  }, [forms, search]);

  const sorted = React.useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = pickSortValue(a, sortKey, accountMeta);
      const bv = pickSortValue(b, sortKey, accountMeta);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir, accountMeta]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const hasMultiplePages = totalPages > 1;

  // Reset page on filter/search changes so the user doesn't end up on
  // an empty trailing page.
  React.useEffect(() => {
    setPage(1);
  }, [search, forms.length]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' || key === 'dealer' || key === 'status' ? 'asc' : 'desc');
    }
  };

  // Bulk-selection helpers.
  const pageIds = paged.map((f) => f.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected = pageIds.some((id) => selectedIds.has(id));
  const togglePageSelection = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  };
  const toggleRowSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedArr = Array.from(selectedIds);
  const dockActions = bulkActions
    ? bulkActions({
        selectedIds: selectedArr,
        totalSelected: selectedArr.length,
        clearSelection,
      })
    : [];

  const hasRowActions = !!onRowEdit || !!onRowDelete;

  if (loading) {
    return (
      <div className="glass-table rounded-xl p-10 text-center">
        <p className="text-sm text-[var(--muted-foreground)]">Loading forms…</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 pb-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
          <span className="tabular-nums">
            {filtered.length !== forms.length
              ? `${filtered.length} / ${forms.length}`
              : forms.length}{' '}
            {forms.length === 1 ? 'form' : 'forms'}
          </span>
          {hasMultiplePages && (
            <span className="ml-1 opacity-60">
              · Page {safePage} of {totalPages}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <MagnifyingGlassIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search forms…"
              className="w-56 pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
          </div>
        </div>
      </div>

      {paged.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm font-medium text-[var(--foreground)]">
            {emptyState.title}
          </p>
          <p className="text-xs text-[var(--muted-foreground)] mt-1">
            {emptyState.subtitle}
          </p>
        </div>
      ) : (
        <>
          <div className="glass-table rounded-xl">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
                  {bulkEnabled && (
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
                  )}
                  <SortHeader
                    label="Name"
                    sortKey="name"
                    currentKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  />
                  {showAccountColumn && (
                    <SortHeader
                      label="Status"
                      sortKey="status"
                      currentKey={sortKey}
                      dir={sortDir}
                      onSort={handleSort}
                    />
                  )}
                  {!showAccountColumn && (
                    <th className="text-left px-4 py-3 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider w-32">
                      Publish
                    </th>
                  )}
                  {showAccountColumn && (
                    <SortHeader
                      label="Sub-Account"
                      sortKey="dealer"
                      currentKey={sortKey}
                      dir={sortDir}
                      onSort={handleSort}
                    />
                  )}
                  <SortHeader
                    label="Submissions"
                    sortKey="submissionCount"
                    currentKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Updated"
                    sortKey="updatedAt"
                    currentKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Created"
                    sortKey="createdAt"
                    currentKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  />
                  {hasRowActions && (
                    <th className="w-12 px-3 py-3" aria-label="Row actions" />
                  )}
                </tr>
              </thead>
              <tbody>
                {paged.map((form) => (
                  <FormRow
                    key={form.id}
                    form={form}
                    showAccountColumn={showAccountColumn}
                    accountMeta={accountMeta}
                    onTogglePublish={onTogglePublish}
                    isUpdating={updatingFormIds.includes(form.id)}
                    selectable={bulkEnabled}
                    isSelected={selectedIds.has(form.id)}
                    onToggleSelect={() => toggleRowSelection(form.id)}
                    onEdit={onRowEdit}
                    onDelete={onRowDelete}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {bulkEnabled && selectedArr.length > 0 && (
            <BulkActionDock
              count={selectedArr.length}
              itemLabel={selectedArr.length === 1 ? 'form' : 'forms'}
              actions={dockActions}
              onClose={clearSelection}
            />
          )}

          {hasMultiplePages && (
            <div className="flex items-center justify-between gap-2 pt-3">
              <div className="text-xs text-[var(--muted-foreground)]">
                Showing {(safePage - 1) * PAGE_SIZE + 1}–
                {Math.min(safePage * PAGE_SIZE, sorted.length)} of {sorted.length}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeftIcon className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs text-[var(--muted-foreground)] tabular-nums px-2">
                  {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRightIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Sort header ──

function SortHeader({
  label,
  sortKey,
  currentKey,
  dir,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const isActive = currentKey === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`px-4 py-3 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider cursor-pointer hover:text-[var(--foreground)] transition-colors select-none ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
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

// ── Row ──

function FormRow({
  form,
  showAccountColumn,
  accountMeta,
  onTogglePublish,
  isUpdating,
  selectable,
  isSelected,
  onToggleSelect,
  onEdit,
  onDelete,
}: {
  form: FormsTableRow;
  showAccountColumn: boolean;
  accountMeta: FormsTableProps['accountMeta'];
  onTogglePublish?: FormsTableProps['onTogglePublish'];
  isUpdating: boolean;
  selectable: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onEdit?: (form: FormsTableRow) => void;
  onDelete?: (form: FormsTableRow) => void;
}) {
  const router = useRouter();
  const subHref = useSubaccountHref();
  const published = form.status === 'published';
  const statusClass = STATUS_STYLES[form.status] || 'bg-zinc-500/15 text-zinc-400';
  const meta = form.accountKey ? accountMeta[form.accountKey] : undefined;
  const hasRowActions = !!onEdit || !!onDelete;

  return (
    <tr
      onClick={() => router.push(subHref(`/websites/forms/${form.id}`))}
      className={`border-b border-[var(--border)] transition-colors cursor-pointer ${
        isSelected ? 'bg-[var(--primary)]/8' : 'hover:bg-[var(--muted)]/50'
      }`}
    >
      {selectable && (
        <td className="px-3 py-3">
          <input
            type="checkbox"
            aria-label={`Select ${form.name || 'form'}`}
            checked={isSelected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 rounded border-[var(--border)] cursor-pointer accent-[var(--primary)]"
          />
        </td>
      )}

      <td className="px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--foreground)] truncate">
            {form.name || 'Untitled form'}
          </div>
          <div className="text-[11px] text-[var(--muted-foreground)] font-mono truncate">
            /f/{form.slug}
          </div>
        </div>
      </td>

      {showAccountColumn && (
        <td className="px-4 py-3">
          <span
            className={`inline-flex items-center text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full ${statusClass}`}
          >
            {form.status}
          </span>
        </td>
      )}

      {!showAccountColumn && (
        <td className="px-4 py-3">
          {onTogglePublish && (
            <button
              type="button"
              disabled={isUpdating}
              onClick={(e) => {
                e.stopPropagation();
                onTogglePublish(form, published ? 'draft' : 'published');
              }}
              role="switch"
              aria-checked={published}
              title={published ? 'Move to draft' : 'Publish form'}
              className={`relative w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${
                published ? 'bg-emerald-500' : 'bg-[var(--muted-foreground)]/30'
              }`}
            >
              <span
                className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-[left] duration-150 ease-out"
                style={{ left: published ? '18px' : '2px' }}
              />
            </button>
          )}
        </td>
      )}

      {showAccountColumn && (
        <td className="px-4 py-3">
          {meta ? (
            <div className="flex items-center gap-2 min-w-0">
              <AccountAvatar
                name={meta.dealer}
                accountKey={form.accountKey ?? ''}
                logos={meta.logos}
                size={24}
              />
              <span className="text-sm text-[var(--foreground)] truncate">
                {meta.dealer}
              </span>
            </div>
          ) : (
            <span className="text-xs text-[var(--muted-foreground)]">—</span>
          )}
        </td>
      )}

      <td className="px-4 py-3 text-right tabular-nums">
        {form.submissionCount > 0 ? (
          <span className="text-sm text-[var(--foreground)]">
            {form.submissionCount.toLocaleString()}
          </span>
        ) : (
          <span className="text-sm text-[var(--muted-foreground)]/60">0</span>
        )}
      </td>

      <td className="px-4 py-3 text-sm text-[var(--muted-foreground)] tabular-nums whitespace-nowrap">
        {formatRelativeDate(form.updatedAt)}
      </td>

      <td className="px-4 py-3 text-sm text-[var(--muted-foreground)] tabular-nums whitespace-nowrap">
        {formatRelativeDate(form.createdAt)}
      </td>

      {hasRowActions && (
        <td
          className="px-2 py-3"
          onClick={(e) => e.stopPropagation()}
        >
          <FormRowActionsMenu
            form={form}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </td>
      )}
    </tr>
  );
}

// ── 3-dot menu ──

function FormRowActionsMenu({
  form,
  onEdit,
  onDelete,
}: {
  form: FormsTableRow;
  onEdit?: (form: FormsTableRow) => void;
  onDelete?: (form: FormsTableRow) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
      >
        <EllipsisHorizontalIcon className="w-4 h-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-30 w-44 glass-dropdown shadow-lg"
        >
          {onEdit && (
            <MenuItem
              icon={<PencilSquareIcon className="w-3.5 h-3.5" />}
              label="Edit form"
              onClick={() => {
                setOpen(false);
                onEdit(form);
              }}
            />
          )}
          {onDelete && (
            <>
              <div className="my-1 h-px bg-[var(--border)]" />
              <MenuItem
                icon={<TrashIcon className="w-3.5 h-3.5" />}
                label="Delete"
                danger
                onClick={() => {
                  setOpen(false);
                  onDelete(form);
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 py-2 text-xs rounded-md transition-colors ${
        danger
          ? 'text-rose-300 hover:bg-rose-500/10'
          : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Sort value picker ──

function pickSortValue(
  form: FormsTableRow,
  key: SortKey,
  accountMeta: FormsTableProps['accountMeta'],
): string | number {
  switch (key) {
    case 'name':
      return (form.name || '').toLowerCase();
    case 'status':
      return form.status;
    case 'submissionCount':
      return form.submissionCount;
    case 'dealer': {
      const meta = form.accountKey ? accountMeta[form.accountKey] : undefined;
      return (meta?.dealer || '').toLowerCase();
    }
    case 'updatedAt':
      return form.updatedAt ?? '';
    case 'createdAt':
      return form.createdAt ?? '';
    default:
      return '';
  }
}
