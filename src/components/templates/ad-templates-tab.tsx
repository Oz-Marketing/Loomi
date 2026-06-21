'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import { PlusIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { AdPreviewThumb, brandingFromAccount } from '@/components/ad-generator/ad-preview-thumb';
import { AD_TEMPLATES } from '@/lib/ad-generator/templates';
import { adTemplateFromDoc } from '@/lib/ad-generator/doc-template';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import type { AdTemplate } from '@/lib/ad-generator/types';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

/**
 * Ads tab of the unified /templates page. Ad "templates" are the reusable
 * layouts — the built-in code templates (Vehicle Offer, Dual Offer, …) plus
 * any saved in the DB via the Template Builder. Clicking one creates a new ad
 * from it and opens the Ad Generator editor — the same path as the gallery's
 * "New ad" picker. A trailing tile opens the Template Builder to author a new
 * layout.
 *
 * Gated to developers behind AD_GENERATOR_ENABLED by the parent, matching the
 * nav. Ad templates are global, so this tab has data in admin mode too;
 * creating an ad needs an account, so the cards fall back to a toast prompt.
 */
export function AdTemplatesTab({ accountKey }: { accountKey?: string }) {
  const router = useRouter();
  const { accountData } = useAccount();
  const [creatingId, setCreatingId] = useState<string | null>(null);

  const { data, isLoading, error } = useSWR<{ templates?: { id: string; doc: TemplateDoc | null }[] }>(
    '/api/ad-generator/templates-doc',
    fetcher,
  );

  const dbTemplates = useMemo(
    () => (data?.templates ?? []).filter((t) => t.doc).map((t) => adTemplateFromDoc(t.id, t.doc as TemplateDoc)),
    [data],
  );
  const templates = useMemo(() => [...AD_TEMPLATES, ...dbTemplates], [dbTemplates]);
  const branding = useMemo(() => brandingFromAccount(accountData), [accountData]);

  // Carry the active sub-account across the hard route into the generator
  // (an admin-level route that reads ?account=, not a /subaccount/ path).
  const acctQuery = accountKey ? `?account=${encodeURIComponent(accountKey)}` : '';

  const useTemplate = async (template: AdTemplate) => {
    if (creatingId) return;
    if (!accountKey) {
      toast.error('Select an account first');
      return;
    }
    setCreatingId(template.id);
    try {
      const res = await fetch('/api/ad-generator/creatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey, name: `New ${template.name}`, templateId: template.id, data: template.defaults ?? {} }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      router.push(`/ad-generator/${json.creative.id}${acctQuery}`);
    } catch (err) {
      toast.error(`Couldn't create: ${err instanceof Error ? err.message : 'unknown error'}`);
      setCreatingId(null);
    }
  };

  if (error) {
    return (
      <div className="glass-card rounded-2xl p-6 text-sm text-rose-300">
        Ad templates could not be loaded.
      </div>
    );
  }

  if (isLoading) {
    return <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {templates.map((t) => (
        <button
          key={t.id}
          type="button"
          disabled={creatingId !== null}
          onClick={() => useTemplate(t)}
          className="glass-card group flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] text-left transition-colors hover:border-[var(--primary)] disabled:opacity-60"
        >
          <AdPreviewThumb template={t} data={{}} branding={branding} height={150} />
          <div className="flex items-start justify-between gap-2 p-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[var(--foreground)]">{t.name}</div>
              {t.description && <div className="mt-0.5 line-clamp-2 text-[11px] text-[var(--muted-foreground)]">{t.description}</div>}
            </div>
            {creatingId === t.id ? (
              <span className="flex-shrink-0 text-[11px] text-[var(--muted-foreground)]">Creating…</span>
            ) : (
              <span className="flex-shrink-0 rounded-md p-1.5 text-[var(--muted-foreground)] opacity-0 transition-opacity group-hover:opacity-100">
                <PlusIcon className="h-4 w-4" />
              </span>
            )}
          </div>
        </button>
      ))}

      {/* Author a brand-new layout in the Template Builder. */}
      <button
        type="button"
        onClick={() => router.push(`/ad-generator/builder${acctQuery}`)}
        className="group flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--border)] p-6 text-center transition-colors hover:border-[var(--primary)] hover:bg-[var(--muted)]/40"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--muted)] text-[var(--muted-foreground)] transition-colors group-hover:text-[var(--primary)]">
          <Squares2X2Icon className="h-6 w-6" />
        </div>
        <div>
          <div className="text-sm font-semibold text-[var(--foreground)]">Build a template</div>
          <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">Design a reusable layout in the Template Builder.</div>
        </div>
      </button>
    </div>
  );
}
