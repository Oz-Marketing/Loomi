'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronUpDownIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  Squares2X2Icon,
  EllipsisHorizontalIcon,
  PencilSquareIcon,
  PencilIcon,
  DocumentDuplicateIcon,
  ArchiveBoxIcon,
  ArrowUturnLeftIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { AccountAvatar } from '@/components/account-avatar';
import BulkActionDock, { type BulkActionDockItem } from '@/components/bulk-action-dock';
import { StatusFilter, type StatusFilterValue } from '@/components/status-filter';

// ── Types ──
// `Workflow` mirrors the shape used elsewhere on the flows page.

export interface FlowsTableRow {
  id: string;
  name: string;
  status: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
  accountKey?: string;
  dealer?: string;
  /** When set, this flow is an instance deployed from a template.
   *  Powers the adoption column (admin view: each template row shows
   *  which sub-accounts have an instance). */
  parentTemplateId?: string;
  /** Currently-enrolled contact count. Sourced from FlowSummary in
   *  the listFlows service. Shown as its own column in the
   *  sub-account view so users can see at a glance how many contacts
   *  are flowing through each instance. */
  activeEnrollments?: number;
}

interface FlowsTableProps {
  workflows: FlowsTableRow[];
  loading: boolean;
  accountMeta: Record<
    string,
    {
      dealer: string;
      logos?: { light?: string; dark?: string; white?: string; black?: string };
      storefrontImage?: string;
      /** Optional address pieces used by the Adoption column's hover
       *  tooltip — mirrors the users-tab Sub-Accounts popover. */
      city?: string;
      state?: string;
      category?: string;
    }
  >;
  /** Hide the Sub-Account column when only one account's worth of
   *  flows is on screen (account-scoped views). */
  showAccountColumn: boolean;
  onToggleStatus?: (flow: FlowsTableRow, nextStatus: 'active' | 'inactive') => void;
  updatingStatusFlowIds?: string[];
  emptyState: { title: string; subtitle: string };
  /** When provided, the table renders a checkbox column and a
   *  BulkActionDock for the current selection. The callback receives
   *  the selected flow IDs + a `clearSelection` helper to call after
   *  a successful mutation. */
  bulkActions?: (ctx: BulkActionContext) => BulkActionDockItem[];
  /** Pre-computed templateId → instance-rows map. Provided by callers
   *  that filter instances out of `workflows` (admin view) so the
   *  adoption column can still see them. When omitted, the table
   *  builds its own map from `workflows`. */
  adoption?: Map<string, FlowsTableRow[]>;
  /** Status filter — when both value + onChange are provided the
   *  table renders the StatusFilter dropdown to the left of the
   *  search input. The caller owns the state so it can drive the
   *  API fetch. */
  statusFilter?: StatusFilterValue;
  onStatusFilterChange?: (next: StatusFilterValue) => void;
  /** Controlled search. When provided the table reads this value
   *  instead of its internal state — lets a shared ListToolbar above
   *  the table drive both card + table views from the same string. */
  search?: string;
  onSearchChange?: (next: string) => void;
  /** Hide the internal toolbar (count + search + status filter).
   *  Caller is expected to render its own toolbar above the table. */
  hideToolbar?: boolean;
  /** Row-level action handlers. When any are provided, the table
   *  renders an Actions column with a 3-dot menu per row. The page
   *  owns the dialogs/modals these trigger so we don't duplicate
   *  Loomi dialog state per row. */
  onRowEdit?: (flow: FlowsTableRow) => void;
  onRowRename?: (flow: FlowsTableRow) => void;
  onRowClone?: (flow: FlowsTableRow) => void;
  onRowArchive?: (flow: FlowsTableRow) => void;
  onRowRestore?: (flow: FlowsTableRow) => void;
  onRowDelete?: (flow: FlowsTableRow) => void;
}

export interface BulkActionContext {
  selectedIds: string[];
  totalSelected: number;
  clearSelection: () => void;
}

type SortKey = 'name' | 'status' | 'updatedAt' | 'createdAt' | 'dealer' | 'adoption';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 25;

// ── Helpers ──

function formatRelativeDate(iso?: string) {
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

// Display mapping for the status badge. 'paused' is folded into
// 'draft' in the UI — we no longer surface the paused vocabulary even
// though the DB still uses it under the hood (pauseFlow continues to
// write status='paused').
function statusDisplayLabel(status: string): string {
  if (status === 'paused') return 'draft';
  return status;
}

function statusDisplayKey(status: string): string {
  return statusDisplayLabel(status);
}

const STATUS_STYLES: Record<string, string> = {
  // 'paused' is intentionally absent — statusDisplayKey collapses it
  // into 'draft' before lookup.
  draft: 'bg-zinc-500/15 text-zinc-400',
  active: 'bg-green-500/15 text-green-400',
  archived: 'bg-rose-500/15 text-rose-400',
};

// ── Main ──

export function FlowsTable({
  workflows,
  loading,
  accountMeta,
  showAccountColumn,
  onToggleStatus,
  updatingStatusFlowIds = [],
  emptyState,
  bulkActions,
  adoption: providedAdoption,
  onRowEdit,
  onRowRename,
  onRowClone,
  onRowArchive,
  onRowRestore,
  onRowDelete,
  statusFilter,
  onStatusFilterChange,
  search: controlledSearch,
  onSearchChange,
  hideToolbar = false,
}: FlowsTableProps) {
  // Whether any row-level action is wired. Drives the Actions column
  // header + per-row menu visibility.
  const hasRowActions =
    !!onRowEdit ||
    !!onRowRename ||
    !!onRowClone ||
    !!onRowArchive ||
    !!onRowRestore ||
    !!onRowDelete;
  // Search: controlled if the caller wired the props, otherwise local.
  const [internalSearch, setInternalSearch] = useState('');
  const search = controlledSearch ?? internalSearch;
  const setSearch = (next: string) => {
    if (onSearchChange) onSearchChange(next);
    else setInternalSearch(next);
  };
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  // Bulk-select state. Tracked as a Set so toggling N items doesn't
  // trip a full-array rerender each click.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const bulkEnabled = !!bulkActions;

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(
        key === 'name' || key === 'status' || key === 'dealer' ? 'asc' : 'desc',
      );
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return workflows;
    return workflows.filter((w) => {
      const haystack = `${w.name} ${w.dealer ?? ''} ${w.status}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [workflows, search]);

  // Adoption map: templateId → list of instance rows. Prefer the
  // caller-provided map (the admin view passes one computed over the
  // *unfiltered* list, since instance rows themselves are hidden from
  // the table). Fall back to deriving from `workflows` when no map is
  // provided (sub-account view, or any caller that doesn't filter).
  const adoptionMap = useMemo(() => {
    if (providedAdoption) return providedAdoption;
    const map = new Map<string, FlowsTableRow[]>();
    for (const w of workflows) {
      if (!w.parentTemplateId) continue;
      const arr = map.get(w.parentTemplateId) ?? [];
      arr.push(w);
      map.set(w.parentTemplateId, arr);
    }
    return map;
  }, [workflows, providedAdoption]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const av = pickSortValue(a, sortKey, adoptionMap);
      const bv = pickSortValue(b, sortKey, adoptionMap);
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av < bv ? -1 * dir : 1 * dir;
    });
    return arr;
  }, [filtered, sortKey, sortDir, adoptionMap]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const hasMultiplePages = totalPages > 1;

  // ── Bulk-select helpers ──
  const pageIds = paged.map((f) => f.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected = pageIds.some((id) => selectedIds.has(id));
  const clearSelection = () => setSelectedIds(new Set());

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
  const dockActions =
    bulkEnabled && selectedArr.length > 0
      ? bulkActions!({
          selectedIds: selectedArr,
          totalSelected: selectedArr.length,
          clearSelection,
        })
      : [];

  if (loading) {
    return (
      <div className="py-6 animate-pulse">
        <div className="w-40 h-5 bg-[var(--muted)] rounded mb-4" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="w-48 h-4 bg-[var(--muted)] rounded" />
              <div className="w-20 h-4 bg-[var(--muted)] rounded" />
              <div className="flex-1" />
              <div className="w-16 h-4 bg-[var(--muted)] rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up animate-stagger-3">
      {!hideToolbar && (
        <div className="flex items-center justify-between gap-4 pb-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
            <span className="tabular-nums">
              {filtered.length !== workflows.length
                ? `${filtered.length} / ${workflows.length}`
                : workflows.length}{' '}
              {workflows.length === 1 ? 'flow' : 'flows'}
            </span>
            {hasMultiplePages && (
              <span className="ml-1 opacity-60">
                · Page {safePage} of {totalPages}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {statusFilter !== undefined && onStatusFilterChange && (
              <StatusFilter
                value={statusFilter}
                onChange={(next) => {
                  onStatusFilterChange(next);
                  setPage(1);
                }}
              />
            )}
            <div className="relative">
              <MagnifyingGlassIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search flows..."
                className="w-56 pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
              />
            </div>
          </div>
        </div>
      )}

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
          {/* Standard glass-table chrome — same as forms / landing
              pages / campaigns. The Adoption column's hover popover
              can clip when it lands inside the top row; that's an
              acceptable tradeoff for keeping the rounded corners +
              consistent muted-bg header across all list tables. */}
          <div className="overflow-x-auto glass-table">
            <table className="w-full min-w-[820px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
                  {bulkEnabled && (
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={
                          allPageSelected ? 'Deselect page' : 'Select page'
                        }
                        checked={allPageSelected}
                        ref={(el) => {
                          if (el)
                            el.indeterminate = somePageSelected && !allPageSelected;
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
                  {/* Status — admin view only. Sub-account view
                      drops it since the publish toggle already
                      communicates active vs paused/draft. */}
                  {showAccountColumn && (
                    <SortHeader
                      label="Status"
                      sortKey="status"
                      currentKey={sortKey}
                      dir={sortDir}
                      onSort={handleSort}
                    />
                  )}
                  {/* Publish — only relevant when the row could
                      actually be published. Admin view shows
                      templates (which deploy, not publish) so the
                      column is hidden there. */}
                  {!showAccountColumn && (
                    <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider w-32">
                      Publish
                    </th>
                  )}
                  {/* Active Enrolled — sub-account view only. Helps
                      the user see at a glance how many contacts are
                      flowing through each instance right now. */}
                  {!showAccountColumn && (
                    <th className="text-right px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider w-32">
                      Active Enrolled
                    </th>
                  )}
                  {showAccountColumn && (
                    <SortHeader
                      label="Adoption"
                      sortKey="adoption"
                      currentKey={sortKey}
                      dir={sortDir}
                      onSort={handleSort}
                    />
                  )}
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
                    <th className="w-12 px-3 py-2" aria-label="Row actions" />
                  )}
                </tr>
              </thead>
              <tbody>
                {paged.map((flow) => (
                  <FlowRow
                    key={flow.id}
                    flow={flow}
                    showAccountColumn={showAccountColumn}
                    accountMeta={accountMeta}
                    adoption={adoptionMap.get(flow.id) ?? []}
                    onToggleStatus={onToggleStatus}
                    isUpdating={updatingStatusFlowIds.includes(flow.id)}
                    selectable={bulkEnabled}
                    isSelected={selectedIds.has(flow.id)}
                    onToggleSelect={() => toggleRowSelection(flow.id)}
                    onEdit={onRowEdit}
                    onRename={onRowRename}
                    onClone={onRowClone}
                    onArchive={onRowArchive}
                    onRestore={onRowRestore}
                    onDelete={onRowDelete}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Bulk action dock — portals to body, only renders when the
              caller wired bulk actions AND the user has a non-empty
              selection. */}
          {bulkEnabled && selectedArr.length > 0 && (
            <BulkActionDock
              count={selectedArr.length}
              itemLabel={selectedArr.length === 1 ? 'flow' : 'flows'}
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

// Stacked sub-account avatars showing which accounts have an instance
// of this template. Empty cell for non-templates / templates with no
// deploys yet. Mirrors the Sub-Accounts column on the users-tab
// settings table: 32px circular avatars, white-background ring,
// negative margin overlap that spreads on hover, "+N" overflow chip
// matching the avatar dimensions. Each avatar is a Link to its
// instance overview — clicking an avatar drills into that specific
// deploy without triggering the row's template-navigation.
function AdoptionCell({
  adoption,
  accountMeta,
}: {
  adoption: FlowsTableRow[];
  accountMeta: FlowsTableProps['accountMeta'];
}) {
  if (adoption.length === 0) {
    return <span className="text-xs text-[var(--muted-foreground)]/60">—</span>;
  }
  const MAX_VISIBLE = 4;
  const visible = adoption.slice(0, MAX_VISIBLE);
  const overflow = adoption.length - visible.length;
  return (
    <div className="account-avatar-stack flex items-center pl-2">
      {visible.map((inst) => {
        const meta = inst.accountKey ? accountMeta[inst.accountKey] : null;
        if (!meta) return null;
        const cityState = [meta.city, meta.state].filter(Boolean).join(', ') || 'Location unavailable';
        const industry = meta.category?.trim() || 'Unknown industry';
        return (
          <Link
            key={inst.id}
            href={`/flows/${inst.id}`}
            onClick={(e) => e.stopPropagation()}
            aria-label={`${meta.dealer} • ${cityState} • ${industry} • Key: ${inst.accountKey ?? ''} • Open instance`}
            className="account-avatar-stack-item relative inline-flex items-center group"
          >
            {/* Hover popover — dealer + city/state + industry + key.
                pointer-events-none so the popover itself doesn't
                intercept clicks on the underlying Link. Hidden by
                default; revealed on group hover. */}
            <span className="pointer-events-none absolute bottom-full left-1/2 z-[90] mb-2 hidden -translate-x-1/2 group-hover:block">
              <span className="relative block account-tooltip-popover rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 shadow-xl whitespace-nowrap">
                <span className="block text-[11px] font-medium leading-4 text-[var(--foreground)]">
                  {meta.dealer}
                </span>
                <span className="block text-[10px] leading-4 text-[var(--muted-foreground)]">
                  {cityState}
                </span>
                <span className="block text-[10px] leading-4 text-[var(--muted-foreground)]">
                  {industry}
                </span>
                {inst.accountKey && (
                  <span className="mt-1 block text-[10px] font-mono leading-4 text-[var(--muted-foreground)]">
                    Key: {inst.accountKey}
                  </span>
                )}
                <span className="absolute left-1/2 top-full -translate-x-1/2 w-0 h-0 border-x-[6px] border-x-transparent border-t-[7px] border-t-[var(--background)]" />
              </span>
            </span>

            <span className="inline-flex rounded-full bg-[var(--background)] p-[1px] shadow-sm">
              <AccountAvatar
                name={meta.dealer}
                accountKey={inst.accountKey}
                logos={meta.logos}
                size={32}
                className="rounded-full"
                alt={`${meta.dealer} (${inst.accountKey ?? ''})`}
              />
            </span>
          </Link>
        );
      })}

      {overflow > 0 && (
        <span
          title={adoption
            .slice(MAX_VISIBLE)
            .map((i) => accountMeta[i.accountKey ?? '']?.dealer ?? i.accountKey)
            .join(', ')}
          className="account-avatar-stack-item inline-flex items-center justify-center w-[34px] h-[34px] rounded-full border border-[var(--background)] bg-[var(--background)] text-[10px] font-medium text-[var(--muted-foreground)] shadow-sm"
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

function pickSortValue(
  w: FlowsTableRow,
  key: SortKey,
  adoptionMap?: Map<string, FlowsTableRow[]>,
): string | number | null {
  if (key === 'name') return w.name.toLowerCase();
  if (key === 'status') return w.status;
  if (key === 'dealer') return (w.dealer || '').toLowerCase();
  if (key === 'updatedAt') return w.updatedAt ? new Date(w.updatedAt).getTime() : 0;
  if (key === 'createdAt') return w.createdAt ? new Date(w.createdAt).getTime() : 0;
  if (key === 'adoption') {
    // Instances + standalone flows sort to 0; templates sort by the
    // count of their deployed instances.
    return adoptionMap?.get(w.id)?.length ?? 0;
  }
  return null;
}

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
      className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider cursor-pointer hover:text-[var(--foreground)] transition-colors select-none"
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

// ── Row ──

function FlowRow({
  flow,
  showAccountColumn,
  accountMeta,
  adoption,
  onToggleStatus,
  isUpdating,
  selectable,
  isSelected,
  onToggleSelect,
  onEdit,
  onRename,
  onClone,
  onArchive,
  onRestore,
  onDelete,
}: {
  flow: FlowsTableRow;
  showAccountColumn: boolean;
  accountMeta: FlowsTableProps['accountMeta'];
  adoption: FlowsTableRow[];
  onToggleStatus?: FlowsTableProps['onToggleStatus'];
  isUpdating: boolean;
  selectable: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onEdit?: (flow: FlowsTableRow) => void;
  onRename?: (flow: FlowsTableRow) => void;
  onClone?: (flow: FlowsTableRow) => void;
  onArchive?: (flow: FlowsTableRow) => void;
  onRestore?: (flow: FlowsTableRow) => void;
  onDelete?: (flow: FlowsTableRow) => void;
}) {
  const hasRowActions =
    !!onEdit || !!onRename || !!onClone || !!onArchive || !!onRestore || !!onDelete;
  const router = useRouter();
  const isActive = flow.status === 'active';
  // Use the display label/key so 'paused' rows render as Draft, not
  // as their raw DB value.
  const displayKey = statusDisplayKey(flow.status);
  const displayLabel = statusDisplayLabel(flow.status);
  const statusClass = STATUS_STYLES[displayKey] || 'bg-zinc-500/15 text-zinc-400';
  const isTemplate = !flow.accountKey;

  return (
    <tr
      onClick={() => router.push(`/flows/${flow.id}`)}
      className={`border-b border-[var(--border)] last:border-b-0 transition-colors cursor-pointer ${
        isSelected ? 'bg-[var(--primary)]/8' : 'hover:bg-[var(--muted)]/50'
      }`}
    >
      {selectable && (
        <td className="px-3 py-2">
          <input
            type="checkbox"
            aria-label={`Select ${flow.name || 'flow'}`}
            checked={isSelected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 rounded border-[var(--border)] cursor-pointer accent-[var(--primary)]"
          />
        </td>
      )}
      <td className="px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-[var(--foreground)] truncate">
            {flow.name || 'Untitled flow'}
          </span>
          {/* Inline "Template" chip in the admin view so admins can
              tell templates apart at a glance — replaces what used
              to live in the Sub-Account column. */}
          {showAccountColumn && isTemplate && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-500/15 text-violet-300 flex-shrink-0"
              title="No sub-account — this is a template flow. Open it to deploy to one or more sub-accounts."
            >
              <Squares2X2Icon className="w-3 h-3" />
              Template
            </span>
          )}
        </div>
      </td>
      {showAccountColumn && (
        <td className="px-3 py-2">
          <span
            className={`inline-flex items-center text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full ${statusClass}`}
          >
            {displayLabel}
          </span>
        </td>
      )}
      {/* Publish column — hidden in admin view (templates deploy,
          they don't publish; standalone flows live in their own
          sub-account where this column does show). */}
      {!showAccountColumn && (
        <td className="px-3 py-2">
          {onToggleStatus && (
            <button
              type="button"
              disabled={isUpdating}
              onClick={(e) => {
                e.stopPropagation();
                onToggleStatus(flow, isActive ? 'inactive' : 'active');
              }}
              role="switch"
              aria-checked={isActive}
              title={isActive ? 'Pause flow' : 'Publish flow'}
              className={`relative w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${
                isActive ? 'bg-emerald-500' : 'bg-[var(--muted-foreground)]/30'
              }`}
            >
              {/* Track w-9 (36px) − thumb w-4 (16px) − 2px inset each
                  side = 18px travel. Using inline `style.left` rather
                  than a Tailwind arbitrary translate so the position is
                  unambiguous — `translate-x-[18px]` wasn't taking
                  effect in some builds and the thumb spilled past the
                  right edge. */}
              <span
                className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-[left] duration-150 ease-out"
                style={{ left: isActive ? '18px' : '2px' }}
              />
            </button>
          )}
        </td>
      )}
      {/* Active Enrolled — sub-account view only. Shows the live
          count returned by the listFlows service. */}
      {!showAccountColumn && (
        <td className="px-3 py-2 text-right tabular-nums">
          {flow.activeEnrollments && flow.activeEnrollments > 0 ? (
            <span className="text-sm text-[var(--foreground)]">
              {flow.activeEnrollments.toLocaleString()}
            </span>
          ) : (
            <span className="text-sm text-[var(--muted-foreground)]/60">0</span>
          )}
        </td>
      )}
      {showAccountColumn && (
        <td className="px-3 py-2 max-w-[220px]">
          <AdoptionCell adoption={adoption} accountMeta={accountMeta} />
        </td>
      )}
      <td className="px-3 py-2 text-sm text-[var(--muted-foreground)] whitespace-nowrap">
        {formatRelativeDate(flow.updatedAt)}
      </td>
      <td className="px-3 py-2 text-sm text-[var(--muted-foreground)] whitespace-nowrap">
        {formatRelativeDate(flow.createdAt)}
      </td>
      {hasRowActions && (
        <td className="px-3 py-2 align-middle">
          <FlowRowActionsMenu
            flow={flow}
            onEdit={onEdit}
            onRename={onRename}
            onClone={onClone}
            onArchive={onArchive}
            onRestore={onRestore}
            onDelete={onDelete}
          />
        </td>
      )}
    </tr>
  );
}

// 3-dot menu rendered in the rightmost Actions column. Click-outside
// closes; each item callback receives the row's flow. Renders the
// dropdown panel only when open so we don't pay layout cost per row
// at idle.
function FlowRowActionsMenu({
  flow,
  onEdit,
  onRename,
  onClone,
  onArchive,
  onRestore,
  onDelete,
}: {
  flow: FlowsTableRow;
  onEdit?: (flow: FlowsTableRow) => void;
  onRename?: (flow: FlowsTableRow) => void;
  onClone?: (flow: FlowsTableRow) => void;
  onArchive?: (flow: FlowsTableRow) => void;
  onRestore?: (flow: FlowsTableRow) => void;
  onDelete?: (flow: FlowsTableRow) => void;
}) {
  const isArchived = flow.status === 'archived';
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function fire(fn?: (f: FlowsTableRow) => void) {
    if (!fn) return;
    setOpen(false);
    fn(flow);
  }

  return (
    <div
      ref={wrapperRef}
      className="relative inline-flex"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Row actions"
        className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
      >
        <EllipsisHorizontalIcon className="w-4 h-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-30 w-48 glass-dropdown shadow-lg"
        >
          {/* Archived rows get a stripped menu — Restore + Delete only.
              Edit/Rename/Clone/Archive don't make sense until the row
              is back in a live state. */}
          {isArchived ? (
            <>
              {onRestore && (
                <MenuItem
                  icon={ArrowUturnLeftIcon}
                  label="Restore"
                  onClick={() => fire(onRestore)}
                />
              )}
              {onRestore && onDelete && (
                <div className="my-1 h-px bg-[var(--border)]" />
              )}
              {onDelete && (
                <MenuItem
                  icon={TrashIcon}
                  label="Delete"
                  danger
                  onClick={() => fire(onDelete)}
                />
              )}
            </>
          ) : (
            <>
              {onEdit && (
                <MenuItem
                  icon={PencilSquareIcon}
                  label="Edit"
                  onClick={() => fire(onEdit)}
                />
              )}
              {onRename && (
                <MenuItem
                  icon={PencilIcon}
                  label="Rename"
                  onClick={() => fire(onRename)}
                />
              )}
              {onClone && (
                <MenuItem
                  icon={DocumentDuplicateIcon}
                  label="Clone to sub-account…"
                  onClick={() => fire(onClone)}
                />
              )}
              {(onArchive || onDelete) && (
                <div className="my-1 h-px bg-[var(--border)]" />
              )}
              {onArchive && (
                <MenuItem
                  icon={ArchiveBoxIcon}
                  label="Archive"
                  onClick={() => fire(onArchive)}
                />
              )}
              {onDelete && (
                <MenuItem
                  icon={TrashIcon}
                  label="Delete"
                  danger
                  onClick={() => fire(onDelete)}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  danger,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 py-2 text-xs rounded-md transition-colors ${
        danger
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}
