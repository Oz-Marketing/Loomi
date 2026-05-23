'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  MagnifyingGlassIcon,
  ArrowTopRightOnSquareIcon,
  EllipsisHorizontalIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronUpDownIcon,
  CheckCircleIcon,
  PauseCircleIcon,
  XCircleIcon,
  DocumentTextIcon,
  BoltIcon,
  Squares2X2Icon,
  TableCellsIcon,
} from '@heroicons/react/24/outline';
import { FlowIcon } from '@/components/icon-map';
import { AccountAvatar as SharedAccountAvatar } from '@/components/account-avatar';
import { FlowCard } from '@/components/flows/flow-card';

// ── Types ──

interface Workflow {
  id: string;
  name: string;
  status: string;
  source?: string;
  provider?: string;
  locationId?: string;
  createdAt?: string;
  updatedAt?: string;
  accountKey?: string;
  dealer?: string;
}

export interface AccountMeta {
  dealer: string;
  category?: string;
  oem?: string;
  oems?: string[];
  state?: string;
  city?: string;
  locationId?: string;
  storefrontImage?: string;
  logos?: { light?: string; dark?: string; white?: string; black?: string };
  accountRepId?: string | null;
  accountRepName?: string | null;
  accountRepEmail?: string | null;
}

interface FlowListProps {
  workflows: Workflow[];
  loading?: boolean;
  accountNames?: Record<string, string>;
  accountMeta?: Record<string, AccountMeta>;
  // ESP provider deep-links are gone — accepted as an unused prop only
  // for callers that haven't been swept yet. Phase D.9 will drop it.
  accountProviders?: Record<string, string>;
  onToggleLoomiStatus?: (workflow: Workflow, nextStatus: 'active' | 'inactive') => void;
  updatingStatusFlowIds?: string[];
  emptyState?: {
    title: string;
    subtitle?: string;
    actionLabel?: string;
    actionHref?: string;
  } | null;
}

// ── Provider Deep Link ──

function getWorkflowKey(workflow: Workflow): string {
  return [
    workflow.accountKey || 'no-account',
    workflow.id || 'no-id',
  ].join('|');
}

function workflowAccountKey(workflow: Workflow): string | null {
  return workflow.accountKey || null;
}

function isLoomiWorkflow(workflow: Workflow): boolean {
  return (workflow.source || '').trim().toLowerCase() === 'loomi';
}

// ── Status helpers ──

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-green-500/10 text-green-400',
  draft:     'bg-zinc-500/10 text-zinc-400',
  inactive:  'bg-red-500/10 text-red-400',
  paused:    'bg-orange-500/10 text-orange-400',
};

const STATUS_ICON: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  active:   CheckCircleIcon,
  draft:    DocumentTextIcon,
  inactive: XCircleIcon,
  paused:   PauseCircleIcon,
};

function normalizeStatus(status: string): string {
  const s = status.toLowerCase().trim();
  if (s.includes('active') || s.includes('publish') || s.includes('running')) return 'active';
  if (s.includes('draft')) return 'draft';
  if (s.includes('pause') || s.includes('stop')) return 'paused';
  if (s.includes('inactive') || s.includes('cancel') || s.includes('disabled')) return 'inactive';
  return s;
}

function statusBadgeClass(status: string): string {
  return STATUS_BADGE[normalizeStatus(status)] || 'bg-zinc-500/10 text-zinc-400';
}

// ── Date helpers ──

const PAGE_SIZE = 25;

function getDateTimeParts(dateStr?: string): { date: string; time: string } | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const day = d.getDate();
  const year = d.getFullYear();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return {
    date: `${month} ${day}, ${year}`,
    time,
  };
}

function getTimestamp(dateStr?: string): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function getScheduledTs(workflow: Workflow): number {
  const raw = workflow.createdAt;
  return getTimestamp(raw);
}

function getLastUpdatedTs(workflow: Workflow): number {
  const raw = workflow.updatedAt || workflow.createdAt;
  return getTimestamp(raw);
}

function getScheduledDateParts(workflow: Workflow): { date: string; time: string } | null {
  return getDateTimeParts(workflow.createdAt);
}

function getLastUpdatedDateParts(workflow: Workflow): { date: string; time: string } | null {
  return getDateTimeParts(workflow.updatedAt || workflow.createdAt);
}

function getDateTs(workflow: Workflow): number {
  const raw = workflow.updatedAt || workflow.createdAt;
  if (!raw) return 0;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

// ── Sort ──

type SortField = 'status' | 'scheduled' | 'updated';
type SortDir = 'asc' | 'desc';

const STATUS_ORDER: Record<string, number> = {
  active: 0, draft: 1, paused: 2, inactive: 3,
};

function compareWorkflows(a: Workflow, b: Workflow, field: SortField, dir: SortDir): number {
  let cmp = 0;
  if (field === 'status') {
    const aOrder = STATUS_ORDER[normalizeStatus(a.status)] ?? 99;
    const bOrder = STATUS_ORDER[normalizeStatus(b.status)] ?? 99;
    cmp = aOrder - bOrder;
  } else if (field === 'scheduled') {
    cmp = getScheduledTs(a) - getScheduledTs(b);
  } else if (field === 'updated') {
    cmp = getLastUpdatedTs(a) - getLastUpdatedTs(b);
  } else {
    cmp = getDateTs(a) - getDateTs(b);
  }
  return dir === 'desc' ? -cmp : cmp;
}

// ── Grouping ──

interface WorkflowGroup {
  key: string;
  label: string;
  workflows: Workflow[];
}

function groupByAccount(
  workflows: Workflow[],
  accountNames?: Record<string, string>,
): WorkflowGroup[] {
  const map = new Map<string, Workflow[]>();

  workflows.forEach((w) => {
    const key = workflowAccountKey(w) || w.dealer || '_unknown';
    const arr = map.get(key);
    if (arr) arr.push(w);
    else map.set(key, [w]);
  });

  return [...map.entries()]
    .map(([key, items]) => ({
      key,
      label:
        (accountNames && accountNames[key]) ||
        items[0]?.dealer ||
        key,
      workflows: items,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ── Sortable Column Header ──

function SortHeader({
  label,
  field,
  activeField,
  activeDir,
  onToggle,
  className,
}: {
  label: string;
  field: SortField;
  activeField: SortField | null;
  activeDir: SortDir;
  onToggle: (f: SortField) => void;
  className?: string;
}) {
  const isActive = activeField === field;
  return (
    <button
      type="button"
      onClick={() => onToggle(field)}
      className={`inline-flex items-center justify-end gap-1 hover:text-[var(--foreground)] transition-colors ${
        isActive ? 'text-[var(--foreground)]' : ''
      } ${className || ''}`}
    >
      {label}
      {isActive ? (
        activeDir === 'desc'
          ? <ChevronDownIcon className="w-2.5 h-2.5" />
          : <ChevronUpIcon className="w-2.5 h-2.5" />
      ) : (
        <ChevronUpDownIcon className="w-2.5 h-2.5 opacity-60" />
      )}
    </button>
  );
}

// ── Account Avatar ──

function AccountAvatar({
  accountKey,
  dealer,
  storefrontImage,
  logos,
}: {
  accountKey: string;
  dealer: string;
  storefrontImage?: string;
  logos?: { light?: string; dark?: string; white?: string; black?: string };
}) {
  return (
    <Link
      href={`/accounts/${accountKey}`}
      className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
      title={`${dealer} — View account`}
      onClick={(e) => e.stopPropagation()}
    >
      <SharedAccountAvatar
        name={dealer}
        accountKey={accountKey}
        storefrontImage={storefrontImage}
        logos={logos}
        size={24}
        className="w-6 h-6 rounded-md object-cover flex-shrink-0 border border-[var(--border)]"
      />
      <span className="text-xs text-[var(--muted-foreground)] truncate">{dealer}</span>
    </Link>
  );
}

// ── Publish Switch (inline toggle for table view) ──

function PublishSwitch({
  active,
  disabled,
  updating,
  onToggle,
}: {
  active: boolean;
  disabled: boolean;
  updating: boolean;
  onToggle: (next: 'active' | 'inactive') => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      disabled={disabled || updating}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(active ? 'inactive' : 'active');
      }}
      title={
        disabled
          ? 'Publish toggle only available for Loomi flows'
          : active
            ? 'Click to unpublish'
            : 'Click to publish'
      }
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active ? 'bg-green-500' : 'bg-[var(--muted)] border border-[var(--border)]'
      } ${updating ? 'animate-pulse' : ''}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          active ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

// ── Workflow Row ──

function WorkflowRow({
  item,
  accountNames,
  accountMeta,
  showAccount,
  isMenuOpen,
  isStatusUpdating,
  onToggleMenu,
  onToggleLoomiStatus,
}: {
  item: Workflow;
  accountNames?: Record<string, string>;
  accountMeta?: Record<string, AccountMeta>;
  showAccount: boolean;
  isMenuOpen: boolean;
  isStatusUpdating: boolean;
  onToggleMenu: (item: Workflow) => void;
  onToggleLoomiStatus?: (workflow: Workflow, nextStatus: 'active' | 'inactive') => void;
}) {
  const accountKey = workflowAccountKey(item);
  const accountName = showAccount
    ? (accountKey && accountNames?.[accountKey]) ||
      item.dealer ||
      accountKey ||
      '—'
    : null;
  const meta = accountKey ? accountMeta?.[accountKey] : undefined;
  const normalized = normalizeStatus(item.status);
  const StatusIcon = STATUS_ICON[normalized];
  const isLoomiFlow = isLoomiWorkflow(item);
  const canToggleStatus = isLoomiFlow && typeof onToggleLoomiStatus === 'function';
  const scheduledParts = getScheduledDateParts(item);
  const updatedParts = getLastUpdatedDateParts(item);

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--muted)] transition-colors group">
      <span className="flex-1 min-w-0 flex items-center gap-2">
        <BoltIcon className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
        <span className="min-w-0">
          <span className="text-sm font-medium truncate block">{item.name || '(Untitled)'}</span>
        </span>
      </span>
      {showAccount && accountKey && (
        <span className="w-36">
          <AccountAvatar
            accountKey={accountKey}
            dealer={accountName || '—'}
            storefrontImage={meta?.storefrontImage}
            logos={meta?.logos}
          />
        </span>
      )}
      <span className="w-20 flex justify-end">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${statusBadgeClass(item.status)}`}>
          {StatusIcon && <StatusIcon className="w-3 h-3" />}
          {normalized.replace(/_/g, ' ')}
        </span>
      </span>
      <span className="w-20 flex justify-center">
        <PublishSwitch
          active={normalized === 'active'}
          disabled={!canToggleStatus}
          updating={isStatusUpdating}
          onToggle={(next) => onToggleLoomiStatus?.(item, next)}
        />
      </span>
      <span className="w-36 text-right tabular-nums leading-tight">
        {scheduledParts ? (
          <>
            <span className="block text-xs text-[var(--muted-foreground)]">{scheduledParts.date}</span>
            <span className="block text-[10px] text-[var(--muted-foreground)]">{scheduledParts.time}</span>
          </>
        ) : (
          <span className="block text-xs text-[var(--muted-foreground)]">—</span>
        )}
      </span>
      <span className="w-36 text-right tabular-nums leading-tight">
        {updatedParts ? (
          <>
            <span className="block text-xs text-[var(--muted-foreground)]">{updatedParts.date}</span>
            <span className="block text-[10px] text-[var(--muted-foreground)]">{updatedParts.time}</span>
          </>
        ) : (
          <span className="block text-xs text-[var(--muted-foreground)]">—</span>
        )}
      </span>
      <span className="w-14 flex justify-end">
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => onToggleMenu(item)}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors"
            aria-label="More actions"
          >
            <EllipsisHorizontalIcon className="w-4 h-4" />
          </button>

          {isMenuOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 w-40 glass-dropdown shadow-lg p-1.5">
              <button
                type="button"
                disabled
                className="w-full flex items-center justify-between px-2.5 py-2 text-xs rounded-lg text-[var(--muted-foreground)] opacity-50 cursor-not-allowed"
              >
                No actions
              </button>
            </div>
          )}
        </div>
      </span>
    </div>
  );
}

// ── Group Header ──

function GroupHeader({
  groupKey,
  label,
  isOpen,
  workflowCount,
  activeCount,
  storefrontImage,
  onToggle,
}: {
  groupKey: string;
  label: string;
  isOpen: boolean;
  workflowCount: number;
  activeCount: number;
  storefrontImage?: string;
  onToggle: () => void;
}) {
  const avatar = (
    <SharedAccountAvatar
      name={label}
      accountKey={groupKey}
      storefrontImage={storefrontImage}
      size={24}
      className="w-6 h-6 rounded-md object-cover flex-shrink-0 border border-[var(--border)]"
    />
  );

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 hover:opacity-80 transition-opacity text-left flex-1 min-w-0"
      >
        <ChevronRightIcon
          className="chevron-icon w-3.5 h-3.5 text-[var(--muted-foreground)] flex-shrink-0"
          data-open={isOpen}
        />
        {avatar}
        <span className="text-sm font-semibold text-[var(--foreground)] truncate">
          {label}
        </span>
        <span className="text-[10px] tabular-nums text-[var(--muted-foreground)] flex-shrink-0">
          {workflowCount} flow{workflowCount !== 1 ? 's' : ''}
        </span>
        {activeCount > 0 && (
          <span className="text-[10px] tabular-nums text-green-400 flex-shrink-0">
            {activeCount} active
          </span>
        )}
      </button>
    </div>
  );
}

// ── Component ──

type ViewMode = 'card' | 'table';

export function FlowList({
  workflows,
  loading,
  accountNames,
  accountMeta,
  // accountProviders accepted for backwards-compat with old call sites
  // until Phase D.9 drops it from the surface entirely.
  accountProviders: _accountProviders,
  onToggleLoomiStatus,
  updatingStatusFlowIds = [],
  emptyState,
}: FlowListProps) {
  void _accountProviders;
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [viewMode, setViewMode] = useState<ViewMode>('card');

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  // Apply text search
  const searchedWorkflows = useMemo(() => {
    if (!debouncedSearch) return workflows;
    const q = debouncedSearch.toLowerCase();
    return workflows.filter(w =>
      w.name.toLowerCase().includes(q) ||
      w.status.toLowerCase().includes(q) ||
      (w.dealer || '').toLowerCase().includes(q)
    );
  }, [workflows, debouncedSearch]);

  // Apply sorting
  const filteredWorkflows = useMemo(() => {
    if (!sortField) return searchedWorkflows;
    return [...searchedWorkflows].sort((a, b) => compareWorkflows(a, b, sortField, sortDir));
  }, [searchedWorkflows, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredWorkflows.length / PAGE_SIZE));

  const pagedWorkflows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredWorkflows.slice(start, start + PAGE_SIZE);
  }, [filteredWorkflows, page]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, workflows.length]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // Group into account sections (use ALL filtered workflows, not paged)
  const groups = useMemo(
    () => groupByAccount(filteredWorkflows, accountNames),
    [filteredWorkflows, accountNames],
  );

  const hasMultipleAccounts = groups.length > 1;

  function toggleGroup(key: string) {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function collapseAll() {
    const next: Record<string, boolean> = {};
    groups.forEach(g => { next[g.key] = true; });
    setCollapsed(next);
  }

  function expandAll() {
    setCollapsed({});
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      if (sortDir === 'desc') setSortDir('asc');
      else { setSortField(null); setSortDir('desc'); }
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  const allCollapsed = groups.length > 0 && groups.every(g => collapsed[g.key]);

  if (loading) {
    return (
      <div className="glass-card rounded-xl p-6 animate-pulse">
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
    <div className="glass-card rounded-xl overflow-hidden animate-fade-in-up animate-stagger-3">
      {/* Header + Search */}
      <div className="flex items-center justify-between gap-4 px-4 pt-4 pb-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
          <FlowIcon className="w-3.5 h-3.5" />
          Flows
          <span className="ml-1 tabular-nums opacity-60">
            {filteredWorkflows.length !== workflows.length
              ? `${filteredWorkflows.length} / ${workflows.length}`
              : workflows.length}
          </span>
          {!hasMultipleAccounts && totalPages > 1 && (
            <span className="ml-1 opacity-60">
              · Page {page} of {totalPages}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('card')}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                viewMode === 'card'
                  ? 'bg-[var(--primary)] text-white'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
              title="Card view"
            >
              <Squares2X2Icon className="w-3.5 h-3.5" />
              Cards
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                viewMode === 'table'
                  ? 'bg-[var(--primary)] text-white'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
              title="Table view"
            >
              <TableCellsIcon className="w-3.5 h-3.5" />
              Table
            </button>
          </div>

          {/* Collapse / Expand toggle */}
          {hasMultipleAccounts && viewMode === 'table' && (
            <button
              onClick={allCollapsed ? expandAll : collapseAll}
              className="text-[10px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors px-1.5 py-1"
            >
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          )}

          <div className="relative">
            <MagnifyingGlassIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search flows..."
              className="w-44 pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
          </div>

        </div>
      </div>

      {/* List */}
      <div className="px-4 pb-4">
        {filteredWorkflows.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-[var(--muted-foreground)]">
              {debouncedSearch
                ? 'No flows match your search'
                : (emptyState?.title || 'No flows found')}
            </p>
            {!debouncedSearch && emptyState?.subtitle && (
              <p className="text-xs text-[var(--muted-foreground)] mt-1">
                {emptyState.subtitle}
              </p>
            )}
            {!debouncedSearch && emptyState?.actionHref && emptyState?.actionLabel && (
              <a
                href={emptyState.actionHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--primary)] bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 transition-colors"
              >
                {emptyState.actionLabel}
                <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        ) : viewMode === 'card' ? (
          /* ── Card view ── */
          hasMultipleAccounts ? (
            <div className="space-y-4 mt-1">
              {groups.map((group) => {
                const isOpen = !collapsed[group.key];
                const activeCount = group.workflows.filter(
                  w => normalizeStatus(w.status) === 'active'
                ).length;

                return (
                  <div key={group.key}>
                    <GroupHeader
                      groupKey={group.key}
                      label={group.label}
                      isOpen={isOpen}
                      workflowCount={group.workflows.length}
                      activeCount={activeCount}
                      storefrontImage={accountMeta?.[group.key]?.storefrontImage}
                      onToggle={() => toggleGroup(group.key)}
                    />

                    <div className="collapsible-wrapper" data-open={isOpen}>
                      <div className="collapsible-inner">
                        <div className="ml-5.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
                          {group.workflows.map((item) => (
                            <FlowCard
                              key={getWorkflowKey(item)}
                              workflow={item}
                              accountMeta={accountMeta?.[item.accountKey || '']}
                              accountName={item.accountKey ? accountNames?.[item.accountKey] : undefined}
                              showAccount={false}
                              isMenuOpen={openMenuId === getWorkflowKey(item)}
                              isStatusUpdating={updatingStatusFlowIds.includes(item.id)}
                              onToggleMenu={(workflow) => {
                                const key = getWorkflowKey(workflow);
                                setOpenMenuId((prev) => (prev === key ? null : key));
                              }}
                              onToggleLoomiStatus={onToggleLoomiStatus}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-1">
              {pagedWorkflows.map((item) => (
                <FlowCard
                  key={getWorkflowKey(item)}
                  workflow={item}
                  accountMeta={accountMeta?.[item.accountKey || '']}
                  accountName={item.accountKey ? accountNames?.[item.accountKey] : undefined}
                  showAccount={true}
                  isMenuOpen={openMenuId === getWorkflowKey(item)}
                  isStatusUpdating={updatingStatusFlowIds.includes(item.id)}
                  onToggleMenu={(workflow) => {
                    const key = getWorkflowKey(workflow);
                    setOpenMenuId((prev) => (prev === key ? null : key));
                  }}
                  onToggleLoomiStatus={onToggleLoomiStatus}
                />
              ))}
            </div>
          )
        ) : hasMultipleAccounts ? (
          /* ── Grouped table view ── */
          <div className="space-y-1 mt-1">
            {groups.map((group) => {
              const isOpen = !collapsed[group.key];
              const activeCount = group.workflows.filter(
                w => normalizeStatus(w.status) === 'active'
              ).length;

              return (
                <div key={group.key}>
                  {/* Group header */}
                  <GroupHeader
                    groupKey={group.key}
                    label={group.label}
                    isOpen={isOpen}
                    workflowCount={group.workflows.length}
                    activeCount={activeCount}
                    storefrontImage={accountMeta?.[group.key]?.storefrontImage}
                    onToggle={() => toggleGroup(group.key)}
                  />

                  {/* Collapsible content */}
                  <div className="collapsible-wrapper" data-open={isOpen}>
                    <div className="collapsible-inner">
                      {/* Column header */}
                      <div className="flex items-center gap-3 px-3 py-1 ml-5.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                        <span className="flex-1">Name</span>
                        <span className="w-20 text-right">
                          <SortHeader label="STATUS" field="status" activeField={sortField} activeDir={sortDir} onToggle={toggleSort} />
                        </span>
                        <span className="w-20 text-center">Publish</span>
                        <span className="w-36 text-right">
                          <SortHeader label="SCHEDULED" field="scheduled" activeField={sortField} activeDir={sortDir} onToggle={toggleSort} />
                        </span>
                        <span className="w-36 text-right">
                          <SortHeader label="LAST UPDATED" field="updated" activeField={sortField} activeDir={sortDir} onToggle={toggleSort} />
                        </span>
                        <span className="w-14 text-right" />
                      </div>
                      <div className="ml-5.5 divide-y divide-[var(--border)]">
                        {group.workflows.map((item) => (
                          <WorkflowRow
                            key={getWorkflowKey(item)}
                            item={item}
                            accountNames={accountNames}
                            accountMeta={accountMeta}
                            showAccount={false}
                            isMenuOpen={openMenuId === getWorkflowKey(item)}
                            isStatusUpdating={updatingStatusFlowIds.includes(item.id)}
                            onToggleMenu={(workflow) => {
                              const key = getWorkflowKey(workflow);
                              setOpenMenuId((prev) => (prev === key ? null : key));
                            }}
                            onToggleLoomiStatus={onToggleLoomiStatus}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ── Flat table view (single account or no grouping needed) ── */
          <div className="mt-1">
            <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              <span className="flex-1">Name</span>
              <span className="w-36">Sub-Account</span>
              <span className="w-20 text-right">
                <SortHeader label="STATUS" field="status" activeField={sortField} activeDir={sortDir} onToggle={toggleSort} />
              </span>
              <span className="w-20 text-center">Publish</span>
              <span className="w-36 text-right">
                <SortHeader label="SCHEDULED" field="scheduled" activeField={sortField} activeDir={sortDir} onToggle={toggleSort} />
              </span>
              <span className="w-36 text-right">
                <SortHeader label="LAST UPDATED" field="updated" activeField={sortField} activeDir={sortDir} onToggle={toggleSort} />
              </span>
              <span className="w-14 text-right" />
            </div>
            <div className="divide-y divide-[var(--border)]">
              {pagedWorkflows.map((item) => (
                <WorkflowRow
                  key={getWorkflowKey(item)}
                  item={item}
                  accountNames={accountNames}
                  accountMeta={accountMeta}
                  showAccount={true}
                  isMenuOpen={openMenuId === getWorkflowKey(item)}
                  isStatusUpdating={updatingStatusFlowIds.includes(item.id)}
                  onToggleMenu={(workflow) => {
                    const key = getWorkflowKey(workflow);
                    setOpenMenuId((prev) => (prev === key ? null : key));
                  }}
                  onToggleLoomiStatus={onToggleLoomiStatus}
                />
              ))}
            </div>
          </div>
        )}

        {/* Pagination (flat view only — grouped view shows all) */}
        {!hasMultipleAccounts && totalPages > 1 && (
          <div className="mt-4 pt-3 border-t border-[var(--border)] flex items-center justify-between">
            <p className="text-[11px] text-[var(--muted-foreground)]">
              Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filteredWorkflows.length)} of {filteredWorkflows.length}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
