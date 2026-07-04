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
export function FormTemplatesTab({ accountKey }: { accountKey?: string }) {
  const router = useRouter();
  const subHref = useSubaccountHref();
  const { accounts } = useAccount();
  const { confirm } = useLoomiDialog();
  // Deploy is an admin-only action — pushing a global template into
  // sub-accounts only makes sense from the unscoped library view.
  const canDeploy = !accountKey;
  const [deployTarget, setDeployTarget] = useState<FormSummary | null>(null);

  const query = accountKey
    ? `?isTemplate=true&accountKey=${encodeURIComponent(accountKey)}`
    : '?isTemplate=true';
  const { data, isLoading, error, mutate } = useSWR<{ forms: FormSummary[] }>(`/api/forms${query}`, fetcher);
  const { data: taxData } = useSWR<{ categories?: string[]; tags?: string[] }>('/api/template-taxonomy', fetcher);
  const taxonomy = useMemo(
    () => ({ categories: taxData?.categories ?? [], tags: taxData?.tags ?? [] }),
    [taxData],
  );

  const templates = data?.forms ?? [];

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
      <div className="glass-card rounded-2xl px-6 py-14 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[var(--muted)] flex items-center justify-center mx-auto mb-4">
          <DocumentTextIcon className="w-7 h-7 text-[var(--muted-foreground)]" />
        </div>
        <h3 className="text-lg font-semibold">No form templates yet</h3>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Open a form on the Forms page and choose “Save as template” to reuse its design here.
        </p>
      </div>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {templates.map((form) => (
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
