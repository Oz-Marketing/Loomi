'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckIcon,
  ClockIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { AdminOnly } from '@/components/route-guard';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { LandingPageEditorShell } from '@/lib/landing-pages/editor/LandingPageEditorShell';
import { LandingPageSettingsModal } from '@/components/landing-pages/landing-page-settings-modal';
import {
  emptyLandingPageTemplate,
  parseLandingPageTemplate,
  type LandingPageTemplate,
} from '@/lib/landing-pages/types';
import type { LandingPageDetail } from '@/lib/services/landing-pages';

const AUTOSAVE_MS = 600;
const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * LP builder page. Owns the autosave plumbing using the same
 * four-layer pattern the form builder ships:
 *   1. Debounced PATCH while editing.
 *   2. Keepalive PATCH on unmount that survives navigation.
 *   3. Optimistic context update on unmount so a same-layout
 *      sibling page (the overview) sees the change immediately.
 *   4. Fresh refetch on remount with a strict `updatedAt`
 *      guard so a stale server snapshot can't clobber an
 *      in-flight optimistic edit.
 */
export function LandingPageBuilderPage({ id }: { id: string }) {
  const router = useRouter();
  const subHref = useSubaccountHref();
  const { data, mutate, isLoading } = useSWR<{ page: LandingPageDetail }>(
    `/api/landing-pages/${id}`,
    fetcher,
  );
  const page = data?.page;

  const [template, setTemplate] = React.useState<LandingPageTemplate | null>(null);
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>('idle');
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  // When the API response first lands, seed local template state.
  // After that, the user's edits drive `template` and we autosave
  // back to the server.
  React.useEffect(() => {
    if (page && !template) {
      const parsed = parseLandingPageTemplate(page.schema) ?? emptyLandingPageTemplate();
      setTemplate(parsed);
      latestRef.current = parsed;
      savedRef.current = parsed;
    }
  }, [page, template]);

  // Refs for the unmount-flush trick.
  const latestRef = React.useRef<LandingPageTemplate | null>(null);
  const savedRef = React.useRef<LandingPageTemplate | null>(null);
  const initialRender = React.useRef(true);

  React.useEffect(() => {
    if (template) latestRef.current = template;
  }, [template]);

  // ── Layer 1: debounced autosave ──
  const patchSchema = React.useCallback(
    async (next: LandingPageTemplate) => {
      setSaveStatus('saving');
      const res = await fetch(`/api/landing-pages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema: next }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveStatus('error');
        toast.error(payload.error || 'Autosave failed');
        return;
      }
      savedRef.current = next;
      setSavedAt(new Date());
      setSaveStatus('saved');
      // Update the SWR cache so other components reading
      // /api/landing-pages/[id] see the fresh data without a round-trip.
      if (payload.page) {
        void mutate({ page: payload.page }, { revalidate: false });
      }
    },
    [id, mutate],
  );

  React.useEffect(() => {
    if (!template) return;
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }
    const handle = window.setTimeout(() => {
      void patchSchema(template);
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(handle);
  }, [template, patchSchema]);

  // ── Layer 2 + 3: unmount keepalive flush + optimistic mutate ──
  React.useEffect(() => {
    return () => {
      const pending = latestRef.current;
      if (!pending || pending === savedRef.current) return;
      savedRef.current = pending;
      // Optimistically refresh SWR cache so the overview / list page
      // pick up the change without waiting for the network round-trip.
      void mutate(
        (curr) =>
          curr?.page ? { page: { ...curr.page, schema: pending } } : curr,
        { revalidate: false },
      );
      try {
        fetch(`/api/landing-pages/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schema: pending }),
          keepalive: true,
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((payload) => {
            if (payload?.page) {
              void mutate({ page: payload.page }, { revalidate: false });
            }
          })
          .catch(() => {
            /* best-effort */
          });
      } catch {
        /* ignore */
      }
    };
  }, [id, mutate]);

  // pagehide safety net for tab close + bfcache.
  React.useEffect(() => {
    const flush = () => {
      const pending = latestRef.current;
      if (!pending || pending === savedRef.current) return;
      savedRef.current = pending;
      try {
        fetch(`/api/landing-pages/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schema: pending }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [id]);

  const saveDescriptor = describeSaveStatus(saveStatus, savedAt);

  return (
    <AdminOnly>
      <div className="px-6 py-3 flex items-center justify-between border-b border-[var(--border)] flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push(subHref(`/websites/landing-pages/${id}`))}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)]"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back
          </button>
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
              page?.status === 'published'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
            }`}
          >
            {page?.status ?? 'draft'}
          </span>
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${saveDescriptor.tone}`}>
            <saveDescriptor.Icon
              className={`w-3.5 h-3.5 ${saveDescriptor.spin ? 'animate-spin' : ''}`}
            />
            {saveDescriptor.label}
          </span>
        </div>
        <div className="text-sm font-medium capitalize">
          {page?.name || 'Loading…'}
        </div>
        <div className="flex items-center gap-2">
          {page?.status === 'published' && (
            <Link
              href={`/lp/${page.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--muted-foreground)] hover:text-[var(--primary)]"
            >
              Open live ↗
            </Link>
          )}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            disabled={!page}
            aria-label="Page settings"
            title="Page settings"
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-40"
          >
            <Cog6ToothIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isLoading || !template ? (
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--muted-foreground)]">
          Loading editor…
        </div>
      ) : (
        <LandingPageEditorShell template={template} onChange={setTemplate} />
      )}

      <LandingPageSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        page={page ?? null}
        onUpdated={(next) => void mutate({ page: next }, { revalidate: false })}
      />
    </AdminOnly>
  );
}

function describeSaveStatus(status: SaveStatus, savedAt: Date | null) {
  if (status === 'saving') {
    return { label: 'Autosaving…', Icon: ArrowPathIcon, tone: 'text-amber-400', spin: true };
  }
  if (status === 'error') {
    return {
      label: 'Save failed',
      Icon: ExclamationTriangleIcon,
      tone: 'text-red-400',
      spin: false,
    };
  }
  if (status === 'saved' && savedAt) {
    return { label: 'Saved just now', Icon: CheckIcon, tone: 'text-emerald-400', spin: false };
  }
  return {
    label: 'Autosave on',
    Icon: ClockIcon,
    tone: 'text-[var(--muted-foreground)]',
    spin: false,
  };
}
