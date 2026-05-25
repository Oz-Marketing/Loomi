'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ClipboardIcon,
  ClockIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  PencilSquareIcon,
  RectangleStackIcon,
} from '@heroicons/react/24/outline';
import { AdminOnly } from '@/components/route-guard';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { LandingPagePreviewThumbnail } from '@/components/landing-pages/landing-page-preview-thumbnail';
import { LandingPageSettingsModal } from '@/components/landing-pages/landing-page-settings-modal';
import { HelpTip } from '@/components/ui/help-tip';
import type { LandingPageDetail } from '@/lib/services/landing-pages';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

export default function LandingPageOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const subHref = useSubaccountHref();
  const { data, mutate, isLoading } = useSWR<{ page: LandingPageDetail }>(
    `/api/landing-pages/${id}`,
    fetcher,
  );

  // Refetch on mount so a builder ↔ overview round-trip always sees
  // the latest server state (same pattern as the form overview).
  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/landing-pages/${id}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled || !payload?.page) return;
        const serverAt = new Date(payload.page.updatedAt).getTime();
        const localAt = new Date(data?.page?.updatedAt ?? 0).getTime();
        if (serverAt > localAt) void mutate({ page: payload.page }, { revalidate: false });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  const page = data?.page;

  async function togglePublish() {
    if (!page || publishing) return;
    const next = page.status === 'published' ? 'draft' : 'published';
    setPublishing(true);
    try {
      const res = await fetch(`/api/landing-pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Could not update status.');
        return;
      }
      await mutate({ page: payload.page }, { revalidate: false });
      toast.success(next === 'published' ? 'Page published.' : 'Page moved to draft.');
    } finally {
      setPublishing(false);
    }
  }

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1400);
    } catch {
      /* clipboard blocked — silent */
    }
  }

  if (isLoading || !page) {
    return (
      <AdminOnly>
        <div className="px-8 py-12 max-w-6xl mx-auto text-sm text-[var(--muted-foreground)]">
          Loading…
        </div>
      </AdminOnly>
    );
  }

  const published = page.status === 'published';
  const iframeSnippet = `<iframe src="${page.publicUrl}" width="100%" height="800" frameborder="0" style="border:0;width:100%;" loading="lazy" allowfullscreen></iframe>`;

  return (
    <AdminOnly>
      <div className="px-8 py-8 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={subHref('/websites/landing-pages')}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors flex-shrink-0"
              aria-label="Back to landing pages"
            >
              <ArrowLeftIcon className="w-4 h-4" />
            </Link>
            <RectangleStackIcon className="w-7 h-7 text-[var(--primary)] flex-shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-2xl font-bold truncate capitalize">
                  {page.name || 'Untitled landing page'}
                </h2>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    published
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'bg-zinc-500/10 text-zinc-300'
                  }`}
                >
                  {published ? (
                    <CheckCircleIcon className="w-3 h-3" />
                  ) : (
                    <DocumentTextIcon className="w-3 h-3" />
                  )}
                  {page.status}
                </span>
              </div>
              <p className="mt-1 text-sm text-[var(--muted-foreground)] truncate font-mono">
                /lp/{page.slug}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="flex items-center gap-2 mr-1">
              <span className="text-xs text-[var(--muted-foreground)]">
                {published ? 'Published' : 'Draft'}
              </span>
              <PublishSwitch
                active={published}
                updating={publishing}
                onToggle={() => void togglePublish()}
              />
            </div>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Page settings"
              title="Settings"
              className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <Cog6ToothIcon className="w-5 h-5" />
            </button>
            {published && (
              <a
                href={`/lp/${page.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)] hover:bg-[var(--muted)] transition-colors"
                title="Open live page in new tab"
              >
                <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                Live
              </a>
            )}
            <Link
              href={subHref(`/websites/landing-pages/${page.id}/edit`)}
              className="inline-flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90"
            >
              <PencilSquareIcon className="w-4 h-4" />
              Edit Page
            </Link>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <StatCard
            label="Status"
            value={published ? 'Published' : 'Draft'}
            Icon={published ? CheckCircleIcon : DocumentTextIcon}
            bgColor={published ? 'bg-emerald-500/15' : 'bg-zinc-500/15'}
            iconColor={published ? 'text-emerald-300' : 'text-zinc-300'}
            sub={page.publishedAt ? `since ${formatDate(page.publishedAt)}` : undefined}
          />
          <StatCard
            label="Last updated"
            value={formatDate(page.updatedAt)}
            Icon={ClockIcon}
            bgColor="bg-violet-500/15"
            iconColor="text-violet-300"
          />
          <StatCard
            label="Public URL"
            value={`/lp/${page.slug}`}
            Icon={ArrowTopRightOnSquareIcon}
            bgColor="bg-amber-500/15"
            iconColor="text-amber-300"
            mono
          />
        </div>

        {/* Body: preview + share */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
          {/* Preview card — clickable; routes into the builder. */}
          <Link
            href={subHref(`/websites/landing-pages/${page.id}/edit`)}
            className="glass-card group rounded-2xl overflow-hidden hover:border-[var(--primary)]/40 transition-colors block"
          >
            <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">Preview</h3>
                <span className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider">
                  Click to edit
                </span>
              </div>
              <PencilSquareIcon className="w-4 h-4 text-[var(--muted-foreground)] group-hover:text-[var(--primary)]" />
            </div>
            <div className="loomi-lp-preview pointer-events-none">
              <LandingPagePreviewThumbnail template={page.schema} height={520} />
            </div>
          </Link>

          {/* Share / embed section */}
          <section className="glass-card rounded-2xl p-4 h-fit space-y-5">
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-semibold">Share</h3>
                <HelpTip title="Sharing this landing page">
                  <p>
                    A published landing page lives at a stable URL — share it
                    anywhere a link works (email, SMS, socials, etc.).
                  </p>
                  <p>
                    To embed the page <em>inside</em> another site (e.g. a
                    WordPress page), copy the iframe snippet below and paste
                    it into an HTML / embed block.
                  </p>
                  <p>
                    The page must be <strong>Published</strong> for visitors
                    to load it.
                  </p>
                </HelpTip>
              </div>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Direct link.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <a
                  href={`/lp/${page.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 truncate text-xs font-mono text-[var(--primary)] hover:underline"
                >
                  {page.publicUrl}
                </a>
                <button
                  type="button"
                  onClick={() => void copy('url', page.publicUrl)}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
                  aria-label="Copy URL"
                >
                  {copiedKey === 'url' ? (
                    <CheckCircleIcon className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <ClipboardIcon className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="border-t border-[var(--border)] pt-4">
              <h4 className="text-xs font-semibold mb-1">Embed (iframe)</h4>
              <p className="text-[11px] text-[var(--muted-foreground)] mb-2">
                Use when you want the page to render inside another site.
              </p>
              <div className="relative">
                <textarea
                  readOnly
                  value={iframeSnippet}
                  rows={3}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 pr-12 font-mono text-[11px] text-[var(--muted-foreground)] resize-none"
                />
                <button
                  type="button"
                  onClick={() => void copy('iframe', iframeSnippet)}
                  className="absolute top-2 right-2 inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
                  aria-label="Copy iframe"
                >
                  {copiedKey === 'iframe' ? (
                    <CheckCircleIcon className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <ClipboardIcon className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <LandingPageSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        page={page}
        onUpdated={(next) => void mutate({ page: next }, { revalidate: false })}
      />
    </AdminOnly>
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function formatDate(input: string | Date): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function PublishSwitch({
  active,
  updating,
  onToggle,
}: {
  active: boolean;
  updating: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      disabled={updating}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
        active ? 'bg-emerald-500' : 'bg-[var(--muted)] border border-[var(--border)]'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          active ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function StatCard({
  label,
  value,
  Icon,
  bgColor,
  iconColor,
  sub,
  mono,
}: {
  label: string;
  value: string;
  Icon: React.ComponentType<{ className?: string }>;
  bgColor: string;
  iconColor: string;
  sub?: string;
  mono?: boolean;
}) {
  return (
    <div className="glass-card rounded-2xl p-4 flex items-start gap-3">
      <div className={`w-9 h-9 rounded-lg ${bgColor} flex items-center justify-center flex-shrink-0`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
          {label}
        </div>
        <div
          className={`mt-0.5 text-base font-semibold ${mono ? 'font-mono text-sm' : ''} truncate`}
        >
          {value}
        </div>
        {sub ? (
          <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)] truncate">
            {sub}
          </div>
        ) : null}
      </div>
    </div>
  );
}
