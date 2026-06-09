'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import { RectangleStackIcon, ArrowRightIcon } from '@heroicons/react/24/outline';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { LandingPagePreviewThumbnail } from '@/components/landing-pages/landing-page-preview-thumbnail';
import type { LpTemplateSummary } from '@/lib/services/lp-templates';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

/**
 * Landing Pages tab of the unified /templates page. LP "templates" are
 * account-scoped saved schemas (no editor of their own), so a card click
 * creates a new landing page from the template and opens the LP editor —
 * the same path as the New Landing Page "from template" flow.
 *
 * LP templates are account-scoped, so this tab only has data inside a
 * sub-account; in pure admin mode it shows an info state.
 */
export function LandingPageTemplatesTab({ accountKey }: { accountKey?: string }) {
  const router = useRouter();
  const subHref = useSubaccountHref();
  const [creatingId, setCreatingId] = useState<string | null>(null);

  const { data, isLoading, error } = useSWR<{ templates: LpTemplateSummary[] }>(
    accountKey
      ? `/api/account-lp-templates?accountKey=${encodeURIComponent(accountKey)}`
      : null,
    fetcher,
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
        body: JSON.stringify({
          accountKey,
          name: tpl.name,
          templateId: `account:${tpl.id}`,
        }),
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

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="glass-card rounded-xl h-72 animate-pulse bg-[var(--muted)]/30"
          />
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
          Open a landing page and choose “Save as template” to reuse its design
          here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {templates.map((tpl) => {
        const creating = creatingId === tpl.id;
        return (
          <button
            key={tpl.id}
            type="button"
            disabled={creating}
            onClick={() => void useTemplate(tpl)}
            className="glass-card group relative rounded-xl overflow-hidden text-left transition-all hover:border-[var(--primary)]/40 hover:shadow-lg disabled:opacity-60"
          >
            <div className="pointer-events-none">
              <LandingPagePreviewThumbnail template={tpl.schema} height={200} />
            </div>
            <div className="p-3 border-t border-[var(--border)] bg-[var(--card)]/70 backdrop-blur-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3
                    className="text-sm font-semibold truncate text-[var(--foreground)]"
                    title={tpl.name}
                  >
                    {tpl.name || 'Untitled template'}
                  </h3>
                  {tpl.description && (
                    <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)] truncate">
                      {tpl.description}
                    </p>
                  )}
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] flex-shrink-0">
                  {creating ? 'Creating…' : 'Use'}
                  {!creating && <ArrowRightIcon className="w-3.5 h-3.5" />}
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
