'use client';

/**
 * Read a co-op guideline document without leaving Loomi.
 *
 * Pages are rendered server-side and delivered as images — see the route at
 * api/ad-generator/oem-assets/page-image for why that beats shipping a 66 MB PDF to
 * the browser.
 *
 * SEARCH is client-side over text extracted when the document was registered. The
 * whole document's text is 160-230 KB, so it's one fetch on open and then instant
 * matching as you type — no round trip per keystroke, and no server work at all.
 * These documents are 60-150 pages of dense policy; finding "security deposit"
 * without it means flipping through by hand.
 *
 * The reader assumes nothing about whether a page will arrive: a document can be
 * registered by hash with no stored copy behind it, in which case the API says so
 * and this shows that message rather than an endless spinner.
 *
 * PORTALLED TO THE BODY. `position: fixed` is relative to the nearest ancestor with
 * a transform, filter, backdrop-filter or containment — and Loomi's shell and glass
 * cards use backdrop-blur throughout. Rendered in place, `inset-0` sized itself to
 * whichever panel happened to contain it instead of the viewport, which is exactly
 * what happened when this moved into Settings.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { findHits, pageHighlights, MAX_HITS, MIN_QUERY, type TextItem } from './guideline-search';
import {
  ArrowDownTrayIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

export interface GuidelineReaderProps {
  docId: string;
  title: string;
  /** From the register; used for the page counter before the first page lands. */
  pageCount: number | null;
  /** Direct link to the original file, when one is stored. */
  sourceUrl: string | null;
  /**
   * Open here rather than at page 1 — for arriving from a citation.
   *
   * A verified citation is only worth having if it can be OPENED, so a rule under
   * review links straight to the page its quote came from.
   */
  initialPage?: number;
  /**
   * Pre-fill the search box, so the cited sentence is highlighted on arrival.
   * Combined with `initialPage` this turns "§5e p.12" into the actual sentence,
   * lit up, without the reader having to be told where to look.
   */
  initialQuery?: string;
  onClose: () => void;
}

interface Section {
  page: number;
  title: string;
}

/** The section a page falls in — the last heading at or before it. */
function sectionFor(sections: Section[], page: number): string | null {
  let found: string | null = null;
  for (const s of sections) {
    if (s.page > page) break;
    found = s.title;
  }
  return found;
}

export function GuidelineReader({
  docId,
  title,
  pageCount,
  sourceUrl,
  initialPage,
  initialQuery,
  onClose,
}: GuidelineReaderProps) {
  /** The page being displayed — changing this triggers a fetch and a render. */
  const [page, setPage] = useState(initialPage && initialPage > 0 ? initialPage : 1);
  /**
   * What the scrubber reads right now, which is NOT the same thing.
   *
   * A range input fires onChange for every value it passes through. Wiring it
   * straight to `page` meant one drag requested a dozen pages, each of which
   * launched a Chromium instance server-side — and the displayed page ended up
   * disagreeing with the counter as the responses raced. So the scrubber moves
   * freely here and only commits to `page` when the user lets go.
   */
  const [scrub, setScrub] = useState(initialPage && initialPage > 0 ? initialPage : 1);
  const [total, setTotal] = useState<number | null>(pageCount);
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery ?? '');
  const [pages, setPages] = useState<string[] | null>(null);
  const [textState, setTextState] = useState<'idle' | 'loading' | 'none'>('idle');
  const [showHits, setShowHits] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  /** Text geometry for the CURRENT page, fetched only while a search is active. */
  const [boxes, setBoxes] = useState<TextItem[]>([]);
  /** Natural size of the rendered page, so the overlay can match the letterboxed image. */
  const [imgBox, setImgBox] = useState<{ w: number; h: number } | null>(null);
  /** Object URLs we created, so they can be revoked instead of leaking. */
  const urls = useRef<string[]>([]);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const pageUrl = useCallback(
    (n: number) => `/api/ad-generator/oem-assets/page-image?docId=${encodeURIComponent(docId)}&page=${n}`,
    [docId],
  );

  // ── the visible page ──
  useEffect(() => {
    // ABORT the superseded request, don't just ignore its result.
    //
    // This effect used to only flip a `cancelled` flag, which stopped the state
    // update but left the request in flight — and each one holds a page render
    // open on the server. Flipping through a document stacked them up, and a
    // browser only opens ~6 connections per host, so after a few pages new
    // requests queued behind stale ones and the image updated late, or appeared
    // not to update at all. That's why it looked intermittent and why it behaved
    // differently between browsers: it depended on the connection cap and on
    // which response happened to win.
    const ac = new AbortController();
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(pageUrl(page), { signal: ac.signal });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `Could not load page ${page}`);
        }
        const count = Number(res.headers.get('X-Page-Count'));
        if (Number.isFinite(count) && count > 0) setTotal(count);

        const blob = await res.blob();
        if (ac.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        urls.current.push(url);
        setSrc(url);
      } catch (err) {
        // An abort is the expected outcome of turning the page quickly, not a
        // failure to report.
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Could not load this page');
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    // The next page is NOT prefetched from here any more. The API renders it
    // alongside this one and caches it server-side, so the old prefetch bought a
    // warm browser cache at the cost of doubling in-flight requests — and it
    // raced the very render it was waiting on: it always missed the cache the
    // first request hadn't populated yet, so it launched a second Chromium and
    // rendered the same page twice.
    return () => ac.abort();
  }, [page, pageUrl]);

  // ── the document's text, fetched once ──
  useEffect(() => {
    let cancelled = false;
    setTextState('loading');
    (async () => {
      try {
        const res = await fetch(`/api/ad-generator/oem-assets?docId=${encodeURIComponent(docId)}`);
        const json = await res.json();
        const raw = json?.doc?.pageText;
        const parsed = typeof raw === 'string' ? (JSON.parse(raw) as string[]) : null;
        if (cancelled) return;
        const rawSections = json?.doc?.sections;
        if (typeof rawSections === 'string') {
          try {
            const list = JSON.parse(rawSections) as Section[];
            if (Array.isArray(list)) setSections(list);
          } catch {
            // a malformed blob just means results show page numbers only
          }
        }
        if (Array.isArray(parsed) && parsed.length) {
          setPages(parsed);
          setTextState('idle');
        } else {
          setTextState('none');
        }
      } catch {
        if (!cancelled) setTextState('none');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docId]);

  useEffect(
    () => () => {
      for (const u of urls.current) URL.revokeObjectURL(u);
      urls.current = [];
    },
    [],
  );

  const hits = useMemo(() => (pages ? findHits(pages, query) : []), [pages, query]);
  const searching = query.trim().length >= MIN_QUERY;

  // Geometry only while searching, and only for the page on screen. It comes from
  // the same cache entry as the page image, so this is free once the page is warm.
  useEffect(() => {
    if (!searching) {
      setBoxes([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${pageUrl(page)}&boxes=1`);
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && Array.isArray(json.items)) setBoxes(json.items as TextItem[]);
      } catch {
        // no geometry just means no highlight; the page still reads fine
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searching, page, pageUrl]);

  const highlights = useMemo(
    () => (searching && boxes.length ? pageHighlights(hits, page, boxes) : []),
    [searching, boxes, hits, page],
  );

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
      if (e.key === 'Escape') {
        // Escape backs out of the search first, then closes — otherwise dismissing a
        // result list also throws away the document you were reading.
        if (showHits || query) {
          setShowHits(false);
          setQuery('');
          searchRef.current?.blur();
        } else {
          onClose();
        }
        return;
      }
      // ⌘F / Ctrl+F goes to our search, not the browser's, which would only find the
      // toolbar text — the page itself is an image.
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
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
  }, [go, goTo, onClose, total, showHits, query]);

  const atStart = page <= 1;
  const atEnd = !!total && page >= total;

  // Mounted guard: document.body doesn't exist during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-sm">
      {/* ── toolbar: title | search | close ──
          z-20 so the results list paints over the page below it. Without it the
          toolbar is `relative` but has no stacking order, and the page area — a
          later sibling — covers the dropdown. */}
      <div className="relative z-20 flex flex-shrink-0 items-center gap-3 border-b border-white/10 bg-black/40 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold leading-tight text-white">{title}</p>
          <p className="truncate text-[11px] text-white/50">
            Page {page}
            {total ? ` of ${total}` : ''}
            {sectionFor(sections, page) ? ` · ${sectionFor(sections, page)}` : ''}
          </p>
        </div>

        {/* Centred independently of the title's width, so it doesn't shift between
            documents with long and short names. */}
        <div className="absolute left-1/2 hidden w-full max-w-md -translate-x-1/2 md:block">
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowHits(true);
              }}
              onFocus={() => setShowHits(true)}
              disabled={textState === 'none'}
              placeholder={
                textState === 'none'
                  ? 'Search unavailable for this document'
                  : textState === 'loading'
                    ? 'Loading text…'
                    : 'Search this document'
              }
              className="w-full rounded-lg border border-white/15 bg-white/10 py-1.5 pl-8 pr-20 text-sm text-white placeholder-white/40 outline-none focus:border-white/40 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {query.trim().length >= 2 && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-white/50">
                {hits.length === 0 ? 'no matches' : `${hits.length}${hits.length === MAX_HITS ? '+' : ''} found`}
              </span>
            )}

            {showHits && query.trim().length >= 2 && (
              <div className="absolute left-0 right-0 top-full mt-1 max-h-80 overflow-y-auto rounded-lg border border-white/15 bg-[#141414] shadow-2xl">
                {hits.length === 0 ? (
                  <p className="px-3 py-2.5 text-xs text-white/50">No matches.</p>
                ) : (
                  hits.map((h, i) => (
                    <button
                      key={`${h.page}-${i}`}
                      onClick={() => {
                        goTo(h.page);
                        setShowHits(false);
                      }}
                      className={`block w-full border-b border-white/5 px-3 py-2 text-left last:border-0 hover:bg-white/10 ${
                        h.page === page ? 'bg-white/5' : ''
                      }`}
                    >
                      <span className="block truncate text-[10px] font-medium uppercase tracking-wider text-white/40">
                        Page {h.page}
                        {sectionFor(sections, h.page) ? ` · ${sectionFor(sections, h.page)}` : ''}
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug text-white/80">
                        {h.snippet.slice(0, h.at)}
                        <mark className="rounded bg-amber-400/30 px-0.5 text-amber-200">
                          {h.snippet.slice(h.at, h.at + h.len)}
                        </mark>
                        {h.snippet.slice(h.at + h.len)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
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

      {/* ── the page ── */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-4" onClick={() => setShowHits(false)}>
        {error ? (
          <div className="max-w-md rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-center">
            <ExclamationTriangleIcon className="mx-auto mb-2 h-5 w-5 text-amber-400" />
            <p className="text-sm text-amber-200">{error}</p>
          </div>
        ) : (
          <div className="relative flex h-full w-full items-center justify-center">
            {/* The overlay is positioned against the IMAGE's rendered box, not the
                container: `object-contain` letterboxes the page, so anchoring to the
                container would put every highlight at the wrong offset. */}
            <div className="relative flex h-full w-full items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {src && (
                <img
                  src={src}
                  alt={`${title} page ${page}`}
                  onLoad={(e) =>
                    setImgBox({
                      w: e.currentTarget.clientWidth,
                      h: e.currentTarget.clientHeight,
                    })
                  }
                  className="max-h-full max-w-full object-contain shadow-2xl"
                />
              )}
              {imgBox && highlights.length > 0 && (
                <div
                  className="pointer-events-none absolute"
                  style={{ width: imgBox.w, height: imgBox.h }}
                  aria-hidden
                >
                  {highlights.map((b, i) => (
                    <span
                      key={i}
                      className="absolute rounded-[2px] bg-amber-300/45 ring-1 ring-amber-400/70"
                      style={{
                        left: `${b.x * 100}%`,
                        top: `${b.y * 100}%`,
                        width: `${b.w * 100}%`,
                        height: `${b.h * 100}%`,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/25 border-t-white/80" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── footer: ‹ scrubber › ── */}
      <div className="flex flex-shrink-0 items-center justify-center gap-3 border-t border-white/10 px-4 py-2.5">
        <button
          onClick={() => go(-1)}
          disabled={atStart}
          aria-label="Previous page"
          className="rounded-full border border-white/15 p-1.5 text-white/80 transition-colors hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>

        {total && total > 1 ? (
          <input
            type="range"
            min={1}
            max={total}
            value={scrub}
            // While dragging, only the scrubber moves. Committing here would request
            // every page the handle crosses.
            onChange={(e) => setScrub(Number(e.target.value))}
            // Commit on release — mouse, touch and keyboard each have their own end
            // event, and missing one would leave the scrubber out of step.
            onPointerUp={() => goTo(scrub)}
            onKeyUp={() => goTo(scrub)}
            onBlur={() => goTo(scrub)}
            className="h-1 w-64 max-w-[40vw] cursor-pointer appearance-none rounded-full bg-white/20 accent-white"
            aria-label="Jump to page"
          />
        ) : (
          <span className="w-64 max-w-[40vw]" />
        )}

        <span className="w-16 text-center text-[11px] tabular-nums text-white/50">
          {scrub}
          {total ? ` / ${total}` : ''}
        </span>

        <button
          onClick={() => go(1)}
          disabled={atEnd}
          aria-label="Next page"
          className="rounded-full border border-white/15 p-1.5 text-white/80 transition-colors hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent"
        >
          <ChevronRightIcon className="h-5 w-5" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
