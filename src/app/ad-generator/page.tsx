'use client';

/**
 * Ad Generator — the home surface: a gallery of the active account's created
 * ads (like the Landing Pages / Templates index pages, and styled to match
 * them: sticky page header, shared ListToolbar, glass-card empty states).
 * Click an ad to open the editor (/ad-generator/[id]); "New ad" picks a
 * template and creates one. Live mini previews render through the same
 * template function the editor + export use. Behind AD_GENERATOR_ENABLED (the
 * route layout 404s when off).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { SparklesIcon, PlusIcon, TrashIcon, Squares2X2Icon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { ListToolbar } from '@/components/list-toolbar';
import type { StatusFilterValue } from '@/components/status-filter';
import { AD_TEMPLATES } from '@/lib/ad-generator/templates';
import { adTemplateFromDoc } from '@/lib/ad-generator/doc-template';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import type { AdTemplate, AdData } from '@/lib/ad-generator/types';

type Creative = {
  id: string;
  name: string;
  templateId: string;
  status: string;
  updatedAt: string;
  createdByName: string | null;
  data: AdData;
};

export default function AdGeneratorListPage() {
  const { accountKey, accountData } = useAccount();
  const router = useRouter();
  const [dbTemplates, setDbTemplates] = useState<AdTemplate[]>([]);
  const [creatives, setCreatives] = useState<Creative[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ad-generator/templates-doc')
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: { id: string; doc: TemplateDoc | null }[] }) => {
        if (cancelled) return;
        setDbTemplates((d.templates ?? []).filter((t) => t.doc).map((t) => adTemplateFromDoc(t.id, t.doc as TemplateDoc)));
      })
      .catch(() => {
        if (!cancelled) setDbTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const templates = useMemo(() => [...AD_TEMPLATES, ...dbTemplates], [dbTemplates]);

  useEffect(() => {
    if (!accountKey) {
      setCreatives([]);
      return;
    }
    let cancelled = false;
    setCreatives(null);
    fetch(`/api/ad-generator/creatives?accountKey=${encodeURIComponent(accountKey)}`)
      .then((r) => (r.ok ? r.json() : { creatives: [] }))
      .then((d: { creatives?: Creative[] }) => {
        if (!cancelled) setCreatives(d.creatives ?? []);
      })
      .catch(() => {
        if (!cancelled) setCreatives([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey]);

  // Account branding for the mini previews (same as the editor merges in).
  const branding: AdData = useMemo(
    () => ({
      ...(accountData?.dealer ? { dealerName: accountData.dealer } : {}),
      ...(accountData?.logos?.light ? { logoUrl: accountData.logos.light } : {}),
      ...(accountData?.branding?.colors?.primary ? { brandColor: accountData.branding.colors.primary } : {}),
    }),
    [accountData],
  );

  // Visible list — filtered by status + search (ads only have a card view).
  const visible = useMemo(() => {
    let list = creatives ?? [];
    if (statusFilter === 'published') list = list.filter((c) => c.status === 'ready');
    else if (statusFilter === 'draft') list = list.filter((c) => c.status !== 'ready');
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => {
        const t = templates.find((x) => x.id === c.templateId);
        return c.name.toLowerCase().includes(q) || (t?.name ?? c.templateId).toLowerCase().includes(q);
      });
    }
    return list;
  }, [creatives, statusFilter, search, templates]);

  async function createAd(templateId: string) {
    if (!accountKey) {
      toast.error('Select an account first');
      return;
    }
    setCreating(true);
    try {
      const t = templates.find((x) => x.id === templateId);
      const res = await fetch('/api/ad-generator/creatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey, name: `New ${t?.name ?? 'ad'}`, templateId, data: t?.defaults ?? {} }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      router.push(`/ad-generator/${json.creative.id}`);
    } catch (err) {
      toast.error(`Couldn't create: ${err instanceof Error ? err.message : 'unknown error'}`);
      setCreating(false);
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/ad-generator/creatives/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCreatives((c) => (c ?? []).filter((x) => x.id !== id));
      toast.success('Deleted');
    } catch (err) {
      toast.error(`Couldn't delete: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  return (
    <div>
      <div className="page-sticky-header mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <SparklesIcon className="w-7 h-7 text-[var(--primary)]" />
            <div>
              <h2 className="text-2xl font-bold">Ad Generator</h2>
              <p className="text-[var(--muted-foreground)] mt-1">
                Your account&rsquo;s ads. Open one to edit, or start a new one from a template.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Link
              href="/ad-generator/builder"
              className="hidden sm:flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <Squares2X2Icon className="w-4 h-4" />
              Template Builder
            </Link>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={!accountKey}
              className="flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <PlusIcon className="w-4 h-4" />
              New ad
            </button>
          </div>
        </div>
      </div>

      {creatives && creatives.length > 0 && (
        <div className="mb-4">
          <ListToolbar
            leading={
              <span className="text-sm text-[var(--muted-foreground)]">
                {visible.length} {visible.length === 1 ? 'ad' : 'ads'}
              </span>
            }
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search ads…"
            status={statusFilter}
            onStatusChange={setStatusFilter}
            statusOptions={[
              { value: 'all', label: 'All' },
              { value: 'draft', label: 'Draft' },
              { value: 'published', label: 'Ready' },
            ]}
          />
        </div>
      )}

      {!accountKey ? (
        <div className="glass-card rounded-2xl p-12 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-[var(--muted)] flex items-center justify-center mb-4">
            <SparklesIcon className="w-8 h-8 text-[var(--muted-foreground)]" />
          </div>
          <h2 className="text-lg font-semibold mb-1">Select an account</h2>
          <p className="text-sm text-[var(--muted-foreground)] max-w-md">
            Choose an account in the top bar to see and create its ads.
          </p>
        </div>
      ) : creatives === null ? (
        <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>
      ) : creatives.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-[var(--muted)] flex items-center justify-center mb-4">
            <SparklesIcon className="w-8 h-8 text-[var(--muted-foreground)]" />
          </div>
          <h2 className="text-lg font-semibold mb-1">No ads yet</h2>
          <p className="text-sm text-[var(--muted-foreground)] max-w-md mb-6">
            Start from a template — pick a layout, drop in the offer + vehicle, and export sized for every channel.
          </p>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <PlusIcon className="w-4 h-4" />
            Create your first ad
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="glass-card rounded-2xl p-10 text-center text-sm text-[var(--muted-foreground)]">
          No ads match the current filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {visible.map((c) => {
            const template = templates.find((t) => t.id === c.templateId);
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/ad-generator/${c.id}`)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && router.push(`/ad-generator/${c.id}`)}
                className="glass-card group cursor-pointer overflow-hidden rounded-2xl border border-[var(--border)] text-left transition-colors hover:border-[var(--primary)]"
              >
                <CreativeThumb template={template} data={c.data} branding={branding} />
                <div className="flex items-start justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--foreground)]">{c.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                          c.status === 'ready' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                        }`}
                      >
                        {c.status}
                      </span>
                      <span className="truncate">{template?.name ?? c.templateId}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">Updated {new Date(c.updatedAt).toLocaleDateString()}</div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(c.id);
                    }}
                    title="Delete"
                    className="flex-shrink-0 rounded-md p-1.5 text-[var(--muted-foreground)] opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16" onClick={() => !creating && setPickerOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-5 shadow-xl backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-sm font-bold text-[var(--foreground)]">Start a new ad</h2>
                <p className="text-xs text-[var(--muted-foreground)]">Pick a template to begin. You can edit everything after.</p>
              </div>
              <button onClick={() => setPickerOpen(false)} className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  disabled={creating}
                  onClick={() => createAd(t.id)}
                  className="flex flex-col overflow-hidden rounded-xl border border-[var(--border)] text-left transition-colors hover:border-[var(--primary)] disabled:opacity-60"
                >
                  <CreativeThumb template={t} data={{}} branding={branding} height={120} />
                  <div className="p-2.5">
                    <div className="truncate text-xs font-semibold text-[var(--foreground)]">{t.name}</div>
                    {t.description && <div className="mt-0.5 truncate text-[10px] text-[var(--muted-foreground)]">{t.description}</div>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A scaled, non-interactive mini-preview rendered with the template function. */
function CreativeThumb({ template, data, branding, height = 180 }: { template?: AdTemplate; data: AdData; branding: AdData; height?: number }) {
  if (!template) {
    return <div className="flex items-center justify-center bg-[var(--muted)]/40 text-xs text-[var(--muted-foreground)]" style={{ height }}>Preview unavailable</div>;
  }
  const size = template.sizes[0];
  const html = template.render({ ...template.defaults, ...data, ...branding }, size);
  const boxW = 360;
  const scale = Math.min(boxW / size.width, height / size.height);
  return (
    <div className="flex items-center justify-center overflow-hidden bg-[var(--muted)]/40" style={{ height }}>
      <div className="overflow-hidden rounded shadow-sm ring-1 ring-black/5" style={{ width: size.width * scale, height: size.height * scale }}>
        <iframe
          title="Ad preview"
          srcDoc={html}
          style={{ width: size.width, height: size.height, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }}
        />
      </div>
    </div>
  );
}
