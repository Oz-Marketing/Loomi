'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowTopRightOnSquareIcon,
  ArrowUpTrayIcon,
  ClockIcon,
  EllipsisVerticalIcon,
  InboxStackIcon,
  PencilSquareIcon,
  Square2StackIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { FormSummary } from '@/lib/services/forms';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { FormPreviewThumbnail } from '@/components/forms/form-preview-thumbnail';

interface FormCardProps {
  form: FormSummary;
  accountName?: string;
  onDelete?: (form: FormSummary) => void;
  /** Save this live form's design as a reusable template (forms only). */
  onSaveAsTemplate?: (form: FormSummary) => void;
  /** Deploy this template into sub-account(s) as live forms (templates only). */
  onDeploy?: (form: FormSummary) => void;
  /**
   * 'template' renders the card for the Templates gallery: the whole card
   * links straight to the editor and the live-form meta (public slug,
   * submission count) is hidden.
   */
  variant?: 'form' | 'template';
}

function formatRelativeDate(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  if (diffMs < hour) return 'just now';
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  const days = Math.floor(diffMs / day);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Form card. Mirrors the email template card shape: a live preview
 * thumbnail at the top, a meta strip at the bottom with name +
 * 3-dot menu.
 *
 * The whole card is a link to the form's overview; the menu stops
 * propagation so it doesn't follow the link.
 */
export function FormCard({
  form,
  accountName,
  onDelete,
  onSaveAsTemplate,
  onDeploy,
  variant = 'form',
}: FormCardProps) {
  const subHref = useSubaccountHref();
  const isTemplate = variant === 'template';
  const editHref = subHref(`/websites/forms/${form.id}/edit`);
  // Template cards jump straight into the editor; live forms open the overview.
  const cardHref = isTemplate ? editHref : subHref(`/websites/forms/${form.id}`);

  return (
    <div className="glass-card group relative rounded-xl overflow-hidden transition-all hover:border-[var(--primary)]/40 hover:shadow-lg">
      {/* Full-card click target — the menu / toggle stopPropagation so
          they don't double-trigger as a navigation event. */}
      <Link
        href={cardHref}
        className="absolute inset-0 z-0"
        aria-label={`Open ${form.name || 'Untitled form'}`}
      />

      {/* Preview thumbnail — pointer-events disabled so clicks fall
          through to the absolute Link underneath. */}
      <div className="relative pointer-events-none">
        <FormPreviewThumbnail template={form.schema} height={200} />
      </div>

      {/* Meta strip — non-interactive areas pass clicks through to
          the Link; only the toggle + menu opt back in. */}
      <div className="relative z-10 p-3 border-t border-[var(--border)] bg-[var(--card)]/70 backdrop-blur-sm pointer-events-none">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <h3
              className="text-sm font-semibold truncate text-[var(--foreground)]"
              title={form.name}
            >
              {form.name || 'Untitled form'}
            </h3>
            {!isTemplate && (
              <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)] font-mono truncate">
                /f/{form.slug}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1 flex-shrink-0 pointer-events-auto">
            <CardMenu
              form={form}
              editHref={editHref}
              editLabel={isTemplate ? 'Edit template' : 'Edit form'}
              showLiveLink={!isTemplate}
              onSaveAsTemplate={isTemplate ? undefined : onSaveAsTemplate}
              onDeploy={isTemplate ? onDeploy : undefined}
              onDelete={onDelete}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-[var(--muted-foreground)]">
          {!isTemplate && (
            <span className="inline-flex items-center gap-1">
              <InboxStackIcon className="w-3 h-3" />
              <span className="tabular-nums">
                {form.submissionCount.toLocaleString()}
              </span>
              <span className="text-[var(--muted-foreground)]/60">
                {form.submissionCount === 1 ? 'submission' : 'submissions'}
              </span>
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="w-3 h-3" />
            {formatRelativeDate(form.updatedAt)}
          </span>
          {accountName && (
            <span className="truncate text-[var(--muted-foreground)]/60">
              · {accountName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 3-dot menu ──────────────────────────────────────────────────

function CardMenu({
  form,
  editHref,
  editLabel = 'Edit form',
  showLiveLink = true,
  onSaveAsTemplate,
  onDeploy,
  onDelete,
}: {
  form: FormSummary;
  editHref: string;
  editLabel?: string;
  showLiveLink?: boolean;
  onSaveAsTemplate?: (form: FormSummary) => void;
  onDeploy?: (form: FormSummary) => void;
  onDelete?: (form: FormSummary) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
      >
        <EllipsisVerticalIcon className="w-4 h-4" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 w-52 glass-dropdown shadow-lg p-1"
          onClick={(e) => e.stopPropagation()}
        >
          <Link
            href={editHref}
            className="flex items-center gap-2 px-2.5 py-2 text-xs rounded-md text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            onClick={() => setOpen(false)}
          >
            <PencilSquareIcon className="w-3.5 h-3.5" />
            {editLabel}
          </Link>
          {showLiveLink && (
            <a
              href={`/f/${form.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-2.5 py-2 text-xs rounded-md text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              onClick={() => setOpen(false)}
            >
              <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
              Open live form
            </a>
          )}
          {onSaveAsTemplate && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                onSaveAsTemplate(form);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-xs rounded-md text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <Square2StackIcon className="w-3.5 h-3.5" />
              Save as template
            </button>
          )}
          {onDeploy && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                onDeploy(form);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-xs rounded-md text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors whitespace-nowrap"
            >
              <ArrowUpTrayIcon className="w-3.5 h-3.5 flex-shrink-0" />
              Deploy to sub-account
            </button>
          )}
          {onDelete && (
            <>
              <div className="my-1 h-px bg-[var(--border)]" />
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                  onDelete(form);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-xs rounded-md text-rose-300 hover:bg-rose-500/10 transition-colors"
              >
                <TrashIcon className="w-3.5 h-3.5" />
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
