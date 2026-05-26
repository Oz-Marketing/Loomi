'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowTopRightOnSquareIcon,
  DocumentDuplicateIcon,
  EllipsisVerticalIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { LandingPageSummary } from '@/lib/services/landing-pages';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';

interface LandingPagesTableProps {
  pages: LandingPageSummary[];
  onTogglePublish?: (page: LandingPageSummary, next: 'published' | 'draft') => void;
  onDuplicate?: (page: LandingPageSummary) => void;
  onDelete?: (page: LandingPageSummary) => void;
  isPublishUpdating?: (id: string) => boolean;
}

/**
 * Compact table view of landing pages. Each row is clickable
 * (navigates to the overview) and exposes the same publish toggle +
 * 3-dot menu the card view does. Designed for users who want to
 * scan many pages at once instead of seeing previews.
 */
export function LandingPagesTable({
  pages,
  onTogglePublish,
  onDuplicate,
  onDelete,
  isPublishUpdating,
}: LandingPagesTableProps) {
  const subHref = useSubaccountHref();

  return (
    <div className="overflow-x-auto glass-table">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
            <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
              Name
            </th>
            <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
              Slug
            </th>
            <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
              Status
            </th>
            <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
              Updated
            </th>
            <th className="w-12 px-3 py-2" aria-label="Row actions" />
          </tr>
        </thead>
        <tbody>
          {pages.map((page) => (
            <Row
              key={page.id}
              page={page}
              overviewHref={subHref(`/websites/landing-pages/${page.id}`)}
              editHref={subHref(`/websites/landing-pages/${page.id}/edit`)}
              onTogglePublish={onTogglePublish}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
              publishing={isPublishUpdating?.(page.id) ?? false}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  page,
  overviewHref,
  editHref,
  onTogglePublish,
  onDuplicate,
  onDelete,
  publishing,
}: {
  page: LandingPageSummary;
  overviewHref: string;
  editHref: string;
  onTogglePublish?: (page: LandingPageSummary, next: 'published' | 'draft') => void;
  onDuplicate?: (page: LandingPageSummary) => void;
  onDelete?: (page: LandingPageSummary) => void;
  publishing: boolean;
}) {
  const router = useRouter();
  const published = page.status === 'published';
  return (
    <tr
      onClick={() => router.push(overviewHref)}
      className="border-b border-[var(--border)] last:border-b-0 transition-colors cursor-pointer hover:bg-[var(--muted)]/50"
    >
      <td className="px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--foreground)] truncate">
            {page.name || 'Untitled'}
          </div>
        </div>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-[var(--muted-foreground)]">
        /lp/{page.slug}
      </td>
      <td className="px-3 py-2">
        {onTogglePublish ? (
          <button
            type="button"
            disabled={publishing}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePublish(page, published ? 'draft' : 'published');
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
              published
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'
                : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300 hover:bg-zinc-500/15'
            } disabled:opacity-50`}
          >
            {page.status}
          </button>
        ) : (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              published
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
            }`}
          >
            {page.status}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
        {new Date(page.updatedAt).toLocaleDateString()}
      </td>
      <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
        <RowMenu
          page={page}
          editHref={editHref}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      </td>
    </tr>
  );
}

function RowMenu({
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
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="More actions"
        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
      >
        <EllipsisVerticalIcon className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-44 glass-dropdown shadow-lg p-1">
          <Link
            href={editHref}
            className="flex items-center gap-2 px-2.5 py-2 text-xs rounded-md text-[var(--foreground)] hover:bg-[var(--muted)]"
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
              className="flex items-center gap-2 px-2.5 py-2 text-xs rounded-md text-[var(--foreground)] hover:bg-[var(--muted)]"
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
              className="w-full flex items-center gap-2 px-2.5 py-2 text-xs rounded-md text-[var(--foreground)] hover:bg-[var(--muted)]"
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
                className="w-full flex items-center gap-2 px-2.5 py-2 text-xs rounded-md text-rose-300 hover:bg-rose-500/10"
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
