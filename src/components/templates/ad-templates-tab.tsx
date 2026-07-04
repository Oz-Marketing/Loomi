'use client';

import { useContext, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { createPortal } from 'react-dom';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  PlusIcon,
  SparklesIcon,
  EyeIcon,
  PencilSquareIcon,
  PencilIcon,
  DocumentDuplicateIcon,
  TrashIcon,
  XMarkIcon,
  RocketLaunchIcon,
  CheckCircleIcon,
  ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline';
import { DeployTemplateModal } from '@/components/ad-generator/deploy-template-modal';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import PrimaryButton from '@/components/primary-button';
import { TemplatesHeaderActionsContext } from '@/app/email/templates/email-templates-view';
import { TemplateCard, type TemplateCardAction } from '@/components/templates/template-card';
import { TemplateLibraryShell } from '@/components/templates/template-library-shell';
import { TemplateFilterRail } from '@/components/templates/template-filter-rail';
import { useTemplateFilters } from '@/components/templates/use-template-filters';
import { AdPreviewThumb, brandingFromAccount } from '@/components/ad-generator/ad-preview-thumb';
import { adTemplateFromDoc, blankTemplateDoc } from '@/lib/ad-generator/doc-template';
import { templateInIndustry } from '@/lib/ad-generator/industry';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';

type DocTemplate = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  accountKey: string | null;
  category: string | null;
  tags: string[];
  updatedAt: string;
  createdByName: string | null;
  createdByEmail: string | null;
  createdByImage: string | null;
  doc: TemplateDoc | null;
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

/**
 * Ads tab of the unified /templates page — the shared library of reusable ad
 * templates (the master layouts). Admins+ manage a template here (View / Edit /
 * Rename / Clone / Delete via a row menu); the per-ad copy is made + edited in
 * the Ad Generator, exactly like email: library templates here, the account's
 * instances there.
 */
export function AdTemplatesTab({ accountKey }: { accountKey?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { accountData, accounts } = useAccount();
  // Human name for a template's scope: its account's dealer name, or "All
  // accounts" for a global (unscoped) template.
  const scopeName = (key: string | null) => (key ? accounts[key]?.dealer ?? key : null);
  const { confirm } = useLoomiDialog();
  const headerSlot = useContext(TemplatesHeaderActionsContext);

  const { data, isLoading, error, mutate } = useSWR<{ templates?: DocTemplate[] }>(
    '/api/ad-generator/templates-doc?all=1',
    fetcher,
  );
  // Scoping: at Admin (no account) you manage the SYSTEM library (global,
  // accountKey null); inside a sub-account you see ONLY that account's own
  // templates (never the system library). Industry filter still applies.
  const templates = useMemo(
    () =>
      (data?.templates ?? [])
        .filter((t) => t.doc)
        .filter((t) => (accountKey ? t.accountKey === accountKey : t.accountKey == null))
        .filter((t) => templateInIndustry({ industries: t.doc!.industries, fields: t.doc!.fields }, accountData?.category)),
    [data, accountKey, accountData?.category],
  );
  const branding = useMemo(() => brandingFromAccount(accountData), [accountData]);
  // Shared taxonomy vocabulary (categories + tags across every template kind).
  const { data: taxData } = useSWR<{ categories?: string[]; tags?: string[] }>('/api/template-taxonomy', fetcher);
  const taxonomy = useMemo(
    () => ({ categories: taxData?.categories ?? [], tags: taxData?.tags ?? [] }),
    [taxData],
  );

  const { filters, setFilters, facets, filtered, active, reset } = useTemplateFilters(templates, {
    getName: (t) => t.name,
    getCategory: (t) => t.category,
    getTags: (t) => t.tags,
    getStatus: (t) => (t.status === 'published' ? 'published' : 'draft'),
  });

  // Every builder link carries `from` (this page + the Ads tab) so Back returns
  // to the Ads tab specifically, plus the active account. Assembled once.
  const backTo = `${pathname}?tab=ads`;
  const builderQuery = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ ...extra, from: backTo });
    if (accountKey) q.set('account', accountKey);
    return `/ad-generator/builder?${q.toString()}`;
  };

  const [preview, setPreview] = useState<DocTemplate | null>(null);
  const [renameFor, setRenameFor] = useState<DocTemplate | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deployFor, setDeployFor] = useState<DocTemplate | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const edit = (id: string) => router.push(builderQuery({ template: id }));

  // Inline taxonomy + publish edits — PATCH the row and refresh.
  const patchTemplate = async (id: string, body: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/ad-generator/templates-doc/${id}`, {
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
  const setPublished = (t: DocTemplate, published: boolean) => {
    void patchTemplate(t.id, { status: published ? 'published' : 'draft' }).then(
      () => toast.success(published ? 'Published' : 'Moved to draft'),
    );
  };
  const newTemplate = () => setNewOpen(true);

  // Create the draft record NOW (so it shows in the Ads list even if the user
  // bails out of the editor), then open it. From-scratch → a blank doc; from a
  // published template → a copy of its doc.
  const createAndOpen = async (name: string, doc: TemplateDoc) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/ad-generator/templates-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, doc: { ...doc, name }, status: 'draft', ...(accountKey ? { accountKey } : {}) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await mutate();
      setNewOpen(false);
      router.push(builderQuery({ template: json.template.id }));
    } catch (err) {
      toast.error(`Couldn't create: ${err instanceof Error ? err.message : 'unknown error'}`);
      setBusy(false);
    }
  };
  const startBlank = () => void createAndOpen('Untitled template', blankTemplateDoc(`tmpl-${Date.now()}`, 'Untitled template'));
  const startFrom = (t: DocTemplate) => t.doc && void createAndOpen(`${t.name} copy`, structuredClone(t.doc));

  // A scheduled template is only "live" within its window (inclusive, local
  // yyyy-MM-dd). No schedule → always live.
  const todayIso = new Date().toISOString().slice(0, 10);
  const inScheduleWindow = (t: DocTemplate) => {
    const s = t.doc?.schedule;
    if (!s) return true;
    if (s.start && todayIso < s.start) return false;
    if (s.end && todayIso > s.end) return false;
    return true;
  };
  const scheduleBadge = (t: DocTemplate): string | null => {
    const s = t.doc?.schedule;
    if (!s || (!s.start && !s.end)) return null;
    if (s.start && todayIso < s.start) return 'Scheduled';
    if (s.end && todayIso > s.end) return 'Expired';
    return 'Scheduled';
  };

  // Only published templates that are live right now can seed a new one.
  const publishedTemplates = useMemo(
    () => templates.filter((t) => t.status === 'published' && t.doc && inScheduleWindow(t)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [templates, todayIso],
  );

  const clone = async (t: DocTemplate) => {
    if (!t.doc) return;
    setBusy(true);
    try {
      const res = await fetch('/api/ad-generator/templates-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${t.name} (copy)`, description: t.description ?? undefined, doc: t.doc, status: 'draft' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`Cloned "${t.name}"`);
      await mutate();
    } catch (err) {
      toast.error(`Couldn't clone: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  const doRename = async () => {
    if (!renameFor) return;
    const name = renameValue.trim();
    if (!name) {
      toast.error('Name is required');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/ad-generator/templates-doc/${renameFor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Renamed');
      setRenameFor(null);
      await mutate();
    } catch (err) {
      toast.error(`Couldn't rename: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

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

  const actionsFor = (t: DocTemplate): TemplateCardAction[] => [
    { key: 'view', label: 'View', icon: EyeIcon, run: () => setPreview(t) },
    { key: 'edit', label: 'Edit', icon: PencilSquareIcon, run: () => edit(t.id) },
    { key: 'rename', label: 'Rename', icon: PencilIcon, run: () => { setRenameFor(t); setRenameValue(t.name); } },
    { key: 'clone', label: 'Clone', icon: DocumentDuplicateIcon, run: () => void clone(t) },
    { key: 'deploy', label: 'Deploy to subaccounts', icon: RocketLaunchIcon, run: () => setDeployFor(t) },
    t.status === 'published'
      ? { key: 'unpublish', label: 'Move to draft', icon: ArrowUturnLeftIcon, run: () => setPublished(t, false) }
      : { key: 'publish', label: 'Publish', icon: CheckCircleIcon, run: () => setPublished(t, true) },
    { key: 'delete', label: 'Delete', icon: TrashIcon, run: () => void remove(t), danger: true },
  ];

  return (
    <>
      {/* Primary CTA in the page header (portaled), matching the Email tab. */}
      {headerSlot &&
        createPortal(
          <PrimaryButton onClick={newTemplate}>
            <PlusIcon className="w-4 h-4" />
            New template
          </PrimaryButton>,
          headerSlot,
        )}

      {templates.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-[var(--muted)] flex items-center justify-center mb-4">
            <SparklesIcon className="w-8 h-8 text-[var(--muted-foreground)]" />
          </div>
          <h2 className="text-lg font-semibold mb-1">No ad templates yet</h2>
          <p className="text-sm text-[var(--muted-foreground)] max-w-md mb-6">
            {accountKey
              ? 'No templates for this account yet — an admin can push templates to it from the system library.'
              : 'Design a reusable layout in the Template Builder — your team starts each ad from one of these.'}
          </p>
          <button
            type="button"
            onClick={newTemplate}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <PlusIcon className="w-4 h-4" />
            New template
          </button>
        </div>
      ) : (
        <TemplateLibraryShell
          search={filters.search}
          onSearch={(v) => setFilters((f) => ({ ...f, search: v }))}
          resultCount={filtered.length}
          rail={
            <TemplateFilterRail
              filters={filters}
              setFilters={setFilters}
              facets={facets}
              active={active}
              reset={reset}
              showStatus
            />
          }
        >
          {filtered.length === 0 ? (
            <div className="glass-card rounded-2xl p-10 text-center text-sm text-[var(--muted-foreground)]">
              No templates match your filters.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((t) => {
                const template = t.doc ? adTemplateFromDoc(t.id, t.doc) : undefined;
                const badge = scheduleBadge(t);
                return (
                  <TemplateCard
                    key={t.id}
                    preview={<AdPreviewThumb template={template} data={t.doc?.defaults ?? {}} branding={branding} height={150} />}
                    name={t.name}
                    status={t.status === 'published' ? 'published' : 'draft'}
                    scope={{ label: scopeName(t.accountKey) ?? 'All accounts', kind: t.accountKey ? 'account' : 'global' }}
                    category={t.category}
                    tags={t.tags ?? []}
                    taxonomy={taxonomy}
                    author={{ name: t.createdByName, email: t.createdByEmail, avatarUrl: t.createdByImage }}
                    editable
                    badges={
                      badge && (
                        <span className="inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                          {badge}
                        </span>
                      )
                    }
                    actions={actionsFor(t)}
                    onClick={() => edit(t.id)}
                    onCategoryChange={(c) => void patchTemplate(t.id, { category: c })}
                    onTagsChange={(tags) => void patchTemplate(t.id, { tags })}
                  />
                );
              })}
            </div>
          )}
        </TemplateLibraryShell>
      )}

      {/* View preview */}
      {preview && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={() => setPreview(null)}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-4 shadow-xl backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-[var(--foreground)]">{preview.name}</div>
                {preview.description && <div className="truncate text-xs text-[var(--muted-foreground)]">{preview.description}</div>}
              </div>
              <button onClick={() => setPreview(null)} className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-hidden rounded-xl border border-[var(--border)]">
              <AdPreviewThumb template={preview.doc ? adTemplateFromDoc(preview.id, preview.doc) : undefined} data={preview.doc?.defaults ?? {}} branding={branding} height={320} />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => { const t = preview; setPreview(null); edit(t.id); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-3 h-9 text-sm font-medium text-white hover:bg-[var(--primary)]/90"
              >
                <PencilSquareIcon className="h-4 w-4" />
                Edit
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Deploy a template into selected subaccounts (published copies) */}
      {deployFor?.doc && (
        <DeployTemplateModal
          name={deployFor.name}
          doc={deployFor.doc}
          excludeKey={deployFor.accountKey}
          onClose={() => setDeployFor(null)}
          onDeployed={() => void mutate()}
        />
      )}

      {/* New template — start from scratch, or seed from a published template */}
      {newOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={() => setNewOpen(false)}>
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-5 shadow-xl backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-[var(--foreground)]">New template</h2>
                <p className="text-xs text-[var(--muted-foreground)]">Start from a blank artboard, or duplicate a published template as a starting point.</p>
              </div>
              <button onClick={() => setNewOpen(false)} className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <button
                onClick={startBlank}
                disabled={busy}
                className="mb-4 flex w-full items-center gap-3 rounded-xl border border-dashed border-[var(--border)] p-4 text-left transition-colors hover:border-[var(--primary)] hover:bg-[var(--muted)]/40 disabled:opacity-50"
              >
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--primary)]/10 text-[var(--primary)]">
                  <PlusIcon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-[var(--foreground)]">Start from scratch</span>
                  <span className="block text-[11px] text-[var(--muted-foreground)]">An empty artboard — add your own elements.</span>
                </span>
              </button>

              {publishedTemplates.length > 0 && (
                <>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Start from a published template</div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {publishedTemplates.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => startFrom(t)}
                        disabled={busy}
                        className="glass-card group overflow-hidden rounded-xl border border-[var(--border)] text-left transition-colors hover:border-[var(--primary)] disabled:opacity-50"
                      >
                        <div className="overflow-hidden">
                          <AdPreviewThumb template={t.doc ? adTemplateFromDoc(t.id, t.doc) : undefined} data={t.doc?.defaults ?? {}} branding={branding} height={120} />
                        </div>
                        <div className="truncate px-2.5 py-2 text-xs font-medium text-[var(--foreground)]">{t.name}</div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Rename */}
      {renameFor && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 p-4 pt-24" onClick={() => !busy && setRenameFor(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-4 shadow-xl backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-sm font-bold text-[var(--foreground)]">Rename template</h2>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doRename();
                if (e.key === 'Escape') setRenameFor(null);
              }}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setRenameFor(null)} disabled={busy} className="rounded-lg border border-[var(--border)] px-3 h-9 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50">
                Cancel
              </button>
              <button onClick={doRename} disabled={busy} className="rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-3 h-9 text-sm font-medium text-white hover:bg-[var(--primary)]/90 disabled:opacity-50">
                Save
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
