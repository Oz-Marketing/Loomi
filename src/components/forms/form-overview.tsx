'use client';

import * as React from 'react';
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
  InboxStackIcon,
  PencilSquareIcon,
  Squares2X2Icon,
  EyeIcon,
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
  const [publishing, setPublishing] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<DetailTab>('overview');

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

  const togglePublish = async () => {
    if (publishing) return;
    setPublishing(true);
    const nextStatus = form.status === 'published' ? 'draft' : 'published';
    const res = await fetch(`/api/forms/${form.id}`, {
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
    const body = (await res.json()) as { form: typeof form };
    setForm(body.form);
    toast.success(nextStatus === 'published' ? 'Form published.' : 'Form moved to draft.');
  };

  const published = form.status === 'published';

  return (
    <div className="space-y-5">
      {/* Sticky header */}
      <div className="page-sticky-header">
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
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-2xl font-bold truncate">
                  {form.name || 'Untitled form'}
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
                  {form.status}
                </span>
              </div>
              <p className="text-[var(--muted-foreground)] mt-1 text-sm truncate font-mono">
                /f/{form.slug}
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
            {published && (
              <a
                href={`/f/${form.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)] hover:bg-[var(--muted)] transition-colors"
                title="Open live form in new tab"
              >
                <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                Live
              </a>
            )}
            <Link
              href={subHref(`/websites/forms/${form.id}/edit`)}
              className="inline-flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90"
            >
              <PencilSquareIcon className="w-4 h-4" />
              Edit Form
            </Link>
          </div>
        </div>
      </div>

      {/* Tab bar — Overview / Settings. Mirrors the LP detail page
          pattern; settings used to live behind a cog in the header
          but a tab makes the surface area discoverable. */}
      <div className="flex items-center gap-1 border-b border-[var(--border)]">
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

      {activeTab === 'overview' && <OverviewBody />}
      {activeTab === 'submissions' && <SubmissionsBody />}
      {activeTab === 'settings' && <FormSettingsForm />}
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
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  // Just for the stat cards — the Submissions tab's table does its own
  // fetch with pagination, independent of this summary query.
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

  const published = form.status === 'published';

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1400);
    } catch {
      /* clipboard blocked — silent */
    }
  };

  // setForm is used by child components in the future; suppress for now.
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
          value={published ? 'Live' : 'Draft'}
          Icon={CheckCircleIcon}
          bgColor={published ? 'bg-emerald-500/15' : 'bg-zinc-500/15'}
          iconColor={published ? 'text-emerald-300' : 'text-zinc-400'}
          hint={
            published
              ? 'Accepting submissions'
              : 'Submissions paused until published'
          }
        />
      </div>

      {/* Two-column body — preview + embed */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] gap-5">
        {/* The whole preview card routes into the builder on click.
            The inner FormRenderer is pointer-events:none so users
            can't accidentally interact with form fields here — the
            edit hint pill in the corner is the visible affordance. */}
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
          <div
            className="max-h-[680px] overflow-y-auto bg-[var(--muted)]/30"
            // Same renderer the public page uses, so this matches /f/<slug>.
          >
            <div className="loomi-form-preview pointer-events-none">
              <FormRenderer template={form.schema} />
            </div>
          </div>
        </Link>

        <section className="glass-card rounded-2xl p-4 h-fit">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-1.5">
              <h3 className="font-semibold">Embed</h3>
              <HelpTip title="How to embed this form">
                <p>
                  Copy the snippet below and paste it into your site&rsquo;s
                  HTML wherever you want the form to appear.
                </p>
                <ol>
                  <li>
                    Click the copy icon to grab the{' '}
                    <code>&lt;script&gt;</code> tag.
                  </li>
                  <li>
                    In your page editor, add an HTML / embed block and paste
                    the snippet. Most builders (Webflow, WordPress, Wix,
                    Framer, plain HTML) accept script tags directly.
                  </li>
                  <li>
                    Publish the page. The form renders inline and auto-resizes
                    to fit its content.
                  </li>
                </ol>
                <p>
                  Need a different format?{' '}
                  <strong>More options</strong> includes an{' '}
                  <code>&lt;iframe&gt;</code> fallback (for hosts that strip
                  scripts) and a direct shareable link.
                </p>
                <p>
                  The form must be <strong>Published</strong> for visitors to
                  submit — draft forms return a 404 on the public URL.
                </p>
              </HelpTip>
            </div>
          </div>
          <p className="text-xs text-[var(--muted-foreground)] mb-3">
            Paste this script tag where you want the form to appear.
          </p>
          <div className="relative">
            <textarea
              readOnly
              value={form.embedSnippets.script}
              rows={3}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 pr-12 font-mono text-xs text-[var(--muted-foreground)] resize-none"
            />
            <button
              type="button"
              onClick={() => void copyText('script', form.embedSnippets.script)}
              className="absolute top-2 right-2 inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              title="Copy"
              aria-label="Copy script embed"
            >
              {copiedKey === 'script' ? (
                <CheckCircleIcon className="w-4 h-4 text-emerald-400" />
              ) : (
                <ClipboardIcon className="w-4 h-4" />
              )}
            </button>
          </div>
        </section>
      </div>
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
      <SubmissionsTable formId={form.id} schema={form.schema} />
    </section>
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

// ── Publish switch ───────────────────────────────────────────────

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
        active
          ? 'bg-emerald-500'
          : 'bg-[var(--muted)] border border-[var(--border)]'
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
