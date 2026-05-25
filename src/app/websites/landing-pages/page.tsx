'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { PlusIcon, RectangleStackIcon } from '@heroicons/react/24/outline';
import { AdminOnly } from '@/components/route-guard';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { useListView } from '@/components/view-switcher';
import { ListToolbar } from '@/components/list-toolbar';
import type { StatusFilterValue } from '@/components/status-filter';
import { LandingPageCard } from '@/components/landing-pages/landing-page-card';
import { LandingPagesTable } from '@/components/landing-pages/landing-pages-table';
import { NewLandingPageModal } from '@/components/landing-pages/new-landing-page-modal';
import type { LandingPageSummary } from '@/lib/services/landing-pages';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

export default function LandingPagesPage() {
  const { accountKey, accounts } = useAccount();
  const { confirm } = useLoomiDialog();
  const [view, setView] = useListView('loomi.landing-pages.view', 'cards');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');
  const [newOpen, setNewOpen] = useState(false);
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());

  const { data, error, mutate, isLoading } = useSWR<{ pages: LandingPageSummary[] }>(
    '/api/landing-pages',
    fetcher,
  );
  const pages = data?.pages ?? [];

  // Visible list — filtered by account, status, and search.
  const visible = useMemo(() => {
    let next = pages;
    if (accountKey) next = next.filter((p) => p.accountKey === accountKey);
    if (statusFilter !== 'all') {
      next = next.filter((p) => p.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      next = next.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q),
      );
    }
    return next;
  }, [pages, accountKey, statusFilter, search]);

  // `accounts` is a Record<accountKey, AccountData> — index in rather
  // than find.
  const accountName = useMemo(
    () => (accountKey ? accounts[accountKey]?.dealer : undefined),
    [accountKey, accounts],
  );

  async function togglePublish(page: LandingPageSummary, next: 'published' | 'draft') {
    setPublishingIds((prev) => new Set([...prev, page.id]));
    try {
      const res = await fetch(`/api/landing-pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Could not update status.');
        return;
      }
      toast.success(next === 'published' ? 'Page published.' : 'Page moved to draft.');
      await mutate();
    } finally {
      setPublishingIds((prev) => {
        const out = new Set(prev);
        out.delete(page.id);
        return out;
      });
    }
  }

  async function duplicate(page: LandingPageSummary) {
    const res = await fetch(`/api/landing-pages/${page.id}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(payload.error || 'Could not duplicate.');
      return;
    }
    toast.success('Page duplicated.');
    await mutate();
  }

  async function destroy(page: LandingPageSummary) {
    const ok = await confirm({
      title: `Delete "${page.name || 'Untitled'}"?`,
      message: 'This removes the landing page permanently. Cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/landing-pages/${page.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.error || 'Could not delete.');
      return;
    }
    toast.success('Page deleted.');
    await mutate();
  }

  return (
    <AdminOnly>
      <div className="px-8 py-8 max-w-7xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--foreground)]">
              Landing Pages
            </h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Build standalone marketing pages. Embed a Form to capture leads.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            disabled={!accountKey}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <PlusIcon className="w-4 h-4" />
            New Landing Page
          </button>
        </header>

        {pages.length > 0 && (
          <div className="mb-4">
            <ListToolbar
              view={view}
              onViewChange={setView}
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search landing pages…"
              status={statusFilter}
              onStatusChange={setStatusFilter}
              statusOptions={[
                { value: 'all', label: 'All' },
                { value: 'draft', label: 'Draft' },
                { value: 'published', label: 'Published' },
              ]}
            />
          </div>
        )}

        {error ? (
          <div className="glass-card rounded-2xl p-6 text-sm text-rose-300">
            Landing pages could not be loaded.
          </div>
        ) : isLoading ? (
          <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>
        ) : pages.length === 0 ? (
          <EmptyState onCreate={() => setNewOpen(true)} accountReady={!!accountKey} />
        ) : visible.length === 0 ? (
          <FilterEmptyState />
        ) : view === 'cards' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {visible.map((page) => (
              <LandingPageCard
                key={page.id}
                page={page}
                accountName={accountName}
                onTogglePublish={togglePublish}
                onDuplicate={duplicate}
                onDelete={destroy}
                isPublishUpdating={publishingIds.has(page.id)}
              />
            ))}
          </div>
        ) : (
          <LandingPagesTable
            pages={visible}
            onTogglePublish={togglePublish}
            onDuplicate={duplicate}
            onDelete={destroy}
            isPublishUpdating={(id) => publishingIds.has(id)}
          />
        )}
      </div>

      <NewLandingPageModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        accountKey={accountKey}
      />
    </AdminOnly>
  );
}

function EmptyState({
  onCreate,
  accountReady,
}: {
  onCreate: () => void;
  accountReady: boolean;
}) {
  return (
    <div className="glass-card rounded-2xl p-12 text-center flex flex-col items-center">
      <div className="w-16 h-16 rounded-2xl bg-[var(--muted)] flex items-center justify-center mb-4">
        <RectangleStackIcon className="w-8 h-8 text-[var(--muted-foreground)]" />
      </div>
      <h2 className="text-lg font-semibold mb-1">No landing pages yet</h2>
      <p className="text-sm text-[var(--muted-foreground)] max-w-md mb-6">
        Spin up a focused marketing page with hero, features, testimonials, and
        an embedded form — all in your brand. Pages publish to{' '}
        <code>/lp/&lt;slug&gt;</code>.
      </p>
      <button
        type="button"
        onClick={onCreate}
        disabled={!accountReady}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        <PlusIcon className="w-4 h-4" />
        Create your first landing page
      </button>
    </div>
  );
}

function FilterEmptyState() {
  return (
    <div className="glass-card rounded-2xl p-10 text-center text-sm text-[var(--muted-foreground)]">
      No landing pages match the current filters.
    </div>
  );
}
