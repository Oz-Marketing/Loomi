'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import { AdminOnly } from '@/components/route-guard';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import {
  FlowsTable,
  type FlowsTableRow,
  type BulkActionContext,
} from '@/components/flows/flows-table';
import { FlowCard, type FlowCardWorkflow } from '@/components/flows/flow-card';
import { CloneFlowModal } from '@/components/flows/clone-flow-modal';
import { PickTemplateModal } from '@/components/flows/pick-template-modal';
import { useListView } from '@/components/view-switcher';
import { ListToolbar } from '@/components/list-toolbar';
import type { StatusFilterValue } from '@/components/status-filter';
import type { BulkActionDockItem } from '@/components/bulk-action-dock';
import {
  PlusIcon,
  PlayIcon,
  PauseIcon,
  ArchiveBoxIcon,
  ArrowUturnLeftIcon,
  TrashIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';
import { FlowIcon } from '@/components/icon-map';
import { ViewAnalyticsLink } from '@/components/view-analytics-link';

// Loomi-native flows live behind `/api/flows`. Page mirrors the
// Contacts page chrome: a single sticky header with title + primary
// CTA, then the contacts-style FlowsTable renders directly below.

interface FlowApiRow {
  id: string;
  name: string;
  description: string;
  status: string;
  accountKey: string;
  parentTemplateId: string;
  lastSyncedAt: string;
  publishedAt: string;
  archivedAt: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  activeEnrollments: number;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

// Map the API shape onto the row shape FlowsTable speaks.
function flowsToRows(
  flows: FlowApiRow[],
  accountNames: Record<string, string>,
): FlowsTableRow[] {
  return flows.map((f) => ({
    id: f.id,
    name: f.name,
    status: f.status,
    source: 'loomi',
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    accountKey: f.accountKey || undefined,
    dealer: f.accountKey ? accountNames[f.accountKey] : undefined,
    parentTemplateId: f.parentTemplateId || undefined,
    activeEnrollments: f.activeEnrollments ?? 0,
  }));
}

function FlowsPageHeader({
  title,
  subtitle,
  cta,
}: {
  title: string;
  subtitle: string;
  // CTA rendered as a slot so admin (Create Flow) and sub-account
  // (Add Flow dropdown) can each provide their own affordance
  // without complicating this component with mode flags.
  cta: React.ReactNode;
}) {
  return (
    <div className="page-sticky-header mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <FlowIcon className="w-7 h-7 text-[var(--primary)]" />
          <div>
            <h2 className="text-2xl font-bold">{title}</h2>
            <p className="text-[var(--muted-foreground)] mt-1">{subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">{cta}</div>
      </div>
    </div>
  );
}

// Sub-account header CTA. "Add Flow" splits into a primary affordance
// (pick a published template) plus a secondary "Create from scratch"
// option. Templates are the discovery path; scratch is the escape
// hatch.
function AddTemplateButton({
  creating,
  onPickFromTemplate,
  onCreateFromScratch,
}: {
  creating: boolean;
  onPickFromTemplate: () => void;
  onCreateFromScratch: () => void;
}) {
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

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={creating}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-60"
      >
        <PlusIcon className="w-4 h-4" />
        {creating ? 'Creating…' : 'Add Flow'}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-30 w-56 glass-dropdown shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onPickFromTemplate();
            }}
            className="w-full flex items-start gap-2 px-3 py-2 text-left rounded-md hover:bg-[var(--muted)] transition-colors"
          >
            <Squares2X2Icon className="w-4 h-4 text-violet-300 mt-0.5 flex-shrink-0" />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-[var(--foreground)]">
                Pick from templates
              </span>
              <span className="block text-[10px] text-[var(--muted-foreground)] leading-snug mt-0.5">
                Adopt a published template into this account.
              </span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onCreateFromScratch();
            }}
            className="w-full flex items-start gap-2 px-3 py-2 text-left rounded-md hover:bg-[var(--muted)] transition-colors"
          >
            <PlusIcon className="w-4 h-4 text-[var(--muted-foreground)] mt-0.5 flex-shrink-0" />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-[var(--foreground)]">
                Create from scratch
              </span>
              <span className="block text-[10px] text-[var(--muted-foreground)] leading-snug mt-0.5">
                Start a new empty flow.
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function FlowsPageBody({
  scopeKey,
  subtitle,
  presetAccountKey,
  hideInstances = false,
}: {
  scopeKey: string;
  subtitle: string;
  presetAccountKey: string | null;
  /** When true, drop rows that are deployed instances of a template
   *  (those have parentTemplateId set). The instances are still visible
   *  via the Adoption column on their parent template's row + via a
   *  hidden-count hint below the search. Admin view sets this; the
   *  per-account view shows everything. */
  hideInstances?: boolean;
}) {
  const router = useRouter();
  const { accounts } = useAccount();
  const { confirm, prompt } = useLoomiDialog();
  const subHref = useSubaccountHref();
  const [creating, setCreating] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<string[]>([]);
  // Single-target clone modal — surfaced from the row's 3-dot menu.
  // Tracks the source flow so we know what to /duplicate against.
  const [cloneTarget, setCloneTarget] = useState<FlowsTableRow | null>(null);
  // Sub-account picker modal — opens from the "Add Template" CTA on
  // the sub-account view. Lists published templates the user can
  // adopt into their own account.
  const [pickTemplateOpen, setPickTemplateOpen] = useState(false);
  // Status filter — drives the API fetch + the StatusFilter dropdown
  // in the FlowsTable toolbar. Default is 'all' (live items only, no
  // archived). Selecting 'archived' lets the user recover something
  // before the 30-day purge job sweeps it.
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');
  // Cards / Table toggle — sticky in localStorage. Defaults to 'table'
  // since flows has always been table-first; the card grid is the new
  // alternative.
  const [view, setView] = useListView('loomi.flows.view', 'table');
  // Per-card 3-dot menu state — one open at a time. FlowCard expects
  // the parent to track this so the menus can't stack.
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  // Search string — lifted to the page so the unified ListToolbar can
  // drive both the cards grid and the FlowsTable from the same value.
  const [search, setSearch] = useState('');

  const queryParams = new URLSearchParams();
  if (presetAccountKey) queryParams.set('accountKey', presetAccountKey);
  queryParams.set('status', statusFilter);
  const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
  const { data, error, mutate, isLoading } = useSWR<{ flows: FlowApiRow[] }>(
    `/api/flows${query}`,
    fetcher,
  );

  const accountNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [key, account] of Object.entries(accounts)) {
      map[key] = account.dealer;
    }
    return map;
  }, [accounts]);

  const accountMeta = useMemo(() => {
    const map: Record<
      string,
      {
        dealer: string;
        logos?: { light?: string; dark?: string; white?: string; black?: string };
        storefrontImage?: string;
        city?: string;
        state?: string;
        category?: string;
      }
    > = {};
    for (const [key, account] of Object.entries(accounts)) {
      map[key] = {
        dealer: account.dealer,
        logos: account.logos,
        city: account.city,
        state: account.state,
        category: account.category,
      };
    }
    return map;
  }, [accounts]);

  const allRows = useMemo(
    () => flowsToRows(data?.flows ?? [], accountNames),
    [data, accountNames],
  );

  // Visible rows = everything when hideInstances=false; otherwise drop
  // deployed instances. The hidden ones still ride along on the
  // template row's Adoption column so the admin doesn't lose access.
  const rows = useMemo(
    () => (hideInstances ? allRows.filter((r) => !r.parentTemplateId) : allRows),
    [allRows, hideInstances],
  );

  // Adoption map computed over the FULL list so the table can render
  // sub-account avatars on a template row even when those instances
  // are filtered out of the visible row set.
  const adoptionMap = useMemo(() => {
    const map = new Map<string, FlowsTableRow[]>();
    for (const r of allRows) {
      if (!r.parentTemplateId) continue;
      const arr = map.get(r.parentTemplateId) ?? [];
      arr.push(r);
      map.set(r.parentTemplateId, arr);
    }
    return map;
  }, [allRows]);

  const hiddenInstanceCount = hideInstances
    ? allRows.length - rows.length
    : 0;

  // Page-level search filter — applied to both the cards grid and the
  // FlowsTable so the unified toolbar drives both surfaces. Lower-cases
  // and matches against name + dealer + status, same haystack the
  // FlowsTable used internally before we lifted state up.
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.name} ${r.dealer ?? ''} ${r.status}`.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Untitled flow',
          accountKey: presetAccountKey ?? undefined,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to create flow');
        return;
      }
      const payload = await res.json();
      // Brand-new "Untitled flow" has nothing useful to show on the
      // overview — jump straight to the editor so the user can start
      // building. Sub-account-aware so the URL stays inside the
      // current scope.
      router.push(subHref(`/flows/${payload.flow.id}/edit`));
    } finally {
      setCreating(false);
    }
  };

  // FlowsTable speaks "active|inactive"; our model is
  // draft|active|paused|archived. We treat "inactive" as pause.
  const handleToggleStatus = async (
    flow: FlowsTableRow,
    nextStatus: 'active' | 'inactive',
  ) => {
    const endpoint =
      nextStatus === 'active'
        ? `/api/flows/${flow.id}/publish`
        : `/api/flows/${flow.id}/pause`;

    setUpdatingIds((ids) => [...ids, flow.id]);
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        if (payload.details && Array.isArray(payload.details)) {
          toast.error(`Cannot publish: ${payload.details.join('; ')}`);
        } else {
          toast.error(payload.error || 'Status update failed');
        }
        return;
      }
      toast.success(
        nextStatus === 'active' ? 'Flow published' : 'Flow paused',
      );
      await mutate();
    } finally {
      setUpdatingIds((ids) => ids.filter((id) => id !== flow.id));
    }
  };

  // ── Row-level action handlers (3-dot menu) ──
  const handleRowEdit = (flow: FlowsTableRow) => {
    router.push(subHref(`/flows/${flow.id}/edit`));
  };

  const handleRowRename = async (flow: FlowsTableRow) => {
    const nextName = await prompt({
      title: 'Rename flow',
      message: 'Pick a new name for this flow.',
      defaultValue: flow.name || '',
      confirmLabel: 'Rename',
      required: true,
    });
    if (nextName === null) return;
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === flow.name) return;
    const res = await fetch(`/api/flows/${flow.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.error || 'Rename failed');
      return;
    }
    toast.success('Flow renamed.');
    await mutate();
  };

  const handleRowClone = (flow: FlowsTableRow) => {
    setCloneTarget(flow);
  };

  const handleRowArchive = async (flow: FlowsTableRow) => {
    const ok = await confirm({
      title: 'Archive flow?',
      message: `"${flow.name || 'Untitled flow'}" will be hidden from this list. You can still find it via direct link. Active enrollments stop on the next tick.`,
      confirmLabel: 'Archive',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/flows/${flow.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.error || 'Archive failed');
      return;
    }
    toast.success('Flow archived.');
    await mutate();
  };

  const handleRowRestore = async (flow: FlowsTableRow) => {
    const res = await fetch(`/api/flows/${flow.id}/restore`, { method: 'POST' });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.error || 'Restore failed');
      return;
    }
    toast.success('Flow restored.');
    await mutate();
  };

  const handleRowDelete = async (flow: FlowsTableRow) => {
    const ok = await confirm({
      title: 'Delete flow permanently?',
      message: `"${flow.name || 'Untitled flow'}" and all its steps, enrollments, and step history will be permanently removed. This cannot be undone.`,
      confirmLabel: 'Delete forever',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/flows/${flow.id}?purge=true`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.error || 'Delete failed');
      return;
    }
    toast.success('Flow deleted.');
    await mutate();
  };

  // ── Bulk-action runner ──
  // Runs the same per-flow endpoint over a selection, sequentially.
  // We don't expose a true bulk endpoint yet, so this fans out
  // individual POST/DELETE calls and aggregates the results into one
  // toast at the end. Failures don't short-circuit — we report
  // succeeded/failed counts so the user can re-try the failures.
  const runBulk = async (
    label: 'publish' | 'pause' | 'archive' | 'restore' | 'delete',
    ids: string[],
    fetchFor: (id: string) => Promise<Response>,
    clearSelection: () => void,
  ) => {
    let succeeded = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        const res = await fetchFor(id);
        if (res.ok) succeeded += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    if (failed === 0) {
      toast.success(`${succeeded} ${succeeded === 1 ? 'flow' : 'flows'} ${label}d`);
    } else if (succeeded === 0) {
      toast.error(`Failed to ${label} ${failed} ${failed === 1 ? 'flow' : 'flows'}`);
    } else {
      toast.error(`${succeeded} ${label}d, ${failed} failed`);
    }
    await mutate();
    clearSelection();
  };

  // Admin view = templates + standalone flows. Publishing/pausing
  // templates makes no sense (they deploy to instances; instances are
  // what get published), and Archive is gated to per-row only for
  // template management. So admin's bulk dock is reduced to the two
  // recovery ops: Restore (only when viewing archived) and a confirmed
  // hard Delete.
  const isAdminView = presetAccountKey === null;

  const buildBulkActions = (ctx: BulkActionContext): BulkActionDockItem[] => {
    // Restore — only meaningful on archived rows.
    const restoreItem: BulkActionDockItem = {
      id: 'restore',
      label: 'Restore',
      icon: <ArrowUturnLeftIcon className="w-3.5 h-3.5" />,
      onClick: () =>
        void runBulk('restore', ctx.selectedIds, (id) =>
          fetch(`/api/flows/${id}/restore`, { method: 'POST' }),
          ctx.clearSelection,
        ),
    };

    // Hard delete — confirmed so a misclick can't wipe a batch.
    // Available in admin (always) + any view when filter='archived'
    // (since archive is a soft state and the natural follow-up is
    // either restore or permanent removal).
    const deleteItem: BulkActionDockItem = {
      id: 'delete',
      label: 'Delete',
      danger: true,
      icon: <TrashIcon className="w-3.5 h-3.5" />,
      onClick: async () => {
        const count = ctx.selectedIds.length;
        const ok = await confirm({
          title:
            count === 1
              ? 'Delete flow permanently?'
              : `Delete ${count} flows permanently?`,
          message:
            count === 1
              ? 'This flow and all its steps, triggers, and enrollment history will be permanently removed. This cannot be undone.'
              : `These ${count} flows and all their steps, triggers, and enrollment history will be permanently removed. This cannot be undone.`,
          confirmLabel: 'Delete forever',
          destructive: true,
        });
        if (!ok) return;
        void runBulk('delete', ctx.selectedIds, (id) =>
          fetch(`/api/flows/${id}?purge=true`, { method: 'DELETE' }),
          ctx.clearSelection,
        );
      },
    };

    // When the user is viewing archived rows the only sensible bulk
    // ops are Restore (un-archive) and Delete (purge). The
    // publish/pause/archive triad doesn't apply to archived rows, so
    // it's suppressed regardless of admin vs sub-account.
    if (statusFilter === 'archived') {
      return [restoreItem, deleteItem];
    }

    if (isAdminView) {
      // Admin live-view dock: just Delete. Publish/pause/archive are
      // managed per-row from the overview, not in bulk.
      return [deleteItem];
    }

    // Sub-account live-view: status appliers + Archive.
    return [
      {
        id: 'publish',
        label: 'Publish',
        icon: <PlayIcon className="w-3.5 h-3.5" />,
        onClick: () =>
          void runBulk('publish', ctx.selectedIds, (id) =>
            fetch(`/api/flows/${id}/publish`, { method: 'POST' }),
            ctx.clearSelection,
          ),
      },
      {
        id: 'pause',
        label: 'Pause',
        icon: <PauseIcon className="w-3.5 h-3.5" />,
        onClick: () =>
          void runBulk('pause', ctx.selectedIds, (id) =>
            fetch(`/api/flows/${id}/pause`, { method: 'POST' }),
            ctx.clearSelection,
          ),
      },
      {
        id: 'archive',
        label: 'Archive',
        danger: true,
        icon: <ArchiveBoxIcon className="w-3.5 h-3.5" />,
        onClick: () =>
          void runBulk('archive', ctx.selectedIds, (id) =>
            fetch(`/api/flows/${id}`, { method: 'DELETE' }),
            ctx.clearSelection,
          ),
      },
    ];
  };

  const emptyState = {
    title: 'No flows yet',
    subtitle: 'Create a flow to start sending automated email drips.',
  };

  if (error) {
    return (
      <div className="text-center py-16 text-[var(--muted-foreground)]">
        <p>Failed to load flows: {error.message}</p>
      </div>
    );
  }

  return (
    <div key={scopeKey}>
      <FlowsPageHeader
        title="Flows"
        subtitle={subtitle}
        cta={
          <>
            <ViewAnalyticsLink area="engagement" />
            {presetAccountKey ? (
              <AddTemplateButton
                creating={creating}
                onPickFromTemplate={() => setPickTemplateOpen(true)}
                onCreateFromScratch={handleCreate}
              />
            ) : (
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-60"
              >
                <PlusIcon className="w-4 h-4" />
                {creating ? 'Creating…' : 'Create Flow'}
              </button>
            )}
          </>
        }
      />

      {hiddenInstanceCount > 0 && (
        <p className="text-[11px] text-[var(--muted-foreground)] mb-2 px-1">
          Showing templates + standalone flows. {hiddenInstanceCount} deployed{' '}
          {hiddenInstanceCount === 1 ? 'instance is' : 'instances are'} rolled up under{' '}
          {hiddenInstanceCount === 1 ? 'its' : 'their'} template — click the adoption
          avatars to open one.
        </p>
      )}

      {/* Unified toolbar — hide when there's nothing to view yet, to
          avoid showing a search/filter row above an empty-state card. */}
      {rows.length > 0 && (
        <ListToolbar
          view={view}
          onViewChange={setView}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search flows..."
          status={statusFilter}
          onStatusChange={setStatusFilter}
        />
      )}

      {view === 'table' ? (
        <FlowsTable
          workflows={visibleRows}
          loading={isLoading}
          accountMeta={accountMeta}
          showAccountColumn={presetAccountKey === null}
          onToggleStatus={handleToggleStatus}
          updatingStatusFlowIds={updatingIds}
          emptyState={emptyState}
          bulkActions={buildBulkActions}
          adoption={adoptionMap}
          onRowEdit={handleRowEdit}
          onRowRename={handleRowRename}
          onRowClone={handleRowClone}
          // Admin row menu has no Archive — templates aren't part of the
          // publish/pause/archive lifecycle. Sub-account view keeps it
          // since instances there are real publishable flows.
          onRowArchive={isAdminView ? undefined : handleRowArchive}
          onRowRestore={handleRowRestore}
          onRowDelete={handleRowDelete}
          // Toolbar lives at the page level now; the table just renders the grid.
          hideToolbar
          // Keep the props plumbed so the prefilter logic still works
          // (FlowsTable internally re-filters by search) — passing the
          // same controlled value is a no-op here but keeps the source
          // of truth in one place if we ever drop the page-level filter.
          search={search}
          onSearchChange={setSearch}
        />
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="glass-card rounded-xl h-44 animate-pulse bg-[var(--muted)]/30"
            />
          ))}
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="glass-card rounded-2xl px-6 py-14 text-center">
          <h3 className="text-lg font-semibold">{emptyState.title}</h3>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {emptyState.subtitle}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleRows.map((flow) => {
            const workflow: FlowCardWorkflow = {
              id: flow.id,
              name: flow.name,
              status: flow.status,
              source: flow.source ?? 'loomi',
              accountKey: flow.accountKey,
              dealer: flow.dealer,
              createdAt: flow.createdAt,
              updatedAt: flow.updatedAt,
            };
            const meta = flow.accountKey ? accountMeta[flow.accountKey] : undefined;
            return (
              <FlowCard
                key={flow.id}
                workflow={workflow}
                accountMeta={meta}
                accountName={
                  flow.accountKey ? (accountNames[flow.accountKey] ?? null) : null
                }
                showAccount={presetAccountKey === null && !!flow.accountKey}
                isMenuOpen={menuOpenId === flow.id}
                isStatusUpdating={updatingIds.includes(flow.id)}
                onToggleMenu={(w) =>
                  setMenuOpenId((cur) => (cur === w.id ? null : w.id))
                }
                onToggleLoomiStatus={(_w, next) =>
                  // FlowCardWorkflow doesn't carry every FlowsTableRow
                  // field — re-hydrate from the row we already have
                  // for each handler below too.
                  void handleToggleStatus(flow, next)
                }
                hrefBuilder={(w) => subHref(`/flows/${w.id}`)}
                onEdit={() => handleRowEdit(flow)}
                onRename={() => void handleRowRename(flow)}
                onClone={() => handleRowClone(flow)}
                // Match the table: admin view hides Archive (templates
                // aren't part of the publish lifecycle). Restore only
                // makes sense on already-archived rows.
                onArchive={
                  !isAdminView && flow.status !== 'archived'
                    ? () => void handleRowArchive(flow)
                    : undefined
                }
                onRestore={
                  flow.status === 'archived'
                    ? () => void handleRowRestore(flow)
                    : undefined
                }
                onDelete={() => void handleRowDelete(flow)}
              />
            );
          })}
        </div>
      )}

      {presetAccountKey && (
        <PickTemplateModal
          open={pickTemplateOpen}
          targetAccountKey={presetAccountKey}
          onClose={() => setPickTemplateOpen(false)}
          onAdopted={(newId) => {
            if (newId) router.push(subHref(`/flows/${newId}`));
            else void mutate();
          }}
        />
      )}

      {cloneTarget && (
        <CloneFlowModal
          open={!!cloneTarget}
          flowId={cloneTarget.id}
          flowName={cloneTarget.name || 'Untitled flow'}
          // For templates, hide accounts that already have an
          // instance — same constraint as the multi-target deploy
          // flow. For non-templates we don't have this info on the
          // row, so the picker shows all accounts.
          excludeAccountKeys={
            !cloneTarget.accountKey
              ? (adoptionMap.get(cloneTarget.id) ?? [])
                  .map((r) => r.accountKey)
                  .filter((k): k is string => !!k)
              : []
          }
          onClose={() => setCloneTarget(null)}
          onCloned={() => {
            void mutate();
          }}
        />
      )}
    </div>
  );
}

function AdminFlowsPage() {
  return (
    <FlowsPageBody
      scopeKey="admin"
      subtitle="Templates + standalone flows across all accounts"
      presetAccountKey={null}
      hideInstances
    />
  );
}

function AccountFlowsPage() {
  const { accountKey, accountData } = useAccount();
  const dealerName = accountData?.dealer || 'Your Sub-Account';

  return (
    <FlowsPageBody
      scopeKey={accountKey ?? 'no-account'}
      subtitle={`Email drip series for ${dealerName}`}
      presetAccountKey={accountKey}
    />
  );
}

export default function FlowsPage() {
  const { isAdmin, isAccount } = useAccount();

  if (isAdmin) {
    return (
      <AdminOnly>
        <AdminFlowsPage />
      </AdminOnly>
    );
  }

  if (isAccount) {
    return <AccountFlowsPage />;
  }

  return null;
}
