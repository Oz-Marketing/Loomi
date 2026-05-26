'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowTopRightOnSquareIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  EllipsisVerticalIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { LandingPageSummary } from '@/lib/services/landing-pages';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { LandingPagePreviewThumbnail } from '@/components/landing-pages/landing-page-preview-thumbnail';

interface LandingPageCardProps {
  page: LandingPageSummary;
  accountName?: string;
  onTogglePublish?: (page: LandingPageSummary, next: 'published' | 'draft') => void;
  onDuplicate?: (page: LandingPageSummary) => void;
  onDelete?: (page: LandingPageSummary) => void;
  isPublishUpdating?: boolean;
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
 * Card with preview thumbnail + meta strip. Mirrors FormCard. The
 * whole card is a Link to the LP's overview; the publish toggle and
 * 3-dot menu opt back into pointer events so they don't double-fire
 * as a navigation.
 */
export function LandingPageCard({
  page,
  accountName,
  onTogglePublish,
  onDuplicate,
  onDelete,
  isPublishUpdating = false,
}: LandingPageCardProps) {
  const subHref = useSubaccountHref();
  const published = page.status === 'published';
  const overviewHref = subHref(`/websites/landing-pages/${page.id}`);

  return (
    <div className="glass-card group relative rounded-xl overflow-hidden transition-all hover:border-[var(--primary)]/40 hover:shadow-lg">
      <Link
        href={overviewHref}
        className="absolute inset-0 z-0"
        aria-label={`Open ${page.name || 'Untitled landing page'}`}
      />

      <div className="relative pointer-events-none">
        <LandingPagePreviewThumbnail template={page.schema} height={220} />

        <span
          className={`absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium capitalize backdrop-blur-sm ${
            published ? 'bg-emerald-500/90 text-white' : 'bg-black/40 text-zinc-100'
          }`}
        >
          {page.status}
        </span>
      </div>

      <div className="relative z-10 p-3 border-t border-[var(--border)] bg-[var(--card)]/70 backdrop-blur-sm pointer-events-none">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <h3
              className="text-sm font-semibold truncate text-[var(--foreground)]"
              title={page.name}
            >
              {page.name || 'Untitled landing page'}
            </h3>
            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)] font-mono truncate">
              /lp/{page.slug}
            </p>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0 pointer-events-auto">
            {onTogglePublish && (
              <PublishSwitch
                active={published}
                disabled={isPublishUpdating}
                onToggle={(next) => onTogglePublish(page, next)}
              />
            )}
            <CardMenu
              page={page}
              editHref={subHref(`/websites/landing-pages/${page.id}/edit`)}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-[var(--muted-foreground)]">
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="w-3 h-3" />
            {formatRelativeDate(page.updatedAt)}
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

function PublishSwitch({
  active,
  disabled,
  onToggle,
}: {
  active: boolean;
  disabled: boolean;
  onToggle: (next: 'published' | 'draft') => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={active ? 'Move to draft' : 'Publish landing page'}
      title={active ? 'Move to draft' : 'Publish landing page'}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(active ? 'draft' : 'published');
      }}
      className={`relative inline-flex w-8 h-[18px] rounded-full transition-colors disabled:opacity-50 ${
        active ? 'bg-emerald-500' : 'bg-[var(--muted-foreground)]/30'
      }`}
    >
      <span
        className="absolute top-[2px] w-3.5 h-3.5 rounded-full bg-white shadow transition-[left] duration-150 ease-out"
        style={{ left: active ? '16px' : '2px' }}
      />
    </button>
  );
}

function CardMenu({
  page,
  editHref,
  onDuplicate,
  onDelete,
}: {
  page: LandingPageSummary;
  editHref: string;
  onDuplicate?: (page: LandingPageSummary) => void;
  onDelete?: (page: LandingPageSummary) => void;
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

  const published = page.status === 'published';

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
          className="absolute right-0 top-full mt-1 z-50 w-44 glass-dropdown shadow-lg p-1"
          onClick={(e) => e.stopPropagation()}
        >
          <Link
            href={editHref}
            className="flex items-center gap-2 px-2.5 py-2 text-xs rounded-md text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            onClick={() => setOpen(false)}
          >
            <PencilSquareIcon className="w-3.5 h-3.5" />
            Edit page
          </Link>
          {published && (
            <a
              href={`/lp/${page.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-2.5 py-2 text-xs rounded-md text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              onClick={() => setOpen(false)}
            >
              <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
              Open live page
            </a>
          )}
          {onDuplicate && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                onDuplicate(page);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-xs rounded-md text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <DocumentDuplicateIcon className="w-3.5 h-3.5" />
              Duplicate
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
                  onDelete(page);
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
