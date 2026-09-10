'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import {
  BoltIcon,
  SparklesIcon,
  PencilSquareIcon,
  MegaphoneIcon,
  TrashIcon,
  ArchiveBoxIcon,
  ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { toast } from '@/lib/toast';
import { ListToolbar } from '@/components/list-toolbar';
import { useListView } from '@/components/view-switcher';
import type { StatusFilterValue } from '@/components/status-filter';
import BulkActionDock, { type BulkActionDockItem } from '@/components/bulk-action-dock';
import { AutomatedChip, CampaignStatusBadge, CHANNEL_META } from './shared';
import { isVehicleIndustry } from '@/lib/ad-generator/industry';
import { OfferRunModal } from '@/components/campaigns/offer-run/offer-run-modal';
import { CAMPAIGN_SOURCE_LABEL } from '@/lib/campaigns/types';
import type { CampaignAssetKind, CampaignSummary } from '@/lib/campaigns/types';

// Ads lead for an OEM offer run — they are the bulk of what it produces, and the
// email is the companion. A hand-built or AI campaign simply has none, so the
// chip does not appear and the order below is unchanged for them.
const COUNT_ORDER: CampaignAssetKind[] = ['ad', 'email', 'sms', 'landingPage', 'form', 'flow'];
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
  // A dealer READS this page. Creating a campaign, archiving one and deleting one
  // are staff actions — the client tier holds `studio.campaigns.view` and
  // nothing else, and the routes behind these controls are still `AdminOnly`.
  const { userRole, accounts, accountData, scopedAccountKeys } = useAccount();
  const searchParams = useSearchParams();
  // The OEM run is offered wherever a vehicle-industry account is in scope —
  // `scopedAccountKeys` is the active account plus anything beneath it, or every
  // account in admin mode, so one rule covers a single account and a group.
  // Never hidden for readiness — the modal says what is missing. (This list does
  // not itself change with the roll-up choice, so it deliberately reads the key
  // list rather than the roll-up flag; the coverage test holds every reader of
  // that flag to a scope toggle.)
  const oemEligible = scopedAccountKeys.some((k) => isVehicleIndustry(accounts[k]?.category));
  const [oemOpen, setOemOpen] = useState(false);
  const [oemAccount, setOemAccount] = useState<string | null>(null);
  const openOemRun = (forAccount?: string | null) => {
    // One account in scope → it is the one; otherwise the wizard's first step asks.
    setOemAccount(forAccount ?? (scopedAccountKeys.length === 1 ? scopedAccountKeys[0] : null));
    setOemOpen(true);
  };
  // ?run=oem&account=<key> lets other surfaces open the wizard in place.
  useEffect(() => {
    if (searchParams.get('run') === 'oem') openOemRun(searchParams.get('account'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isStaff = userRole !== 'client';
  const router = useRouter();
  const { confirm } = useLoomiDialog();
  const [view, setView] = useListView('loomi.campaigns.view', 'cards');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  // One automation campaign per account per month fills a 50-row window fast
  // for staff who see every account; "Load more" widens it in place.
  const PAGE = 50;
  const [limit, setLimit] = useState(PAGE);

  // The Archived filter asks the API for archived rows only, so a full window
  // of live campaigns can't crowd them out of a shared page.
  const swrKey = `/api/campaigns?limit=${limit}${statusFilter === 'archived' ? '&archived=only' : ''}`;
  const { data, error, isLoading, mutate } = useSWR<{
    campaigns?: CampaignSummary[];
    hasMore?: boolean;
    error?: string;
  }>(swrKey, fetcher);

  const campaigns: CampaignSummary[] = useMemo(
    () => (Array.isArray(data?.campaigns) ? data!.campaigns! : []),
    [data],
  );

  // A client with nothing Active may be between cycles: last month's campaign
  // archived, the manufacturer's next programs not yet published. That is a
  // different message from "never had one", so the newest archived campaign is
  // asked for — clients only, only when Active is empty.
  const { data: endedData } = useSWR<{ campaigns?: CampaignSummary[] }>(
    !isStaff && data && (data.campaigns?.length ?? 0) === 0 && statusFilter !== 'archived'
      ? '/api/campaigns?archived=only&limit=1'
      : null,
    fetcher,
  );
  const endedCycle = useMemo(() => {
    const c = endedData?.campaigns?.[0];
    if (!c || c.source !== 'automation') return null;
    // "October 2026 offers — Young Honda Ogden" → "October"
    const m = /^([A-Z][a-z]+) \d{4} offers/.exec(c.name);
    return m ? m[1] : 'Last month';
  }, [endedData]);

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
        'This permanently deletes the campaign and every asset it generated (emails, texts, landing pages, forms) from their channel pages too. Ad designs are unlinked and stay in the Ad Generator. This can’t be undone.',
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
    // Archive and delete are staff actions; a dealer only reads.
    if (!isStaff) return actions;
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
  }, [selectedIds, statusFilter, busy, isStaff]);

  const loadError = error ? 'Failed to load campaigns' : data?.error || null;

  return (
    <div className="animate-fade-in-up">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {isStaff
              ? 'Multi-channel campaigns — email, SMS, and more — built together and reviewed as one.'
              : 'What Loomi built from your manufacturer offers — one campaign for each month’s programs.'}
          </p>
        </div>
        <div className={`flex items-center gap-2 ${isStaff ? '' : 'hidden'}`}>
          <Link
            href={href('/campaign-builder/new/manual')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3.5 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]"
          >
            <PencilSquareIcon className="h-4 w-4" />
            Start manually
          </Link>
          {/* Secondary, not the hero: one hero per header, and the Loomi AI
              control keeps the gradient. The team's own verb for this action. */}
          {oemEligible && (
            <button
              type="button"
              onClick={() => openOemRun()}
              title="Build ad designs and the offer email from this account’s manufacturer offers"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3.5 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]"
            >
              <BoltIcon className="h-4 w-4" />
              Generate from OEM offers
            </button>
          )}
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
        <EmptyState
          searchOrFilter={!!search.trim() || statusFilter === 'archived'}
          href={href}
          isStaff={isStaff}
          oemEligible={oemEligible}
          accountName={accountData?.dealer ?? null}
          endedCycleMonth={endedCycle}
          onRunOem={() => openOemRun()}
        />
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
                      {/* Staff see every account's campaigns in one list (the API
                          scopes by session, not by the switcher), so a card has
                          to say whose it is. A client's list is one account. */}
                      {isStaff && c.accountKey && (
                        <p className="-mt-1.5 truncate text-xs text-[var(--muted-foreground)]">
                          {accounts[c.accountKey]?.dealer || c.accountKey}
                        </p>
                      )}
                      <div className="flex items-center gap-2">
                        {c.source === 'automation' ? (
                          <AutomatedChip building={c.status === 'building'} />
                        ) : (
                          <CampaignStatusBadge status={c.status} />
                        )}
                        {c.source === 'ai' && (
                          <span
                            title="Generated by the AI campaign builder"
                            className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--muted-foreground)]"
                          >
                            <SparklesIcon className="h-3 w-3" /> {CAMPAIGN_SOURCE_LABEL[c.source]}
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
                    {isStaff && <th className="px-3 py-2.5 font-medium">Account</th>}
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
                        {isStaff && (
                          <td className="px-3 py-3 text-xs text-[var(--muted-foreground)]">
                            {c.accountKey ? accounts[c.accountKey]?.dealer || c.accountKey : '—'}
                          </td>
                        )}
                        <td className="px-3 py-3">
                          {c.source === 'automation' ? (
                            <AutomatedChip building={c.status === 'building'} />
                          ) : (
                            <CampaignStatusBadge status={c.status} />
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <ChannelChips campaign={c} />
                        </td>
                        <td className="px-3 py-3 text-xs text-[var(--muted-foreground)]">
                          {CAMPAIGN_SOURCE_LABEL[c.source]}
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

      {data?.hasMore && !isLoading && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setLimit((n) => n + PAGE)}
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]"
          >
            Load more
          </button>
        </div>
      )}

      <OfferRunModal
        open={oemOpen}
        onClose={() => setOemOpen(false)}
        initialAccountKey={oemAccount}
        onDone={() => void mutate()}
      />

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

function EmptyState({
  searchOrFilter,
  href,
  isStaff,
  oemEligible,
  accountName,
  endedCycleMonth,
  onRunOem,
}: {
  searchOrFilter: boolean;
  href: (p: string) => string;
  isStaff: boolean;
  oemEligible: boolean;
  accountName: string | null;
  /** For a client between cycles: the month whose offers just ended. */
  endedCycleMonth: string | null;
  onRunOem: () => void;
}) {
  if (searchOrFilter) {
    return (
      <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">No campaigns match.</div>
    );
  }

  // The CLIENT tier lands here as its normal state — every account has zero
  // campaigns until its first offer run. It used to get the staff empty state,
  // whose one button led to a page that says "requires admin access". Nothing
  // AI happens for a client here, so no gradient and no sparkle either.
  if (!isStaff) {
    return (
      <div className="glass-card rounded-xl p-12 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--muted)]">
          <BoltIcon className="h-6 w-6 text-[var(--muted-foreground)]" />
        </div>
        {endedCycleMonth ? (
          <>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">{endedCycleMonth}’s offers have ended</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-[var(--muted-foreground)]">
              The next campaign appears here once the manufacturer publishes new programs. Past
              campaigns are under Archived.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">No campaigns yet</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-[var(--muted-foreground)]">
              Your first campaign appears here once your manufacturer offers have been built into ad
              designs. There’s nothing to do until then.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl p-12 text-center">
      <div className="iris-rainbow-gradient mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full shadow-md">
        <MegaphoneIcon className="h-6 w-6 text-zinc-900" />
      </div>
      <h2 className="text-lg font-semibold text-[var(--foreground)]">No campaigns yet</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-[var(--muted-foreground)]">
        {oemEligible
          ? `Build a campaign from ${accountName ? `${accountName}’s` : 'the account’s'} manufacturer offers, describe one for Loomi to draft, or start manually.`
          : 'Describe what you want to promote and Loomi will draft every channel together — or start manually and fill in the pieces yourself.'}
      </p>
      <div className="mt-5 flex items-center justify-center gap-3">
        {oemEligible && (
          <button
            type="button"
            onClick={onRunOem}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]"
          >
            <BoltIcon className="h-4 w-4" />
            Generate from OEM offers
          </button>
        )}
        <Link
          href={href('/campaign-builder/new')}
          className="iris-rainbow-gradient inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:opacity-90"
        >
          <SparklesIcon className="h-4 w-4" />
          {/* One verb for the AI path on this page — the header says "New with AI". */}
          New with AI
        </Link>
        {/* The body has promised this since the page shipped; the link did not exist. */}
        <Link
          href={href('/campaign-builder/new/manual')}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
        >
          <PencilSquareIcon className="h-4 w-4" />
          Start manually
        </Link>
      </div>
    </div>
  );
}
