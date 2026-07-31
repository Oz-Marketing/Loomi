'use client';

/**
 * Read a co-op guideline document without leaving Loomi.
 *
 * Pages are rendered server-side and delivered as images — see the route at
 * api/ad-generator/oem-assets/page-image for why that beats shipping a 66 MB PDF to
 * the browser.
 *
 * The reader assumes nothing about whether a page will arrive: a document can be
 * registered by hash with no stored copy behind it, in which case the API says so
 * and this shows that message rather than an endless spinner.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

export interface GuidelineReaderProps {
  docId: string;
  title: string;
  /** From the register; used for the page counter before the first page lands. */
  pageCount: number | null;
  /** Direct link to the original file, when one is stored. */
  sourceUrl: string | null;
  onClose: () => void;
}

export function GuidelineReader({ docId, title, pageCount, sourceUrl, onClose }: GuidelineReaderProps) {
  /** The page being displayed — changing this triggers a fetch and a render. */
  const [page, setPage] = useState(1);
  /**
   * What the scrubber reads right now, which is NOT the same thing.
   *
   * A range input fires onChange for every value it passes through. Wiring it
   * straight to `page` meant one drag requested a dozen pages, each of which
   * launched a Chromium instance server-side — and the displayed page ended up
   * disagreeing with the counter as the responses raced. So the scrubber moves
   * freely here and only commits to `page` when the user lets go.
   */
  const [scrub, setScrub] = useState(1);
  const [total, setTotal] = useState<number | null>(pageCount);
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Object URLs we created, so they can be revoked instead of leaking. */
  const urls = useRef<string[]>([]);

  const pageUrl = useCallback(
    (n: number) => `/api/ad-generator/oem-assets/page-image?docId=${encodeURIComponent(docId)}&page=${n}`,
    [docId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(pageUrl(page));
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `Could not load page ${page}`);
        }
        // The render knows the real page count; the register's value can be null for
        // a document whose cover never rendered.
        const count = Number(res.headers.get('X-Page-Count'));
        if (Number.isFinite(count) && count > 0) setTotal(count);

        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        urls.current.push(url);
        setSrc(url);

        // Warm the next page. The API renders it alongside this one anyway, so this
        // just moves it into the browser's cache.
        if (!count || page < count) void fetch(pageUrl(page + 1)).catch(() => {});
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this page');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [page, pageUrl]);

  // Revoke every object URL on unmount rather than per page change — the previous
  // page's blob is still displayed while the next one loads.
  useEffect(
    () => () => {
      for (const u of urls.current) URL.revokeObjectURL(u);
      urls.current = [];
    },
    [],
  );

  /** Move to an absolute page, clamped, keeping the scrubber in step. */
  const goTo = useCallback(
    (n: number) => {
      const clamped = Math.max(1, total ? Math.min(n, total) : n);
      setPage(clamped);
      setScrub(clamped);
    },
    [total],
  );

  const go = useCallback((delta: number) => goTo(page + delta), [goTo, page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape always closes. Everything else defers to a focused form control —
      // otherwise the scrubber handles the key natively AND this handler acts on it,
      // which is how a single End keypress produced a run of page requests.
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;

      if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
      else if (e.key === 'Home') goTo(1);
      else if (e.key === 'End' && total) goTo(total);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, goTo, onClose, total]);

  const atStart = page <= 1;
  const atEnd = !!total && page >= total;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/85 backdrop-blur-sm">
      {/* toolbar */}
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{title}</p>
          <p className="text-[11px] text-white/50">
            Page {page}
            {total ? ` of ${total}` : ''} · arrow keys to flip
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/10"
            >
              <ArrowDownTrayIcon className="h-3.5 w-3.5" /> Original
            </a>
          )}
          <button
            onClick={onClose}
            aria-label="Close reader"
            className="rounded-lg border border-white/15 p-1.5 text-white/80 transition-colors hover:bg-white/10"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* page */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        <button
          onClick={() => go(-1)}
          disabled={atStart}
          aria-label="Previous page"
          className="absolute left-3 z-10 rounded-full bg-black/50 p-2 text-white transition-opacity hover:bg-black/70 disabled:pointer-events-none disabled:opacity-0"
        >
          <ChevronLeftIcon className="h-6 w-6" />
        </button>

        {error ? (
          <div className="max-w-md rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-center">
            <ExclamationTriangleIcon className="mx-auto mb-2 h-5 w-5 text-amber-400" />
            <p className="text-sm text-amber-200">{error}</p>
          </div>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {src && <img src={src} alt={`${title} page ${page}`} className="max-h-full max-w-full object-contain shadow-2xl" />}
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/25 border-t-white/80" />
              </div>
            )}
          </>
        )}

        <button
          onClick={() => go(1)}
          disabled={atEnd}
          aria-label="Next page"
          className="absolute right-3 z-10 rounded-full bg-black/50 p-2 text-white transition-opacity hover:bg-black/70 disabled:pointer-events-none disabled:opacity-0"
        >
          <ChevronRightIcon className="h-6 w-6" />
        </button>
      </div>

      {/* jump-to-page, only worth showing once we know the length */}
      {total && total > 1 && (
        <div className="flex flex-shrink-0 items-center justify-center gap-2 border-t border-white/10 px-4 py-2">
          <input
            type="range"
            min={1}
            max={total}
            value={scrub}
            // While dragging, only the scrubber moves. Committing here would request
            // every page the handle crosses.
            onChange={(e) => setScrub(Number(e.target.value))}
            // Commit on release — mouse, touch, and keyboard each have their own end
            // event, and missing one would leave the scrubber out of step with the page.
            onPointerUp={() => goTo(scrub)}
            onKeyUp={() => goTo(scrub)}
            onBlur={() => goTo(scrub)}
            className="h-1 w-64 max-w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-white"
            aria-label="Jump to page"
          />
          <span className="w-20 text-[11px] tabular-nums text-white/50">
            {scrub} / {total}
            {scrub !== page && <span className="text-white/30"> ↵</span>}
          </span>
        </div>
      )}
    </div>
  );
}
