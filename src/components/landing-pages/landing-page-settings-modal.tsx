'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ExclamationTriangleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import type { LandingPageDetail } from '@/lib/services/landing-pages';

interface LandingPageSettingsModalProps {
  open: boolean;
  onClose: () => void;
  page: LandingPageDetail | null;
  /** Called whenever a PATCH succeeds so the parent can refresh its
   *  copy of the LP (typically via SWR.mutate or setForm). */
  onUpdated?: (page: LandingPageDetail) => void;
}

/**
 * Self-contained settings modal — name, slug, status, SEO, danger
 * zone. PATCHes /api/landing-pages/[id] on blur for each field and
 * surfaces success/failure via toasts.
 *
 * Mirrors FormSettingsForm's shape but smaller (no submission-related
 * fields, no embed snippets — those live on the overview).
 */
export function LandingPageSettingsModal({
  open,
  onClose,
  page,
  onUpdated,
}: LandingPageSettingsModalProps) {
  const router = useRouter();
  const subHref = useSubaccountHref();
  const [draft, setDraft] = React.useState({
    name: '',
    slug: '',
    status: 'draft' as 'draft' | 'published',
    seoTitle: '',
    seoDescription: '',
    ogImageUrl: '',
  });
  const [saving, setSaving] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    if (page) {
      setDraft({
        name: page.name,
        slug: page.slug,
        status: page.status,
        seoTitle: page.seoTitle ?? '',
        seoDescription: page.seoDescription ?? '',
        ogImageUrl: page.ogImageUrl ?? '',
      });
    }
  }, [page]);

  // Esc to close.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving && !deleting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, deleting, onClose]);

  if (!open || !page) return null;

  async function patch(key: string, value: unknown) {
    if (!page) return;
    setSaving(key);
    try {
      const res = await fetch(`/api/landing-pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Update failed');
        // Revert local draft for this field.
        setDraft((d) => ({
          ...d,
          name: page.name,
          slug: page.slug,
          status: page.status,
          seoTitle: page.seoTitle ?? '',
          seoDescription: page.seoDescription ?? '',
          ogImageUrl: page.ogImageUrl ?? '',
        }));
        return;
      }
      onUpdated?.(payload.page);
      if (key === 'slug' && payload.page.slug !== value) {
        toast.success(`Slug adjusted to ${payload.page.slug} to keep it unique.`);
      } else {
        toast.success('Saved.');
      }
    } finally {
      setSaving(null);
    }
  }

  async function deleteCurrent() {
    if (!page) return;
    const ok = window.confirm(
      `Delete "${page.name || 'Untitled'}"? This is permanent.`,
    );
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/landing-pages/${page.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Delete failed');
        return;
      }
      toast.success('Page deleted.');
      router.push(subHref('/websites/landing-pages'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => !saving && !deleting && onClose()}
    >
      <div
        className="glass-modal w-[640px] max-w-[calc(100vw-3rem)] flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-6 py-5 border-b border-[var(--border)] flex-shrink-0">
          <div>
            <h3 className="text-lg font-semibold">Page settings</h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Edit name, slug, publish status, and SEO metadata.
            </p>
          </div>
          <button
            type="button"
            onClick={() => !saving && !deleting && onClose()}
            disabled={!!saving || deleting}
            aria-label="Close"
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </header>

        <div className="px-6 py-5 space-y-6 overflow-y-auto">
          {/* Basics */}
          <section>
            <SectionLabel>Basics</SectionLabel>
            <div className="space-y-4">
              <Field label="Name">
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  onBlur={() => {
                    if (draft.name.trim() && draft.name !== page.name) {
                      void patch('name', draft.name);
                    }
                  }}
                  className={inputClass}
                />
              </Field>
              <Field label="Slug">
                <input
                  value={draft.slug}
                  onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))}
                  onBlur={() => {
                    if (draft.slug.trim() && draft.slug !== page.slug) {
                      void patch('slug', draft.slug);
                    }
                  }}
                  className={inputClass}
                />
                <p className="mt-1 text-[11px] text-[var(--muted-foreground)] font-mono">
                  {page.publicUrl}
                </p>
              </Field>

              <label className="flex items-center justify-between rounded-xl border border-[var(--border)] px-3 py-3">
                <span>
                  <span className="block text-sm font-medium">Status</span>
                  <span className="block text-xs text-[var(--muted-foreground)]">
                    Draft pages return a 404 on the public URL.
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.status === 'published'}
                  onClick={() => {
                    const next = draft.status === 'published' ? 'draft' : 'published';
                    setDraft((d) => ({ ...d, status: next }));
                    void patch('status', next);
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    draft.status === 'published'
                      ? 'bg-green-500'
                      : 'bg-[var(--muted)] border border-[var(--border)]'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      draft.status === 'published' ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </label>
            </div>
          </section>

          {/* SEO */}
          <section>
            <SectionLabel>SEO & sharing</SectionLabel>
            <div className="space-y-4">
              <Field
                label="Page title"
                hint="Appears in the browser tab and on search-engine results."
              >
                <input
                  value={draft.seoTitle}
                  onChange={(e) => setDraft((d) => ({ ...d, seoTitle: e.target.value }))}
                  onBlur={() => {
                    if (draft.seoTitle !== (page.seoTitle ?? '')) {
                      void patch('seoTitle', draft.seoTitle);
                    }
                  }}
                  placeholder="Falls back to the first heading on the page"
                  className={inputClass}
                />
              </Field>
              <Field
                label="Meta description"
                hint="The blurb shown under the title in search results and link previews."
              >
                <textarea
                  rows={2}
                  value={draft.seoDescription}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, seoDescription: e.target.value }))
                  }
                  onBlur={() => {
                    if (draft.seoDescription !== (page.seoDescription ?? '')) {
                      void patch('seoDescription', draft.seoDescription);
                    }
                  }}
                  className={inputClass}
                />
              </Field>
              <Field
                label="Social share image (OG)"
                hint="1200×630 image used by Slack, Twitter, iMessage previews."
              >
                <input
                  type="url"
                  value={draft.ogImageUrl}
                  onChange={(e) => setDraft((d) => ({ ...d, ogImageUrl: e.target.value }))}
                  onBlur={() => {
                    if (draft.ogImageUrl !== (page.ogImageUrl ?? '')) {
                      void patch('ogImageUrl', draft.ogImageUrl);
                    }
                  }}
                  placeholder="https://…/og.png"
                  className={inputClass}
                />
              </Field>
            </div>
          </section>

          {/* Danger zone */}
          <section className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
            <div className="flex items-start gap-2 mb-3">
              <ExclamationTriangleIcon className="mt-0.5 w-5 h-5 text-rose-400" />
              <div>
                <h2 className="font-semibold text-rose-300 text-sm">Danger zone</h2>
                <p className="mt-0.5 text-xs text-rose-200/80">
                  Deleting a page removes it permanently. The public URL will 404.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={deleteCurrent}
              disabled={deleting}
              className="w-full rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete page'}
            </button>
          </section>

          {saving && (
            <p className="text-center text-xs text-[var(--muted-foreground)]">
              Saving {saving}…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] mb-3">
      {children}
    </h4>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium mb-1">{label}</span>
      {children}
      {hint ? (
        <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{hint}</p>
      ) : null}
    </label>
  );
}

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30';
