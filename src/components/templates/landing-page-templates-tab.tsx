'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  RectangleStackIcon,
  ArrowRightIcon,
  PencilSquareIcon,
  CheckCircleIcon,
  ArrowUturnLeftIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { LandingPagePreviewThumbnail } from '@/components/landing-pages/landing-page-preview-thumbnail';
import { TemplateCard, type TemplateCardAction } from '@/components/templates/template-card';
import { TemplateLibraryShell, TemplateEmptyState } from '@/components/templates/template-library-shell';
import { TemplateFilterRail } from '@/components/templates/template-filter-rail';
import { TemplateHeaderActions } from '@/components/templates/template-header-actions';
import { useTemplateFilters } from '@/components/templates/use-template-filters';
import type { LandingPageSummary } from '@/lib/services/landing-pages';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

/**
 * Landing Pages tab of the unified /templates page. LP templates are now
 * `LandingPage` rows with `isTemplate=true` — edited in place by the existing LP
 * builder (like Forms). Admin (no account) manages the system library; a
 * sub-account sees only its own. "Use template" spins up a live LP from the
 * template's schema.
 */
export function LandingPageTemplatesTab({ accountKey }: { accountKey?: string }) {
  const router = useRouter();
  const subHref = useSubaccountHref();
  const { accounts } = useAccount();
  const { confirm } = useLoomiDialog();
  // key → dealer name, for the shared rail's Subaccount facet + card scope badge.
  const accountLabels = useMemo(
    () => Object.fromEntries(Object.entries(accounts).map(([k, a]) => [k, a.dealer || k])),
    [accounts],
  );
  const [creating, setCreating] = useState(false);
  const [usingId, setUsingId] = useState<string | null>(null);

  const { data, isLoading, error, mutate } = useSWR<{ pages: LandingPageSummary[] }>(
    `/api/landing-pages?isTemplate=true${accountKey ? `&accountKey=${encodeURIComponent(accountKey)}` : ''}`,
    fetcher,
  );
  const { data: taxData } = useSWR<{ categories?: string[]; tags?: string[] }>('/api/template-taxonomy', fetcher);
  const taxonomy = useMemo(
    () => ({ categories: taxData?.categories ?? [], tags: taxData?.tags ?? [] }),
    [taxData],
  );

  const templates = useMemo(() => data?.pages ?? [], [data]);
  const { filters, setFilters, facets, filtered, active, reset } = useTemplateFilters(templates, {
    getName: (t) => t.name || 'Untitled template',
    getCategory: (t) => t.category,
    getTags: (t) => t.tags,
    getStatus: (t) => (t.status === 'published' ? 'published' : 'draft'),
    // '' accountKey = system/global template → the global bucket.
    getAccountKey: (t) => t.accountKey || null,
  });

  const editTemplate = (t: LandingPageSummary) => router.push(subHref(`/websites/landing-pages/${t.id}/edit`));

  // Create a blank LP template + open the existing LP builder (Email/Ads/Forms
  // parity). Admin → a system-library template; sub-account → its own.
  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/landing-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Untitled template', isTemplate: true, templateId: 'blank', ...(accountKey ? { accountKey } : {}) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      router.push(subHref(`/websites/landing-pages/${json.page.id}/edit`));
    } catch (err) {
      toast.error(`Couldn't create: ${err instanceof Error ? err.message : 'unknown error'}`);
      setCreating(false);
    }
  };

  // Spin up a live landing page from this template's schema, then open it.
  const useTemplate = async (t: LandingPageSummary) => {
    if (usingId || !accountKey) {
      if (!accountKey) toast.error('Switch into a sub-account to use a template.');
      return;
    }
    setUsingId(t.id);
    try {
      const res = await fetch('/api/landing-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey, name: t.name, templateId: `page:${t.id}` }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.page?.id) {
        toast.error(json.error || 'Could not create from template.');
        return;
      }
      router.push(subHref(`/websites/landing-pages/${json.page.id}/edit`));
    } catch {
      toast.error('Could not create from template.');
    } finally {
      setUsingId(null);
    }
  };

  const patchTemplate = async (id: string, body: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/landing-pages/${id}`, {
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

  const removeTemplate = async (t: LandingPageSummary) => {
    const ok = await confirm({
      title: 'Delete template?',
      message: `"${t.name || 'Untitled template'}" will be permanently removed. Pages already created from it keep their own copy.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/landing-pages/${t.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Template deleted');
      await mutate();
    } catch (err) {
      toast.error(`Couldn't delete: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  const header = <TemplateHeaderActions onCreate={handleCreate} createLabel="New Landing Page Template" onTagsSaved={() => void mutate()} />;

  if (error) {
    return (
      <>
        {header}
        <div className="glass-card rounded-2xl p-6 text-sm text-rose-300">Landing page templates could not be loaded.</div>
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        {header}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass-card rounded-xl h-72 animate-pulse bg-[var(--muted)]/30" />
          ))}
        </div>
      </>
    );
  }

  if (templates.length === 0) {
    return (
      <>
        {header}
        <TemplateEmptyState
          icon={RectangleStackIcon}
          title="No landing page templates yet"
          subtitle="Create a template (it opens in the landing page editor), or open a landing page and choose “Save as template”."
          actionLabel="New Landing Page Template"
          onAction={handleCreate}
        />
      </>
    );
  }

  const actionsFor = (t: LandingPageSummary): TemplateCardAction[] => [
    { key: 'edit', label: 'Edit template', icon: PencilSquareIcon, run: () => editTemplate(t) },
    ...(accountKey
      ? [{ key: 'use', label: usingId === t.id ? 'Creating…' : 'Use template', icon: ArrowRightIcon, run: () => void useTemplate(t) }]
      : []),
    t.status === 'published'
      ? { key: 'unpublish', label: 'Move to draft', icon: ArrowUturnLeftIcon, run: () => void patchTemplate(t.id, { status: 'draft' }) }
      : { key: 'publish', label: 'Publish', icon: CheckCircleIcon, run: () => void patchTemplate(t.id, { status: 'published' }) },
    { key: 'delete', label: 'Delete', icon: TrashIcon, run: () => void removeTemplate(t), danger: true },
  ];

  return (
    <>
      {header}
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
            {filtered.map((t) => (
              <TemplateCard
                key={t.id}
                preview={<LandingPagePreviewThumbnail template={t.schema} height={160} />}
                name={t.name || 'Untitled template'}
                status={t.status === 'published' ? 'published' : 'draft'}
                scope={!accountKey ? { label: t.accountKey ? accountLabels[t.accountKey] ?? t.accountKey : 'All accounts', kind: t.accountKey ? 'account' : 'global' } : undefined}
                category={t.category}
                tags={t.tags}
                taxonomy={taxonomy}
                author={{ name: t.createdByName, avatarUrl: t.createdByImage }}
                editable
                actions={actionsFor(t)}
                onClick={() => editTemplate(t)}
                onCategoryChange={(c) => void patchTemplate(t.id, { category: c })}
                onTagsChange={(tags) => void patchTemplate(t.id, { tags })}
              />
            ))}
          </div>
        )}
      </TemplateLibraryShell>
    </>
  );
}
