'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import { PlusIcon, PencilSquareIcon, TrashIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { AdPreviewThumb, brandingFromAccount } from '@/components/ad-generator/ad-preview-thumb';
import { adTemplateFromDoc } from '@/lib/ad-generator/doc-template';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';

type DocTemplate = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  updatedAt: string;
  doc: TemplateDoc | null;
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

/**
 * Ads tab of the unified /templates page — the shared library of reusable ad
 * templates (the master layouts). Admins+ EDIT a template here (opens it in the
 * Template Builder); the per-ad copy is made + edited in the Ad Generator,
 * exactly like email: library templates here, the account's instances there.
 *
 * Gated to managers behind AD_GENERATOR_ENABLED by the parent.
 */
export function AdTemplatesTab({ accountKey }: { accountKey?: string }) {
  const router = useRouter();
  const { accountData } = useAccount();
  const { confirm } = useLoomiDialog();

  // ?all=1 = drafts + published (admin); these templates are global (the shared
  // library), so they aren't filtered by account.
  const { data, isLoading, error, mutate } = useSWR<{ templates?: DocTemplate[] }>(
    '/api/ad-generator/templates-doc?all=1',
    fetcher,
  );
  const templates = useMemo(() => (data?.templates ?? []).filter((t) => t.doc), [data]);
  const branding = useMemo(() => brandingFromAccount(accountData), [accountData]);

  // Carry the active sub-account across the hard route into the builder.
  const acct = accountKey ? `&account=${encodeURIComponent(accountKey)}` : '';
  const newAcct = accountKey ? `?account=${encodeURIComponent(accountKey)}` : '';

  const edit = (id: string) => router.push(`/ad-generator/builder?template=${encodeURIComponent(id)}${acct}`);

  const remove = async (t: DocTemplate) => {
    const ok = await confirm({
      title: 'Delete template?',
      message: `"${t.name}" will be permanently removed from the library. Ads already created from it keep their own copy.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/ad-generator/templates-doc/${t.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Template deleted');
      await mutate();
    } catch (err) {
      toast.error(`Couldn't delete: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  if (error) {
    return <div className="glass-card rounded-2xl p-6 text-sm text-rose-300">Ad templates could not be loaded.</div>;
  }
  if (isLoading) {
    return <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {templates.map((t) => {
        const template = t.doc ? adTemplateFromDoc(t.id, t.doc) : undefined;
        return (
          <div
            key={t.id}
            role="button"
            tabIndex={0}
            onClick={() => edit(t.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && edit(t.id)}
            className="glass-card group cursor-pointer overflow-hidden rounded-2xl border border-[var(--border)] text-left transition-colors hover:border-[var(--primary)]"
          >
            <AdPreviewThumb template={template} data={t.doc?.defaults ?? {}} branding={branding} height={150} />
            <div className="flex items-start justify-between gap-2 p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[var(--foreground)]">{t.name}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                      t.status === 'published' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                    }`}
                  >
                    {t.status}
                  </span>
                  <span className="truncate">Updated {new Date(t.updatedAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-0.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    edit(t.id);
                  }}
                  title="Edit template"
                  className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  <PencilSquareIcon className="h-4 w-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(t);
                  }}
                  title="Delete template"
                  className="rounded-md p-1.5 text-[var(--muted-foreground)] opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {/* New template — opens the builder (starts from the default layout) */}
      <button
        type="button"
        onClick={() => router.push(`/ad-generator/builder${newAcct}`)}
        className="group flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--border)] p-6 text-center transition-colors hover:border-[var(--primary)] hover:bg-[var(--muted)]/40"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--muted)] text-[var(--muted-foreground)] transition-colors group-hover:text-[var(--primary)]">
          {templates.length === 0 ? <Squares2X2Icon className="h-6 w-6" /> : <PlusIcon className="h-6 w-6" />}
        </div>
        <div>
          <div className="text-sm font-semibold text-[var(--foreground)]">New template</div>
          <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">Design a reusable layout in the Template Builder.</div>
        </div>
      </button>
    </div>
  );
}
