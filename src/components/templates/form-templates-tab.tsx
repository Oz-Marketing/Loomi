'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  DocumentTextIcon,
  PencilSquareIcon,
  ArrowUpTrayIcon,
  CheckCircleIcon,
  ArrowUturnLeftIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { FormPreviewThumbnail } from '@/components/forms/form-preview-thumbnail';
import { DeployFormModal } from '@/components/forms/deploy-form-modal';
import { TemplateCard, type TemplateCardAction } from '@/components/templates/template-card';
import { TemplateLibraryShell, TemplateEmptyState } from '@/components/templates/template-library-shell';
import { TemplateFilterRail } from '@/components/templates/template-filter-rail';
import { TemplateHeaderActions } from '@/components/templates/template-header-actions';
import { useTemplateFilters } from '@/components/templates/use-template-filters';
import type { FormSummary } from '@/lib/services/forms';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

/**
 * Forms tab of the unified /templates page. Lists reusable form templates
 * (Form rows with isTemplate=true) using the shared TemplateCard (status,
 * category/tags, author). Clicking a card opens the form editor; new templates
 * are created from a live form via its "Save as template" action on
 * /websites/forms.
 */
export function FormTemplatesTab({
  accountKey,
  organizationId,
  orgLabel,
}: {
  accountKey?: string;
  organizationId?: string;
  orgLabel?: string;
}) {
  const router = useRouter();
  const subHref = useSubaccountHref();
  const { accounts } = useAccount();
  const { confirm } = useLoomiDialog();
  // Deploy is an admin-only action — pushing a global template into
  // sub-accounts only makes sense from the unscoped library view.
  const canDeploy = !accountKey && !organizationId;
  const [deployTarget, setDeployTarget] = useState<FormSummary | null>(null);
  // key → dealer name, for the shared rail's Subaccount facet labels.
  const accountLabels = useMemo(
    () => Object.fromEntries(Object.entries(accounts).map(([k, a]) => [k, a.dealer || k])),
    [accounts],
  );

  // Scoping: Admin (no account) → the WHOLE library (global + every subaccount's
  // own; filter by scope via the rail's Subaccount facet); inside a sub-account
  // → only that account's own templates.
  const query = organizationId
    ? `?isTemplate=true&organizationId=${encodeURIComponent(organizationId)}`
    : accountKey
      ? `?isTemplate=true&accountKey=${encodeURIComponent(accountKey)}`
      : '?isTemplate=true';
  const { data, isLoading, error, mutate } = useSWR<{ forms: FormSummary[] }>(`/api/forms${query}`, fetcher);
  const { data: taxData } = useSWR<{ categories?: string[]; tags?: string[] }>('/api/template-taxonomy', fetcher);
  const taxonomy = useMemo(
    () => ({ categories: taxData?.categories ?? [], tags: taxData?.tags ?? [] }),
    [taxData],
  );

  const templates = useMemo(() => data?.forms ?? [], [data]);
  const { filters, setFilters, facets, filtered, active, reset } = useTemplateFilters(templates, {
    getName: (f) => f.name || 'Untitled template',
    getCategory: (f) => f.category,
    getTags: (f) => f.tags,
    getStatus: (f) => (f.status === 'published' ? 'published' : 'draft'),
    // '' accountKey = system/global template → the global bucket.
    getAccountKey: (f) => f.accountKey || null,
  });

  const patchForm = async (id: string, body: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/forms/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await mutate();
    } catch (err) {
      toast.error(`Couldn't save: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  // Create a blank form template + open the form editor (Email/Ads parity).
  // Admin (no accountKey) → a system-library template; sub-account → its own.
  const [creating, setCreating] = useState(false);
  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Untitled template',
          isTemplate: true,
          ...(organizationId ? { organizationId } : accountKey ? { accountKey } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      router.push(subHref(`/websites/forms/${json.form.id}/edit`));
    } catch (err) {
      toast.error(`Couldn't create: ${err instanceof Error ? err.message : 'unknown error'}`);
      setCreating(false);
    }
  };

  const handleDelete = async (form: FormSummary) => {
    const ok = await confirm({
      title: 'Delete template?',
      message: `"${form.name || 'Untitled template'}" will be permanently removed.`,
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
    toast.success('Template deleted.');
    await mutate();
  };

  if (error) {
    return (
      <div className="glass-card rounded-2xl p-6 text-sm text-rose-300">
        Form templates could not be loaded.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass-card rounded-xl h-72 animate-pulse bg-[var(--muted)]/30" />
        ))}
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <>
        <TemplateHeaderActions onCreate={handleCreate} createLabel="New Form Template" onTagsSaved={() => void mutate()} />
        <TemplateEmptyState
          icon={DocumentTextIcon}
          title="No form templates yet"
          subtitle="Create a reusable form template, or open a form on the Forms page and choose “Save as template”."
          actionLabel="New Form Template"
          onAction={handleCreate}
        />
      </>
    );
  }

  const editForm = (form: FormSummary) => router.push(subHref(`/websites/forms/${form.id}/edit`));

  const actionsFor = (form: FormSummary): TemplateCardAction[] => [
    { key: 'edit', label: 'Edit template', icon: PencilSquareIcon, run: () => editForm(form) },
    ...(canDeploy
      ? [{ key: 'deploy', label: 'Deploy to sub-account', icon: ArrowUpTrayIcon, run: () => setDeployTarget(form) }]
      : []),
    form.status === 'published'
      ? { key: 'unpublish', label: 'Move to draft', icon: ArrowUturnLeftIcon, run: () => void patchForm(form.id, { status: 'draft' }) }
      : { key: 'publish', label: 'Publish', icon: CheckCircleIcon, run: () => void patchForm(form.id, { status: 'published' }) },
    { key: 'delete', label: 'Delete', icon: TrashIcon, run: () => void handleDelete(form), danger: true },
  ];

  return (
    <>
      <TemplateHeaderActions onCreate={handleCreate} createLabel="New Form Template" onTagsSaved={() => void mutate()} />
      {organizationId && (
        <div className="mb-4 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/5 px-4 py-2.5 text-xs text-[var(--muted-foreground)]">
          You&rsquo;re authoring for{' '}
          <span className="font-medium text-[var(--foreground)]">{orgLabel ?? 'this organization'}</span>. New
          templates here are shared with every sub-account in the organization.
        </div>
      )}
      <TemplateLibraryShell
        resultCount={filtered.length}
        rail={
          <TemplateFilterRail
            filters={filters}
            setFilters={setFilters}
            facets={facets}
            active={active}
            reset={reset}
            showStatus
            accountLabels={accountLabels}
            search={filters.search}
            onSearch={(v) => setFilters((f) => ({ ...f, search: v }))}
          />
        }
      >
        {filtered.length === 0 ? (
          <div className="glass-card rounded-2xl p-10 text-center text-sm text-[var(--muted-foreground)]">
            No templates match your filters.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((form) => (
              <TemplateCard
                key={form.id}
                preview={<FormPreviewThumbnail template={form.schema} height={160} />}
                name={form.name || 'Untitled template'}
                status={form.status}
                scope={!accountKey ? { label: form.accountKey ? accounts[form.accountKey]?.dealer ?? form.accountKey : 'All accounts', kind: form.accountKey ? 'account' : 'global' } : undefined}
                category={form.category}
                tags={form.tags}
                taxonomy={taxonomy}
                author={{ name: form.createdByName, avatarUrl: form.createdByImage }}
                editable
                actions={actionsFor(form)}
                onClick={() => editForm(form)}
                onCategoryChange={(c) => void patchForm(form.id, { category: c })}
                onTagsChange={(tags) => void patchForm(form.id, { tags })}
              />
            ))}
          </div>
        )}
      </TemplateLibraryShell>
      {deployTarget && (
        <DeployFormModal
          open={!!deployTarget}
          formId={deployTarget.id}
          formName={deployTarget.name || 'Untitled template'}
          onClose={() => setDeployTarget(null)}
          onDeployed={() => setDeployTarget(null)}
        />
      )}
    </>
  );
}
