'use client';

import { useMemo } from 'react';
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
import { ViewSwitcher, useListView } from '@/components/view-switcher';
import type { BulkActionDockItem } from '@/components/bulk-action-dock';
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

  // ── Single-row action handlers (used by the table's 3-dot menu) ──

  const handleTogglePublish = async (
    form: FormsTableRow,
    nextStatus: 'published' | 'draft',
  ) => {
    const res = await fetch(`/api/forms/${form.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
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
  const handleRowOpenOverview = (form: FormsTableRow) => {
    router.push(subHref(`/websites/forms/${form.id}`));
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

      {/* Toolbar — Cards / Table toggle. Sits between the page header
          and the list so it shows up consistently regardless of which
          view is active. */}
      <div className="flex items-center justify-end pb-3">
        <ViewSwitcher value={view} onChange={setView} />
      </div>

      {error ? (
        <div className="glass-card rounded-2xl p-6 text-sm text-rose-300">
          Forms could not be loaded.
        </div>
      ) : view === 'cards' ? (
        <FormsList
          forms={forms}
          loading={isLoading}
          accountNames={accountNames}
        />
      ) : (
        <FormsTable
          forms={forms as FormsTableRow[]}
          loading={isLoading}
          accountMeta={accountMeta}
          showAccountColumn={showAccountColumn}
          onTogglePublish={handleTogglePublish}
          emptyState={{
            title: 'No forms yet',
            subtitle:
              'Create your first form and start shaping the capture experience.',
          }}
          bulkActions={buildBulkActions}
          onRowEdit={handleRowEdit}
          onRowOpenOverview={handleRowOpenOverview}
          onRowDelete={handleRowDelete}
        />
      )}
    </AdminOnly>
  );
}
