'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import { PlayIcon, PauseIcon, TrashIcon } from '@heroicons/react/24/outline';
import { AdminOnly } from '@/components/route-guard';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { FormsList } from '@/components/forms/forms-list';
import { FormsPageHeader } from '@/components/forms/forms-page-header';
import {
  FormsTable,
  type FormsTableRow,
  type BulkActionContext,
} from '@/components/forms/forms-table';
import { useListView } from '@/components/view-switcher';
import { ListToolbar } from '@/components/list-toolbar';
import type { BulkActionDockItem } from '@/components/bulk-action-dock';
import type { StatusFilterValue } from '@/components/status-filter';
import type { FormSummary } from '@/lib/services/forms';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

export default function FormsPage() {
  const { accountKey, accounts } = useAccount();
  const router = useRouter();
  const subHref = useSubaccountHref();
  const { confirm } = useLoomiDialog();
  const [view, setView] = useListView('loomi.forms.view', 'cards');
  // Unified toolbar state — search + status filter drive both views.
  // Forms don't have an "archived" status today (just draft / published),
  // so we surface only those values in the StatusFilter.
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');

  const query = accountKey ? `?accountKey=${encodeURIComponent(accountKey)}` : '';
  const { data, isLoading, error, mutate } = useSWR<{
    forms: FormSummary[];
    total: number;
  }>(`/api/forms${query}`, fetcher);

  // Lookup map used by the cards (dealer name only).
  const accountNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [key, account] of Object.entries(accounts)) {
      map[key] = account.dealer;
    }
    return map;
  }, [accounts]);

  // Richer meta the table needs for the Sub-Account column avatar.
  const accountMeta = useMemo(() => {
    const map: Record<
      string,
      { dealer: string; logos?: { light?: string; dark?: string; white?: string; black?: string }; category?: string }
    > = {};
    for (const [key, account] of Object.entries(accounts)) {
      map[key] = {
        dealer: account.dealer,
        logos: account.logos,
        category: account.category,
      };
    }
    return map;
  }, [accounts]);

  const forms = data?.forms ?? [];
  // Hide the Sub-Account column when the user has already filtered
  // down to a single account — mirrors FlowsTable's behavior.
  const showAccountColumn = !accountKey;

  // Page-level filter — applied to both cards + table so the unified
  // toolbar drives both views from the same state.
  const visibleForms = useMemo(() => {
    const q = search.trim().toLowerCase();
    return forms.filter((f) => {
      if (statusFilter === 'draft' && f.status !== 'draft') return false;
      if (statusFilter === 'published' && f.status !== 'published') return false;
      // Forms have no archived state today; treat 'archived' as empty.
      if (statusFilter === 'archived') return false;
      if (!q) return true;
      return `${f.name} ${f.slug} ${f.status}`.toLowerCase().includes(q);
    });
  }, [forms, search, statusFilter]);

  // ── Single-row action handlers (used by the table's 3-dot menu) ──

  // Tracks which form's publish toggle is mid-flight so the card /
  // table row can render a disabled state without rerendering the rest.
  const [publishingIds, setPublishingIds] = useState<string[]>([]);

  const handleTogglePublish = async (
    form: { id: string },
    nextStatus: 'published' | 'draft',
  ) => {
    setPublishingIds((prev) => [...prev, form.id]);
    const res = await fetch(`/api/forms/${form.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    setPublishingIds((prev) => prev.filter((id) => id !== form.id));
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error || 'Could not update status.');
      return;
    }
    await mutate();
  };

  const handleRowEdit = (form: FormsTableRow) => {
    router.push(subHref(`/websites/forms/${form.id}/edit`));
  };

  const handleSaveAsTemplate = async (form: FormSummary) => {
    const res = await fetch(`/api/forms/${form.id}/save-as-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error || 'Could not save as template.');
      return;
    }
    toast.success('Saved as template — find it under Templates → Forms.');
  };
  const handleRowDelete = async (form: FormsTableRow) => {
    const ok = await confirm({
      title: 'Delete form?',
      message: `"${form.name || 'Untitled form'}" and its submissions will be permanently removed.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/forms/${form.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error || 'Delete failed.');
      return;
    }
    toast.success('Form deleted.');
    await mutate();
  };

  // ── Bulk-action helpers (publish/draft/delete) ──

  const runBulk = async (
    label: 'publish' | 'draft' | 'delete',
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
      toast.success(`${succeeded} ${succeeded === 1 ? 'form' : 'forms'} ${label}${label === 'delete' ? 'd' : 'ed'}`);
    } else if (succeeded === 0) {
      toast.error(`Failed to ${label} ${failed} ${failed === 1 ? 'form' : 'forms'}`);
    } else {
      toast.error(`${succeeded} ${label}${label === 'delete' ? 'd' : 'ed'}, ${failed} failed`);
    }
    await mutate();
    clearSelection();
  };

  const buildBulkActions = (ctx: BulkActionContext): BulkActionDockItem[] => [
    {
      id: 'publish',
      label: 'Publish',
      icon: <PlayIcon className="w-3.5 h-3.5" />,
      onClick: () =>
        void runBulk(
          'publish',
          ctx.selectedIds,
          (id) =>
            fetch(`/api/forms/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'published' }),
            }),
          ctx.clearSelection,
        ),
    },
    {
      id: 'draft',
      label: 'Move to Draft',
      icon: <PauseIcon className="w-3.5 h-3.5" />,
      onClick: () =>
        void runBulk(
          'draft',
          ctx.selectedIds,
          (id) =>
            fetch(`/api/forms/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'draft' }),
            }),
          ctx.clearSelection,
        ),
    },
    {
      id: 'delete',
      label: 'Delete',
      danger: true,
      icon: <TrashIcon className="w-3.5 h-3.5" />,
      onClick: async () => {
        const count = ctx.selectedIds.length;
        const ok = await confirm({
          title: count === 1 ? 'Delete form?' : `Delete ${count} forms?`,
          message:
            count === 1
              ? 'This form and its submissions will be permanently removed.'
              : `These ${count} forms and their submissions will be permanently removed.`,
          confirmLabel: 'Delete',
          destructive: true,
        });
        if (!ok) return;
        void runBulk(
          'delete',
          ctx.selectedIds,
          (id) => fetch(`/api/forms/${id}`, { method: 'DELETE' }),
          ctx.clearSelection,
        );
      },
    },
  ];

  return (
    <AdminOnly>
      <FormsPageHeader
        accountKey={accountKey}
        disabledReason="Select a sub-account before creating a form."
      />

      {/* Unified toolbar — only renders when there's something to view.
          A toolbar above an empty-state card looks like dead chrome;
          hide it until the user has at least one form. */}
      {forms.length > 0 && (
        <ListToolbar
          view={view}
          onViewChange={setView}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search forms…"
          status={statusFilter}
          onStatusChange={setStatusFilter}
          statusOptions={[
            { value: 'all', label: 'All' },
            { value: 'draft', label: 'Draft' },
            { value: 'published', label: 'Published' },
          ]}
        />
      )}

      {error ? (
        <div className="glass-card rounded-2xl p-6 text-sm text-rose-300">
          Forms could not be loaded.
        </div>
      ) : view === 'cards' ? (
        <FormsList
          forms={visibleForms}
          loading={isLoading}
          accountNames={accountNames}
          onTogglePublish={(form, next) => void handleTogglePublish(form, next)}
          onDelete={(form) =>
            void handleRowDelete({
              id: form.id,
              name: form.name,
              slug: form.slug,
              status: form.status,
              submissionCount: form.submissionCount,
              accountKey: form.accountKey,
              createdAt: form.createdAt,
              updatedAt: form.updatedAt,
            })
          }
          onSaveAsTemplate={(form) => void handleSaveAsTemplate(form)}
          publishingIds={publishingIds}
        />
      ) : (
        <FormsTable
          forms={visibleForms as FormsTableRow[]}
          loading={isLoading}
          accountMeta={accountMeta}
          showAccountColumn={showAccountColumn}
          onTogglePublish={handleTogglePublish}
          updatingFormIds={publishingIds}
          emptyState={{
            title: 'No forms yet',
            subtitle:
              'Create your first form and start shaping the capture experience.',
          }}
          bulkActions={buildBulkActions}
          onRowEdit={handleRowEdit}
          onRowDelete={handleRowDelete}
          // Toolbar lives at the page level now.
          hideToolbar
          search={search}
          onSearchChange={setSearch}
        />
      )}
    </AdminOnly>
  );
}
