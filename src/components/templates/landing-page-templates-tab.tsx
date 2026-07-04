'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  RectangleStackIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ArrowUturnLeftIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { LandingPagePreviewThumbnail } from '@/components/landing-pages/landing-page-preview-thumbnail';
import { TemplateCard, type TemplateCardAction } from '@/components/templates/template-card';
import type { LpTemplateSummary } from '@/lib/services/lp-templates';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

/**
 * Landing Pages tab of the unified /templates page. LP "templates" are
 * account-scoped saved schemas; a card click creates a new landing page from the
 * template and opens the LP editor. Uses the shared TemplateCard (status,
 * category/tags, author) like every other kind.
 *
 * LP templates are account-scoped, so this tab only has data inside a
 * sub-account; in pure admin mode it shows an info state.
 */
export function LandingPageTemplatesTab({ accountKey }: { accountKey?: string }) {
  const router = useRouter();
  const subHref = useSubaccountHref();
  const { confirm } = useLoomiDialog();
  const [creatingId, setCreatingId] = useState<string | null>(null);

  const { data, isLoading, error, mutate } = useSWR<{ templates: LpTemplateSummary[] }>(
    accountKey ? `/api/account-lp-templates?accountKey=${encodeURIComponent(accountKey)}` : null,
    fetcher,
  );
  const { data: taxData } = useSWR<{ categories?: string[]; tags?: string[] }>('/api/template-taxonomy', fetcher);
  const taxonomy = useMemo(
    () => ({ categories: taxData?.categories ?? [], tags: taxData?.tags ?? [] }),
    [taxData],
  );

  if (!accountKey) {
    return (
      <div className="glass-card rounded-2xl px-6 py-14 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[var(--muted)] flex items-center justify-center mx-auto mb-4">
          <RectangleStackIcon className="w-7 h-7 text-[var(--muted-foreground)]" />
        </div>
        <h3 className="text-lg font-semibold">Select a sub-account</h3>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Landing page templates are saved per sub-account. Switch into one to
          view and use its templates.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card rounded-2xl p-6 text-sm text-rose-300">
        Landing page templates could not be loaded.
      </div>
    );
  }

  const templates = data?.templates ?? [];

  const useTemplate = async (tpl: LpTemplateSummary) => {
    if (creatingId) return;
    setCreatingId(tpl.id);
    try {
      const res = await fetch('/api/landing-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey, name: tpl.name, templateId: `account:${tpl.id}` }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.page?.id) {
        toast.error(payload.error || 'Could not create from template.');
        return;
      }
      router.push(subHref(`/websites/landing-pages/${payload.page.id}/edit`));
    } catch {
      toast.error('Could not create from template.');
    } finally {
      setCreatingId(null);
    }
  };

  const patchTemplate = async (id: string, body: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/account-lp-templates/${id}`, {
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

  const removeTemplate = async (tpl: LpTemplateSummary) => {
    const ok = await confirm({
      title: 'Delete template?',
      message: `"${tpl.name || 'Untitled template'}" will be permanently removed. Pages already created from it keep their own copy.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/account-lp-templates/${tpl.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Template deleted');
      await mutate();
    } catch (err) {
      toast.error(`Couldn't delete: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
          <RectangleStackIcon className="w-7 h-7 text-[var(--muted-foreground)]" />
        </div>
        <h3 className="text-lg font-semibold">No landing page templates yet</h3>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Open a landing page and choose “Save as template” to reuse its design here.
        </p>
      </div>
    );
  }

  const actionsFor = (tpl: LpTemplateSummary): TemplateCardAction[] => [
    { key: 'use', label: creatingId === tpl.id ? 'Creating…' : 'Use template', icon: ArrowRightIcon, run: () => void useTemplate(tpl) },
    tpl.status === 'published'
      ? { key: 'unpublish', label: 'Move to draft', icon: ArrowUturnLeftIcon, run: () => void patchTemplate(tpl.id, { status: 'draft' }) }
      : { key: 'publish', label: 'Publish', icon: CheckCircleIcon, run: () => void patchTemplate(tpl.id, { status: 'published' }) },
    { key: 'delete', label: 'Delete', icon: TrashIcon, run: () => void removeTemplate(tpl), danger: true },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {templates.map((tpl) => (
        <TemplateCard
          key={tpl.id}
          preview={<LandingPagePreviewThumbnail template={tpl.schema} height={160} />}
          name={tpl.name || 'Untitled template'}
          status={tpl.status}
          category={tpl.category}
          tags={tpl.tags}
          taxonomy={taxonomy}
          author={{ name: tpl.createdByName, avatarUrl: tpl.createdByImage }}
          editable
          actions={actionsFor(tpl)}
          onClick={() => void useTemplate(tpl)}
          onCategoryChange={(c) => void patchTemplate(tpl.id, { category: c })}
          onTagsChange={(tags) => void patchTemplate(tpl.id, { tags })}
        />
      ))}
    </div>
  );
}
