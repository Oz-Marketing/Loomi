'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import useSWR from 'swr';
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ClipboardIcon,
  ClockIcon,
  CodeBracketIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  InboxStackIcon,
  PencilSquareIcon,
  Squares2X2Icon,
  EyeIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useFormDetail } from '@/components/forms/form-detail-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { FormRenderer } from '@/lib/forms/render';
import { FormSettingsForm } from '@/components/forms/form-settings-form';
import { SubmissionsTable } from '@/components/forms/submissions-table';
import { HelpTip } from '@/components/ui/help-tip';
import type { FormSubmissionRow } from '@/lib/services/forms';

type DetailTab = 'overview' | 'submissions' | 'settings';
const TABS: { key: DetailTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'overview', label: 'Overview', icon: Squares2X2Icon },
  { key: 'submissions', label: 'Submissions', icon: InboxStackIcon },
  { key: 'settings', label: 'Settings', icon: Cog6ToothIcon },
];

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

/**
 * Form overview page — the landing page for a single form. Mirrors the
 * Flow overview pattern (`/flows/[id]`), split across three tabs:
 * Overview (stat cards + live preview + embed snippet), Submissions
 * (the full submissions table), and Settings (the settings form).
 */
export function FormOverview() {
  const { form, setForm } = useFormDetail();
  const subHref = useSubaccountHref();
  const [activeTab, setActiveTab] = React.useState<DetailTab>('overview');
  const [embedOpen, setEmbedOpen] = React.useState(false);

  // Refetch fresh form data on every mount. Necessary because the
  // FormDetailProvider stays mounted across overview ↔ builder
  // navigation, so its in-memory `form` can lag the database when the
  // builder's autosave was still in flight (or completed via the
  // unmount keepalive) at the moment the user clicked Back.
  //
  // Critical: only adopt the server response when it's STRICTLY newer
  // than the local copy. The builder's optimistic unmount-flush bumps
  // schema but not updatedAt, so a fetch that races a still-in-flight
  // keepalive PATCH would return the pre-edit snapshot with the same
  // updatedAt — a `>=` guard would happily overwrite the optimistic
  // schema with the stale one, making the change "disappear" when the
  // user re-opens the editor.
  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/forms/${form.id}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled || !payload?.form) return;
        const serverAt = new Date(payload.form.updatedAt).getTime();
        const localAt = new Date(form.updatedAt).getTime();
        if (serverAt > localAt) setForm(payload.form);
      })
      .catch(() => {
        /* offline / 404 — fall back to whatever the context already has */
      });
    return () => {
      cancelled = true;
    };
    // Mount-only; we intentionally don't re-run when `form.updatedAt`
    // moves, to avoid a feedback loop with the setForm call inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.id]);

  return (
    <div className="space-y-5">
      {/* Sticky header */}
      <div className="page-sticky-header has-tabs">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={subHref('/websites/forms')}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors flex-shrink-0"
              aria-label="Back to forms"
            >
              <ArrowLeftIcon className="w-4 h-4" />
            </Link>
            <DocumentTextIcon className="w-7 h-7 text-[var(--primary)] flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="text-2xl font-bold truncate">
                {form.name || 'Untitled form'}
              </h2>
              <p className="text-[var(--muted-foreground)] mt-1 text-sm truncate font-mono">
                /f/{form.slug}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <a
              href={`/f/${form.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)] hover:bg-[var(--muted)] transition-colors"
              title="Open live form in new tab"
            >
              <ArrowTopRightOnSquareIcon className="w-4 h-4" />
              Preview
            </a>
            <button
              type="button"
              onClick={() => setEmbedOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)] hover:bg-[var(--muted)] transition-colors"
            >
              <CodeBracketIcon className="w-4 h-4" />
              Embed
            </button>
            <Link
              href={subHref(`/websites/forms/${form.id}/edit`)}
              className="inline-flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90"
            >
              <PencilSquareIcon className="w-4 h-4" />
              Edit Form
            </Link>
          </div>
        </div>

      {/* Tab bar — pinned inside the sticky header so it doesn't scroll away. */}
      <div className="mt-4 flex items-center gap-1 border-b border-[var(--border)]">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active
                  ? 'border-[var(--primary)] text-[var(--foreground)]'
                  : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>
      </div>

      {activeTab === 'overview' && <OverviewBody />}
      {activeTab === 'submissions' && <SubmissionsBody />}
      {activeTab === 'settings' && <FormSettingsForm />}

      {embedOpen && <EmbedPopup onClose={() => setEmbedOpen(false)} />}
    </div>
  );
}

/**
 * Overview-tab body — the form's stat cards, live preview, and embed
 * snippet. The submissions table lives on its own tab (SubmissionsBody).
 * Lifted out so the tab switch in FormOverview stays declarative; state
 * still lives in the parent via `useFormDetail()`.
 */
function OverviewBody() {
  const { form, setForm } = useFormDetail();
  const subHref = useSubaccountHref();

  const { data: submissionsPayload } = useSWR<{
    submissions: FormSubmissionRow[];
    total: number;
  }>(`/api/forms/${form.id}/submissions?pageSize=20`, fetcher, {
    revalidateOnFocus: true,
  });

  const totalSubmissions = submissionsPayload?.total ?? form.submissionCount;
  const submissionsLast7d = React.useMemo(() => {
    if (!submissionsPayload?.submissions) return null;
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return submissionsPayload.submissions.filter(
      (s) => new Date(s.createdAt).getTime() >= cutoff,
    ).length;
  }, [submissionsPayload]);
  const lastSubmissionAt = submissionsPayload?.submissions?.[0]?.createdAt ?? null;

  void setForm;

  return (
    <>
      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Total submissions"
          value={totalSubmissions.toLocaleString()}
          Icon={InboxStackIcon}
          bgColor="bg-violet-500/15"
          iconColor="text-violet-300"
        />
        <StatCard
          label="Last 7 days"
          value={submissionsLast7d === null ? '—' : submissionsLast7d.toLocaleString()}
          Icon={ClockIcon}
          bgColor="bg-sky-500/15"
          iconColor="text-sky-300"
          hint={submissionsLast7d === null ? 'Loading…' : undefined}
        />
        <StatCard
          label="Last submission"
          value={lastSubmissionAt ? formatRelativeTime(lastSubmissionAt) : '—'}
          Icon={EyeIcon}
          bgColor="bg-emerald-500/15"
          iconColor="text-emerald-300"
          hint={
            lastSubmissionAt
              ? new Date(lastSubmissionAt).toLocaleString()
              : 'No submissions yet'
          }
        />
        <StatCard
          label="Status"
          value="Live"
          Icon={CheckCircleIcon}
          bgColor="bg-emerald-500/15"
          iconColor="text-emerald-300"
          hint="Accepting submissions"
        />
      </div>

      {/* Full-width preview card */}
      <Link
        href={subHref(`/websites/forms/${form.id}/edit`)}
        aria-label="Edit form in builder"
        className="glass-card group relative rounded-2xl overflow-hidden block transition-shadow hover:shadow-lg hover:border-[var(--primary)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h3 className="font-semibold">Preview</h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              Click anywhere on the preview to edit the form.
            </p>
          </div>
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
            aria-hidden="true"
          >
            <PencilSquareIcon className="w-3.5 h-3.5" />
            Edit
          </span>
        </div>
        <div className="max-h-[680px] overflow-y-auto bg-[var(--muted)]/30">
          <div className="loomi-form-preview pointer-events-none">
            <FormRenderer template={form.schema} />
          </div>
        </div>
      </Link>
    </>
  );
}

/**
 * Submissions-tab body — the full submissions table. The data fetch,
 * pagination, and CSV export all live in the table component itself, so
 * this tab is a thin wrapper that just feeds it the form id + schema.
 */
function SubmissionsBody() {
  const { form } = useFormDetail();
  return (
    <section>
      <SubmissionsTable formId={form.id} schema={form.schema} accountKey={form.accountKey} />
    </section>
  );
}

// ── Embed popup ──────────────────────────────────────────────────

function EmbedPopup({ onClose }: { onClose: () => void }) {
  const { form } = useFormDetail();
  const [copied, setCopied] = React.useState<string | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1400);
    } catch { /* clipboard blocked */ }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="glass-modal w-full max-w-lg flex flex-col max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Embed form"
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <CodeBracketIcon className="w-5 h-5 text-[var(--primary)]" />
            <div>
              <h3 className="text-lg font-semibold">Embed</h3>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                Pick a snippet and paste it into your site&apos;s HTML.
              </p>
            </div>
            <HelpTip title="How to embed this form">
              <p>Pick the snippet that fits your page, then paste it into your site&rsquo;s HTML.</p>
              <ol>
                <li><strong>Script tag</strong> (recommended) — auto-resizes to fit the form&rsquo;s content.</li>
                <li><strong>Iframe</strong> — fixed height. Use when the host page strips <code>&lt;script&gt;</code> tags.</li>
                <li><strong>Direct link</strong> — share the hosted form URL anywhere.</li>
              </ol>
            </HelpTip>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </header>

        <div className="px-6 py-5 space-y-5">
          {/* Script tag */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold">Script tag</span>
                <span className="rounded-full bg-[var(--primary)]/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--primary)]">
                  Recommended
                </span>
              </div>
              <button
                type="button"
                onClick={() => void copyText('script', form.embedSnippets.script)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs hover:border-[var(--primary)]"
              >
                {copied === 'script' ? <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> : <ClipboardIcon className="w-3.5 h-3.5" />}
                {copied === 'script' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <textarea
              readOnly
              value={form.embedSnippets.script}
              rows={3}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 font-mono text-xs text-[var(--muted-foreground)] resize-none"
            />
            <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">Auto-resizes to fit your form&apos;s content. Best on most sites.</p>
          </div>

          {/* Iframe */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold">Iframe (fixed height)</span>
              <button
                type="button"
                onClick={() => void copyText('iframe', form.embedSnippets.iframe)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs hover:border-[var(--primary)]"
              >
                {copied === 'iframe' ? <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> : <ClipboardIcon className="w-3.5 h-3.5" />}
                {copied === 'iframe' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <textarea
              readOnly
              value={form.embedSnippets.iframe}
              rows={3}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 font-mono text-xs text-[var(--muted-foreground)] resize-none"
            />
            <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
              Use when the host page strips script tags. Edit <code className="mx-1 rounded bg-[var(--muted)] px-1 py-0.5">height</code> if needed.
            </p>
          </div>

          {/* Direct link */}
          <div className="border-t border-[var(--border)] pt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold">Direct link</span>
              <button
                type="button"
                onClick={() => void copyText('url', form.embedSnippets.publicUrl)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs hover:border-[var(--primary)]"
              >
                {copied === 'url' ? <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> : <ClipboardIcon className="w-3.5 h-3.5" />}
                {copied === 'url' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <a
              href={form.embedSnippets.publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block break-all text-xs font-mono text-[var(--primary)] hover:underline"
            >
              {form.embedSnippets.publicUrl}
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Stat card ────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  hint,
  Icon,
  bgColor,
  iconColor,
}: {
  label: string;
  value: string;
  hint?: string;
  Icon: React.ComponentType<{ className?: string }>;
  bgColor: string;
  iconColor: string;
}) {
  return (
    <div className="glass-card rounded-xl p-4">
      <div className={`w-8 h-8 rounded-lg ${bgColor} flex items-center justify-center mb-2`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <p className="text-2xl font-bold mt-1 truncate" title={value}>
        {value}
      </p>
      {hint && (
        <p className="text-[11px] text-[var(--muted-foreground)] mt-1 truncate" title={hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diffMs < min) return 'just now';
  if (diffMs < hour) return `${Math.floor(diffMs / min)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  const days = Math.floor(diffMs / day);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
