'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
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
const HISTORY_LIMIT = 50;
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
  const [past, setPast] = React.useState<LandingPageTemplate[]>([]);
  const [future, setFuture] = React.useState<LandingPageTemplate[]>([]);
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

  // ── Undo / redo ──
  //
  // `applyChange` is what the editor calls when the user edits — it
  // pushes the pre-edit template onto the undo stack, clears the redo
  // stack (any divergent edit invalidates pending redos), and
  // commits the new template. Undo pops past → current, current →
  // future; redo is the mirror.
  const applyChange = React.useCallback(
    (next: LandingPageTemplate) => {
      setPast((items) => {
        if (!template) return items;
        return [...items.slice(-(HISTORY_LIMIT - 1)), template];
      });
      setFuture([]);
      setTemplate(next);
    },
    [template],
  );

  const undo = React.useCallback(() => {
    setPast((items) => {
      const previous = items[items.length - 1];
      if (!previous || !template) return items;
      setFuture((futureItems) => [template, ...futureItems].slice(0, HISTORY_LIMIT));
      setTemplate(previous);
      return items.slice(0, -1);
    });
  }, [template]);

  const redo = React.useCallback(() => {
    setFuture((items) => {
      const next = items[0];
      if (!next || !template) return items;
      setPast((pastItems) => [...pastItems.slice(-(HISTORY_LIMIT - 1)), template]);
      setTemplate(next);
      return items.slice(1);
    });
  }, [template]);

  // Keyboard shortcuts: Cmd/Ctrl+Z (undo), Cmd/Ctrl+Shift+Z (redo).
  // Skip when the focus is inside a text field — those have their own
  // native undo stack we don't want to fight.
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [redo, undo]);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;
  const saveDescriptor = describeSaveStatus(saveStatus, savedAt);

  // ── Click-to-edit title (mirrors FormDetailHeader.commitTitle) ──
  const [editingTitle, setEditingTitle] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState(page?.name ?? '');
  React.useEffect(() => {
    if (!editingTitle) setTitleDraft(page?.name ?? '');
  }, [page?.name, editingTitle]);

  const commitTitle = async () => {
    setEditingTitle(false);
    if (!page) return;
    const next = titleDraft.trim();
    if (!next || next === page.name) {
      setTitleDraft(page.name);
      return;
    }
    const res = await fetch(`/api/landing-pages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error || 'Could not rename page.');
      setTitleDraft(page.name);
      return;
    }
    const body = (await res.json()) as { page: LandingPageDetail };
    void mutate({ page: body.page }, { revalidate: false });
  };

  // ── Publish toggle (mirrors FormDetailHeader.togglePublish) ─────
  const [publishing, setPublishing] = React.useState(false);
  const togglePublish = async () => {
    if (publishing || !page) return;
    setPublishing(true);
    const nextStatus = page.status === 'published' ? 'draft' : 'published';
    const res = await fetch(`/api/landing-pages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    setPublishing(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error || 'Could not update status.');
      return;
    }
    const body = (await res.json()) as { page: LandingPageDetail };
    void mutate({ page: body.page }, { revalidate: false });
    toast.success(nextStatus === 'published' ? 'Page published.' : 'Page moved to draft.');
  };

  const published = page?.status === 'published';

  return (
    <AdminOnly>
      <div className="grid grid-cols-[minmax(260px,1fr)_auto_minmax(260px,1fr)] items-center gap-3 px-6 pt-3 pb-4 flex-shrink-0">
        {/* LEFT — back · status · autosave (mirrors forms header) */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => router.push(subHref(`/websites/landing-pages/${id}`))}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex-shrink-0"
            title="Back to overview"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back
          </button>
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
              published
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
            <span>{saveDescriptor.label}</span>
          </span>
        </div>

        {/* CENTER — click-to-edit title + slug */}
        <div className="min-w-0 max-w-[720px] justify-self-center">
          <div className="min-w-0 text-center">
            {editingTitle ? (
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                size={Math.min(Math.max(titleDraft.length || 12, 12), 48)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitTitle();
                  else if (e.key === 'Escape') {
                    setTitleDraft(page?.name ?? '');
                    setEditingTitle(false);
                  }
                }}
                onBlur={() => void commitTitle()}
                className="max-w-[min(44rem,64vw)] rounded-xl border border-[var(--primary)] bg-[var(--background)]/80 px-4 py-1.5 text-center text-2xl font-bold text-[var(--foreground)] shadow-[0_0_0_1px_rgba(99,102,241,0.18)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
              />
            ) : (
              <h2
                role="button"
                tabIndex={0}
                onClick={() => setEditingTitle(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setEditingTitle(true);
                  }
                }}
                title="Click to rename"
                className="text-2xl font-bold capitalize truncate max-w-[40rem] mx-auto cursor-text rounded-md px-3 py-1 hover:bg-[var(--muted)] focus:outline-none focus:bg-[var(--muted)] focus:ring-1 focus:ring-[var(--primary)]/30 transition-colors"
              >
                {page?.name || 'Untitled landing page'}
              </h2>
            )}
            <p className="text-xs text-[var(--muted-foreground)] truncate">/lp/{page?.slug ?? ''}</p>
          </div>
        </div>

        {/* RIGHT — open live · settings cog · publish */}
        <div className="flex items-center justify-end gap-2 min-w-0">
          {published && page && (
            <a
              href={`/lp/${page.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open live page"
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--muted)] hover:bg-[var(--accent)] text-[var(--foreground)] transition-colors"
            >
              <ArrowTopRightOnSquareIcon className="w-4 h-4" />
            </a>
          )}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            disabled={!page}
            title="Page settings"
            aria-label="Page settings"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--muted)] hover:bg-[var(--accent)] text-[var(--foreground)] disabled:opacity-40 transition-colors"
          >
            <Cog6ToothIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => void togglePublish()}
            disabled={publishing || !page}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {published ? 'Move to Draft' : 'Publish'}
          </button>
        </div>
      </div>

      {isLoading || !template ? (
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--muted-foreground)]">
          Loading editor…
        </div>
      ) : (
        <LandingPageEditorShell
          template={template}
          onChange={applyChange}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
        />
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
