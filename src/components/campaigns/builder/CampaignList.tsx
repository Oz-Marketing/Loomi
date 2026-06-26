'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  SparklesIcon,
  PencilSquareIcon,
  MegaphoneIcon,
  TrashIcon,
  ArchiveBoxIcon,
  ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { toast } from '@/lib/toast';
import { ListToolbar } from '@/components/list-toolbar';
import { useListView } from '@/components/view-switcher';
import type { StatusFilterValue } from '@/components/status-filter';
import BulkActionDock, { type BulkActionDockItem } from '@/components/bulk-action-dock';
import { CampaignStatusBadge, CHANNEL_META } from './shared';
import type { CampaignAssetKind, CampaignSummary } from '@/lib/campaigns/types';

const COUNT_ORDER: CampaignAssetKind[] = ['email', 'sms', 'landingPage', 'form', 'flow'];
const STATUS_OPTIONS = [
  { value: 'all' as const, label: 'Active' },
  { value: 'archived' as const, label: 'Archived' },
];

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** Asset-count chips for a campaign (shared by cards + table). */
function ChannelChips({ campaign }: { campaign: CampaignSummary }) {
  const kinds = COUNT_ORDER.filter((k) => campaign.assetCounts[k] > 0);
  if (kinds.length === 0) {
    return <span className="text-[11px] text-[var(--muted-foreground)]">No assets yet</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {kinds.map((k) => {
        const meta = CHANNEL_META[k];
        return (
          <span
            key={k}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.tone}`}
          >
            <meta.Icon className="h-3 w-3" />
            {campaign.assetCounts[k]}
          </span>
        );
      })}
    </div>
  );
}

export function CampaignList() {
  const href = useSubaccountHref();
  const router = useRouter();
  const { confirm } = useLoomiDialog();
  const [view, setView] = useListView('loomi.campaigns.view', 'cards');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  // 'archived' needs the include-archived API response, then we keep only the
  // archived rows; 'all' shows the live (non-archived) working set.
  const swrKey = statusFilter === 'archived' ? '/api/campaigns?archived=1' : '/api/campaigns';
  const { data, error, isLoading, mutate } = useSWR<{ campaigns?: CampaignSummary[]; error?: string }>(
    swrKey,
    fetcher,
  );

  const campaigns: CampaignSummary[] = useMemo(
    () => (Array.isArray(data?.campaigns) ? data!.campaigns! : []),
    [data],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return campaigns
      .filter((c) => (statusFilter === 'archived' ? c.status === 'archived' : c.status !== 'archived'))
      .filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [campaigns, search, statusFilter]);

  const clearSelection = () => setSelectedIds(new Set());

  // Drop selection when the filter/search changes so the dock never acts on
  // rows that aren't visible.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    clearSelection();
  }, [statusFilter, search]);

  const toggleRow = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const visibleIds = filtered.map((c) => c.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = visibleIds.some((id) => selectedIds.has(id));
  const toggleSelectAll = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });

  // ── Bulk runner: per-id fetch, aggregate toast, refresh + clear. ──
  const runBulk = async (
    pastTense: string,
    ids: string[],
    fn: (id: string) => Promise<Response>,
  ) => {
    setBusy(true);
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try {
        const res = await fn(id);
        if (res.ok) ok += 1;
        else fail += 1;
      } catch {
        fail += 1;
      }
    }
    if (ok) toast.success(`${ok} campaign${ok === 1 ? '' : 's'} ${pastTense}`);
    if (fail) toast.error(`${fail} campaign${fail === 1 ? '' : 's'} could not be ${pastTense}`);
    await mutate();
    clearSelection();
    setBusy(false);
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const okConfirm = await confirm({
      title: ids.length === 1 ? 'Delete this campaign?' : `Delete ${ids.length} campaigns?`,
      message:
        'This permanently deletes the campaign and every asset it generated (emails, texts, landing pages, forms) from their channel pages too. This can’t be undone.',
      confirmLabel: 'Delete forever',
      destructive: true,
    });
    if (!okConfirm) return;
    await runBulk('deleted', ids, (id) => fetch(`/api/campaigns/${id}`, { method: 'DELETE' }));
  };

  const patchArchive = (id: string, archive: boolean) =>
    fetch(`/api/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archive }),
    });

  const dockActions: BulkActionDockItem[] = useMemo(() => {
    const ids = Array.from(selectedIds);
    const actions: BulkActionDockItem[] = [];
    if (statusFilter === 'archived') {
      actions.push({
        id: 'restore',
        label: 'Restore',
        icon: <ArrowUturnLeftIcon className="h-3.5 w-3.5" />,
        disabled: busy,
        onClick: () => runBulk('restored', ids, (id) => patchArchive(id, false)),
      });
    } else {
      actions.push({
        id: 'archive',
        label: 'Archive',
        icon: <ArchiveBoxIcon className="h-3.5 w-3.5" />,
        disabled: busy,
        onClick: () => runBulk('archived', ids, (id) => patchArchive(id, true)),
      });
    }
    actions.push({
      id: 'delete',
      label: 'Delete',
      icon: <TrashIcon className="h-3.5 w-3.5" />,
      danger: true,
      disabled: busy,
      onClick: handleBulkDelete,
    });
    return actions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, statusFilter, busy]);

  const loadError = error ? 'Failed to load campaigns' : data?.error || null;

  return (
    <div className="animate-fade-in-up">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Multi-channel campaigns — email, SMS, and more — built together and reviewed as one.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={href('/campaign-builder/new/manual')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3.5 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]"
          >
            <PencilSquareIcon className="h-4 w-4" />
            Start manually
          </Link>
          <Link
            href={href('/campaign-builder/new')}
            className="iris-rainbow-gradient inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:opacity-90"
          >
            <SparklesIcon className="h-4 w-4" />
            New with AI
          </Link>
        </div>
      </header>

      <div className="mb-5">
        <ListToolbar
          view={view}
          onViewChange={setView}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search campaigns…"
          status={statusFilter}
          onStatusChange={setStatusFilter}
          statusOptions={STATUS_OPTIONS}
        />
      </div>

      {loadError && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {loadError}
        </div>
      )}

      {isLoading && !data && (
        <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">Loading…</div>
      )}

      {!isLoading && filtered.length === 0 && !loadError && (
        <EmptyState searchOrFilter={!!search.trim() || statusFilter === 'archived'} href={href} />
      )}

      {filtered.length > 0 && (
        <>
          {/* Select-all bar */}
          <label className="mb-3 inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected && !allSelected;
              }}
              onChange={toggleSelectAll}
              className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
            />
            {someSelected ? `${selectedIds.size} selected` : 'Select all'}
          </label>

          {view === 'cards' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((c) => {
                const selected = selectedIds.has(c.id);
                return (
                  <div key={c.id} className="relative">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleRow(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${c.name}`}
                      className="absolute left-3 top-3 z-10 h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                    />
                    <Link
                      href={href(`/campaign-builder/${c.id}`)}
                      className={`glass-card flex h-full flex-col gap-3 rounded-xl border p-5 pl-9 transition ${
                        selected
                          ? 'border-[var(--primary)]/50 bg-[var(--primary)]/5'
                          : 'border-transparent hover:border-[var(--primary)]/40'
                      }`}
                    >
                      <h3 className="line-clamp-2 text-sm font-semibold text-[var(--foreground)]">{c.name}</h3>
                      <div className="flex items-center gap-2">
                        <CampaignStatusBadge status={c.status} />
                        {c.source === 'ai' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--muted-foreground)]">
                            <SparklesIcon className="h-3 w-3" /> AI
                          </span>
                        )}
                      </div>
                      <div className="mt-auto">
                        <ChannelChips campaign={c} />
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--card)] text-left text-xs text-[var(--muted-foreground)]">
                    <th className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someSelected && !allSelected;
                        }}
                        onChange={toggleSelectAll}
                        aria-label="Select all"
                        className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                      />
                    </th>
                    <th className="px-3 py-2.5 font-medium">Name</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Channels</th>
                    <th className="px-3 py-2.5 font-medium">Source</th>
                    <th className="px-3 py-2.5 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const selected = selectedIds.has(c.id);
                    return (
                      <tr
                        key={c.id}
                        onClick={() => router.push(href(`/campaign-builder/${c.id}`))}
                        className={`cursor-pointer border-b border-[var(--border)] transition last:border-0 hover:bg-[var(--muted)] ${
                          selected ? 'bg-[var(--primary)]/8' : ''
                        }`}
                      >
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleRow(c.id)}
                            aria-label={`Select ${c.name}`}
                            className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                          />
                        </td>
                        <td className="px-3 py-3 font-medium text-[var(--foreground)]">{c.name}</td>
                        <td className="px-3 py-3">
                          <CampaignStatusBadge status={c.status} />
                        </td>
                        <td className="px-3 py-3">
                          <ChannelChips campaign={c} />
                        </td>
                        <td className="px-3 py-3 text-xs text-[var(--muted-foreground)]">
                          {c.source === 'ai' ? 'AI' : 'Manual'}
                        </td>
                        <td className="px-3 py-3 text-xs text-[var(--muted-foreground)]">
                          {new Date(c.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {selectedIds.size > 0 && (
        <BulkActionDock
          count={selectedIds.size}
          itemLabel={selectedIds.size === 1 ? 'campaign' : 'campaigns'}
          actions={dockActions}
          onClose={clearSelection}
        />
      )}
    </div>
  );
}

function EmptyState({ searchOrFilter, href }: { searchOrFilter: boolean; href: (p: string) => string }) {
  if (searchOrFilter) {
    return (
      <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">No campaigns match.</div>
    );
  }
  return (
    <div className="glass-card rounded-xl p-12 text-center">
      <div className="iris-rainbow-gradient mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full shadow-md">
        <MegaphoneIcon className="h-6 w-6 text-zinc-900" />
      </div>
      <h2 className="text-lg font-semibold text-[var(--foreground)]">No campaigns yet</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-[var(--muted-foreground)]">
        Describe what you want to promote and Loomi will draft every channel together — or start
        manually and fill in the pieces yourself.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <Link
          href={href('/campaign-builder/new')}
          className="iris-rainbow-gradient inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:opacity-90"
        >
          <SparklesIcon className="h-4 w-4" />
          Build with AI
        </Link>
      </div>
    </div>
  );
}
