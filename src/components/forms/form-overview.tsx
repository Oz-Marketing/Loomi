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
  EyeIcon,
} from '@heroicons/react/24/outline';
import { useFormDetail } from '@/components/forms/form-detail-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { FormRenderer } from '@/lib/forms/render';
import type { FormSubmissionRow } from '@/lib/services/forms';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

/**
 * Form overview page — the landing page for a single form. Mirrors the
 * Flow overview pattern (`/flows/[id]`): stat cards across the top,
 * live form preview, recent submissions list, embed snippets, and an
 * Edit Form CTA that routes into the builder.
 *
 * Data sources:
 *   - Form metadata lives in FormDetailContext (set by the parent
 *     layout's server fetch).
 *   - Submissions fetched via SWR so refreshes pick up new entries
 *     without a hard reload.
 */
export function FormOverview() {
  const { form, setForm } = useFormDetail();
  const subHref = useSubaccountHref();
  const [publishing, setPublishing] = React.useState(false);
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  const { data: submissionsPayload } = useSWR<{
    submissions: FormSubmissionRow[];
    total: number;
  }>(`/api/forms/${form.id}/submissions?pageSize=5`, fetcher, {
    revalidateOnFocus: true,
  });

  const submissions = submissionsPayload?.submissions ?? [];
  const totalSubmissions = submissionsPayload?.total ?? form.submissionCount;
  const submissionsLast7d = React.useMemo(() => {
    if (!submissionsPayload?.submissions) return null;
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return submissionsPayload.submissions.filter(
      (s) => new Date(s.createdAt).getTime() >= cutoff,
    ).length;
  }, [submissionsPayload]);
  const lastSubmissionAt = submissions[0]?.createdAt ?? null;

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

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1400);
    } catch {
      // Clipboard denied — fall back to manual select.
    }
  };

  const published = form.status === 'published';

  return (
    <div className="space-y-5">
      {/* Sticky header — same shape as flow overview */}
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
            <Link
              href={subHref(`/websites/forms/${form.id}/settings`)}
              className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              aria-label="Form settings"
              title="Settings"
            >
              <Cog6ToothIcon className="w-5 h-5" />
            </Link>
            <Link
              href={subHref(`/websites/forms/${form.id}/submissions`)}
              className="inline-flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)] hover:bg-[var(--muted)] transition-colors"
            >
              <InboxStackIcon className="w-4 h-4" />
              Submissions
            </Link>
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
          hint={lastSubmissionAt ? new Date(lastSubmissionAt).toLocaleString() : 'No submissions yet'}
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

      {/* Two-column body: preview on the left, submissions + embed on the right */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] gap-5">
        <section className="glass-card rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <div>
              <h3 className="font-semibold">Preview</h3>
              <p className="text-xs text-[var(--muted-foreground)]">
                How visitors see the form. Open the live URL to test submission.
              </p>
            </div>
            <Link
              href={subHref(`/websites/forms/${form.id}/edit`)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
            >
              <PencilSquareIcon className="w-3.5 h-3.5" />
              Edit
            </Link>
          </div>
          <div
            className="max-h-[680px] overflow-y-auto bg-[var(--muted)]/30"
            // The preview re-uses the same renderer the public page does,
            // so what users see here is exactly what /f/<slug> serves.
          >
            <div className="loomi-form-preview pointer-events-none">
              <FormRenderer template={form.schema} />
            </div>
          </div>
        </section>

        <div className="space-y-5">
          {/* Recent submissions */}
          <section className="glass-card rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div>
                <h3 className="font-semibold">Recent submissions</h3>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Last {submissions.length || 0} of {totalSubmissions.toLocaleString()}
                </p>
              </div>
              {totalSubmissions > 0 && (
                <Link
                  href={subHref(`/websites/forms/${form.id}/submissions`)}
                  className="text-xs text-[var(--primary)] hover:underline"
                >
                  View all →
                </Link>
              )}
            </div>
            {submissions.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <div className="w-12 h-12 rounded-2xl bg-[var(--muted)] flex items-center justify-center mx-auto mb-3">
                  <InboxStackIcon className="w-6 h-6 text-[var(--muted-foreground)]" />
                </div>
                <p className="text-sm font-medium">No submissions yet</p>
                <p className="text-xs text-[var(--muted-foreground)] mt-1">
                  {published
                    ? 'Share the form link or embed it to start collecting.'
                    : 'Publish the form to start collecting submissions.'}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {submissions.map((s) => {
                  const label =
                    s.contact?.fullName ||
                    s.contact?.email ||
                    s.contact?.phone ||
                    'Anonymous';
                  return (
                    <li
                      key={s.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-4 py-3 text-sm hover:bg-[var(--muted)]/40"
                    >
                      <span className="truncate">{label}</span>
                      <span className="text-xs text-[var(--muted-foreground)] whitespace-nowrap">
                        {formatRelativeTime(s.createdAt)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Embed quick-copy */}
          <section className="glass-card rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="font-semibold">Embed</h3>
              <Link
                href={subHref(`/websites/forms/${form.id}/settings`)}
                className="text-xs text-[var(--muted-foreground)] hover:text-[var(--primary)]"
              >
                More options →
              </Link>
            </div>
            <p className="text-xs text-[var(--muted-foreground)] mb-3">
              Paste this script tag where you want the form to appear.
            </p>
            <div className="relative">
              <textarea
                readOnly
                value={form.embedSnippets.script}
                rows={2}
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
      </div>
    </div>
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

// ── Publish switch (matches Flows overview pattern) ──────────────

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
