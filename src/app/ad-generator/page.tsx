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

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { SparklesIcon, PlusIcon, TrashIcon, Squares2X2Icon, RectangleGroupIcon, XMarkIcon, Cog6ToothIcon, ChevronDownIcon, CheckIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { ListToolbar } from '@/components/list-toolbar';
import type { StatusFilterValue } from '@/components/status-filter';
import { AdPreviewThumb, brandingFromAccount } from '@/components/ad-generator/ad-preview-thumb';
import { AD_TEMPLATES, ALL_TEMPLATES } from '@/lib/ad-generator/templates';
import { adTemplateFromDoc, blankTemplateDoc } from '@/lib/ad-generator/doc-template';
import { catalogByCategory, aspectLabel, type CatalogSize } from '@/lib/ad-generator/ad-size-catalog';
import { templateInIndustry } from '@/lib/ad-generator/industry';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import type { AdTemplate, AdData } from '@/lib/ad-generator/types';

type Creative = {
  id: string;
  name: string;
  templateId: string;
  status: string;
  updatedAt: string;
  createdByName: string | null;
  doc?: TemplateDoc | null;
  data: AdData;
};

export default function AdGeneratorListPage() {
  const { accountKey, accountData } = useAccount();
  const router = useRouter();
  const [dbTemplates, setDbTemplates] = useState<AdTemplate[]>([]);
  const [creatives, setCreatives] = useState<Creative[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scratchOpen, setScratchOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');
  // Header dropdowns: the settings cog + the "New ad" split menu.
  const [cogOpen, setCogOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const cogRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cogOpen && !newOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (cogOpen && !cogRef.current?.contains(t)) setCogOpen(false);
      if (newOpen && !newRef.current?.contains(t)) setNewOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [cogOpen, newOpen]);

  useEffect(() => {
    let cancelled = false;
    // Global templates + this account's own (dealer-branded plates etc.).
    fetch(`/api/ad-generator/templates-doc${accountKey ? `?accountKey=${encodeURIComponent(accountKey)}` : ''}`)
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
  }, [accountKey]);
  // Resolution list (incl. retired templates) — for rendering existing ads.
  const templates = useMemo(() => [...ALL_TEMPLATES, ...dbTemplates], [dbTemplates]);
  // Picker list — only OFFERED templates, scoped to this account's industry
  // (non-automotive sees none for now).
  const pickerTemplates = useMemo(
    () => [...AD_TEMPLATES, ...dbTemplates].filter((t) => templateInIndustry(t, accountData?.category)),
    [dbTemplates, accountData?.category],
  );

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
  const branding: AdData = useMemo(() => brandingFromAccount(accountData), [accountData]);

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

  // From scratch: a blank ad (empty doc) at the chosen name + starting size(s),
  // opened straight in the builder's ad mode so the designer starts on an empty
  // canvas with no layers.
  async function createBlank(name: string, sizes: CatalogSize[]) {
    if (!accountKey) {
      toast.error('Select an account first');
      return;
    }
    const chosen = sizes.length ? sizes : [{ name: 'Square', width: 1080, height: 1080 } as CatalogSize];
    setCreating(true);
    try {
      const trimmed = name.trim() || 'Untitled ad';
      const docSizes = chosen.map((size, i) => {
        const slug = size.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return {
          id: slug || `size-${i}`,
          label: `${size.name} ${size.width}×${size.height}`,
          width: size.width,
          height: size.height,
        };
      });
      const doc = blankTemplateDoc(`blank-${Date.now()}`, trimmed, docSizes);
      const res = await fetch('/api/ad-generator/creatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey, name: trimmed, templateId: 'blank', data: {}, doc }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      router.push(`/ad-generator/builder?ad=${encodeURIComponent(json.creative.id)}${accountKey ? `&account=${encodeURIComponent(accountKey)}` : ''}&from=${encodeURIComponent('/ad-generator')}`);
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
            {/* Settings cog → management links (Ad Sizes, Template Builder) */}
            <div className="relative" ref={cogRef}>
              <button
                type="button"
                onClick={() => setCogOpen((v) => !v)}
                title="Settings"
                aria-label="Settings"
                className="flex items-center justify-center w-10 h-10 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                <Cog6ToothIcon className="w-4 h-4" />
              </button>
              {cogOpen && (
                <div className="absolute right-0 top-full mt-1 z-30 w-48 glass-dropdown">
                  <Link
                    href={`/ad-generator/sizes${accountKey ? `?account=${encodeURIComponent(accountKey)}` : ''}`}
                    onClick={() => setCogOpen(false)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                  >
                    <RectangleGroupIcon className="w-4 h-4" />
                    Ad Sizes
                  </Link>
                </div>
              )}
            </div>

            {/* New ad → from the template library, or from scratch in the builder */}
            <div className="relative" ref={newRef}>
              <button
                type="button"
                onClick={() => setNewOpen((v) => !v)}
                disabled={!accountKey}
                className="flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <PlusIcon className="w-4 h-4" />
                New ad
                <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${newOpen ? 'rotate-180' : ''}`} />
              </button>
              {newOpen && (
                <div className="absolute right-0 top-full mt-1 z-30 w-56 glass-dropdown">
                  <button
                    type="button"
                    onClick={() => {
                      setNewOpen(false);
                      setPickerOpen(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                  >
                    <SparklesIcon className="w-4 h-4 flex-shrink-0" />
                    <span>
                      From template library
                      <span className="block text-[11px] text-[var(--muted-foreground)]">Start from a ready-made layout.</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={creating || !accountKey}
                    onClick={() => {
                      setNewOpen(false);
                      setScratchOpen(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
                  >
                    <Squares2X2Icon className="w-4 h-4 flex-shrink-0" />
                    <span>
                      From scratch
                      <span className="block text-[11px] text-[var(--muted-foreground)]">Name it and pick a size, then design in the builder.</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
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
            // Render the thumbnail from the ad's own snapshot when present, so it
            // matches the editor/export even if the master template later changed.
            const template = c.doc ? adTemplateFromDoc(c.id, c.doc) : templates.find((t) => t.id === c.templateId);
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/ad-generator/${c.id}`)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && router.push(`/ad-generator/${c.id}`)}
                className="glass-card group cursor-pointer overflow-hidden rounded-2xl border border-[var(--border)] text-left transition-colors hover:border-[var(--primary)]"
              >
                <AdPreviewThumb template={template} data={c.data} branding={branding} />
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

      {pickerOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16" onClick={() => !creating && setPickerOpen(false)}>
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
            {pickerTemplates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
                <p className="text-sm text-[var(--muted-foreground)]">No templates for this account&rsquo;s industry yet.</p>
                <button
                  type="button"
                  disabled={creating}
                  onClick={() => {
                    setPickerOpen(false);
                    setScratchOpen(true);
                  }}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Squares2X2Icon className="h-4 w-4" />
                  Start from scratch
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {pickerTemplates.map((t) => (
                  <button
                    key={t.id}
                    disabled={creating}
                    onClick={() => createAd(t.id)}
                    className="flex flex-col overflow-hidden rounded-xl border border-[var(--border)] text-left transition-colors hover:border-[var(--primary)] disabled:opacity-60"
                  >
                    <AdPreviewThumb template={t} data={{}} branding={branding} height={120} />
                    <div className="p-2.5">
                      <div className="truncate text-xs font-semibold text-[var(--foreground)]">{t.name}</div>
                      {t.description && <div className="mt-0.5 truncate text-[10px] text-[var(--muted-foreground)]">{t.description}</div>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}

      {scratchOpen && (
        <ScratchSetupModal
          creating={creating}
          onClose={() => !creating && setScratchOpen(false)}
          onStart={(name, sizes) => void createBlank(name, sizes)}
        />
      )}
    </div>
  );
}

/**
 * "From scratch" setup step — name the ad and pick a starting size before the
 * builder opens, so a brand-new design starts at the right dimensions instead
 * of always defaulting to a 1080 square. Sizes come from the shared catalog.
 */
function ScratchSetupModal({
  creating,
  onClose,
  onStart,
}: {
  creating: boolean;
  onClose: () => void;
  onStart: (name: string, sizes: CatalogSize[]) => void;
}) {
  const groups = useMemo(() => catalogByCategory(), []);
  const [name, setName] = useState('Untitled ad');
  const [selected, setSelected] = useState<CatalogSize[]>(() => [AD_SIZE_CATALOG_DEFAULT(groups)]);
  const toggle = (s: CatalogSize) =>
    setSelected((cur) => (cur.some((x) => x.name === s.name) ? cur.filter((x) => x.name !== s.name) : [...cur, s]));

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-5 shadow-xl backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-sm font-bold text-[var(--foreground)]">Start from scratch</h2>
            <p className="text-xs text-[var(--muted-foreground)]">Name it and pick one or more starting sizes — you can add more or change everything in the builder.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-[var(--foreground)]">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled ad"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
        </label>

        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-xs font-medium text-[var(--foreground)]">Starting sizes</span>
          <span className="text-[11px] text-[var(--muted-foreground)]">{selected.length} selected</span>
        </div>
        <div className="max-h-[44vh] space-y-4 overflow-y-auto pr-1">
          {groups.map((grp) => (
            <div key={grp.category}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{grp.label}</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {grp.sizes.map((s) => {
                  const ratio = s.width / s.height;
                  const boxW = ratio >= 1 ? 28 : 28 * ratio;
                  const boxH = ratio >= 1 ? 28 / ratio : 28;
                  const on = selected.some((x) => x.name === s.name);
                  return (
                    <button
                      key={s.name}
                      type="button"
                      onClick={() => toggle(s)}
                      aria-pressed={on}
                      title={`${s.name} · ${s.width}×${s.height}`}
                      className={`relative flex items-center gap-2 rounded-xl border p-2.5 text-left transition-colors ${
                        on ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]/40' : 'border-[var(--border)] hover:border-[var(--primary)]'
                      }`}
                    >
                      {on && (
                        <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--primary)] text-white">
                          <CheckIcon className="h-3 w-3" />
                        </span>
                      )}
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-[var(--muted)]/50">
                        <div className="rounded-[2px] bg-[var(--primary)]/30 ring-1 ring-[var(--primary)]/50" style={{ width: boxW, height: boxH }} />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-semibold text-[var(--foreground)]">{s.name}</div>
                        <div className="truncate text-[10px] text-[var(--muted-foreground)]">
                          {s.width}×{s.height} · {aspectLabel(s.width, s.height)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={creating} className="rounded-lg px-3 py-2 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={() => onStart(name, selected)}
            disabled={creating || selected.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Squares2X2Icon className="h-4 w-4" />
            {creating ? 'Creating…' : selected.length > 1 ? `Start with ${selected.length} sizes` : 'Start designing'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Default starting size for the scratch modal — Instagram Square if present
 *  (matches the prior 1080 default), else the first catalog size. */
function AD_SIZE_CATALOG_DEFAULT(groups: { sizes: CatalogSize[] }[]): CatalogSize {
  const all = groups.flatMap((g) => g.sizes);
  return all.find((s) => s.name === 'Instagram Square') ?? all[0];
}
