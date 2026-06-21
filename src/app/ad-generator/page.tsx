'use client';

/**
 * Ad Generator — the home surface: a gallery of the active account's created
 * ads (like the forms / landing-page index pages). Click one to open the editor
 * (/ad-generator/[id]); "New ad" picks a template and creates one. Live mini
 * previews render through the same template function the editor + export use.
 * Behind AD_GENERATOR_ENABLED (the route layout 404s when off).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { SparklesIcon, PlusIcon, TrashIcon, Squares2X2Icon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
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
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--primary)]/10 text-[var(--primary)]">
            <SparklesIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Ad Generator</h1>
            <p className="text-sm text-[var(--muted-foreground)]">Your account&rsquo;s ads. Open one to edit, or start a new one from a template.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/ad-generator/builder"
            className="hidden items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)] sm:flex"
          >
            <Squares2X2Icon className="h-3.5 w-3.5" />
            Template Builder
          </Link>
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <PlusIcon className="h-4 w-4" />
            New ad
          </button>
        </div>
      </div>

      {!accountKey ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-16 text-center text-sm text-[var(--muted-foreground)]">
          Select an account in the top bar to see its ads.
        </p>
      ) : creatives === null ? (
        <p className="py-16 text-center text-sm text-[var(--muted-foreground)]">Loading…</p>
      ) : creatives.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-16 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">No ads yet.</p>
          <button onClick={() => setPickerOpen(true)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
            <PlusIcon className="h-4 w-4" />
            Create your first ad
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {creatives.map((c) => {
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
