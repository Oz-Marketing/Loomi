'use client';

/**
 * The `/docs` shell — full viewport, outside the app chrome.
 *
 * Docs are a reference surface you sit in for a while, not a page inside the
 * workspace, so they get the whole window: a slim top bar, a navigable side
 * rail, and an independently scrolling article column. The sidebar and utility
 * bar are deliberately absent (see the `isDocs` branch in
 * `src/components/layout-shell.tsx`) — this surface carries its own way back.
 *
 * It renders identically on all three hosts. `/docs` is exempt from host
 * rewriting in `src/proxy.ts`, so Studio, Reporting and the App all reach the
 * same page and the same rail.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeftIcon,
  BookOpenIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

import { LoomiWordmark } from '@/components/loomi-wordmark';
import { DocsProvider, useDocs } from '@/lib/docs/docs-context';
import { groupDocs, type DocArticleSummary, type DocSector } from '@/lib/docs/types';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <DocsProvider>
      <DocsShell>{children}</DocsShell>
    </DocsProvider>
  );
}

function DocsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [railOpen, setRailOpen] = useState(false);

  // On a phone the rail is a drawer. Closing it on navigation is the whole
  // point of a drawer — leaving it open over the article you just picked is the
  // classic version of this component that nobody tests.
  useEffect(() => {
    setRailOpen(false);
  }, [pathname]);

  return (
    <div className="fixed inset-0 flex flex-col bg-[var(--background)]">
      <header className="flex-shrink-0 flex items-center gap-3 h-14 px-3 sm:px-4 border-b border-[var(--border)]">
        <button
          type="button"
          onClick={() => setRailOpen((v) => !v)}
          className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
          aria-label={railOpen ? 'Hide contents' : 'Show contents'}
        >
          {railOpen ? <XMarkIcon className="w-5 h-5" /> : <BookOpenIcon className="w-5 h-5" />}
        </button>

        <Link href="/docs" className="flex items-center gap-2.5 min-w-0">
          <LoomiWordmark className="h-6 w-auto flex-shrink-0" />
          <span className="text-sm font-semibold text-[var(--foreground)]">Docs</span>
        </Link>

        <div className="flex-1" />

        {/* The way out. `/` resolves per host — the Studio dashboard, the
            Reporting home, the Projects board — so one link is correct on all
            three rather than three conditional ones. */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          <span className="hidden sm:inline">Back to Loomi</span>
        </Link>
      </header>

      <div className="flex-1 flex min-h-0">
        <SideRail open={railOpen} onClose={() => setRailOpen(false)} />
        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="px-5 sm:px-8 lg:px-12 py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

// ── Side rail ──────────────────────────────────────────────────────────────

function SideRail({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { articles, loading, query, setQuery, results } = useDocs();
  const pathname = usePathname();
  const currentSlug = pathname?.startsWith('/docs/') ? pathname.slice('/docs/'.length) : null;

  const searching = query.trim().length > 0;
  const groups = useMemo(() => groupDocs(searching ? results : articles), [
    searching,
    results,
    articles,
  ]);

  // Which sector the reader is inside, so its section opens on arrival.
  const currentSector = useMemo(
    () => articles.find((a) => a.slug === currentSlug)?.sector ?? null,
    [articles, currentSlug],
  );

  return (
    <>
      {/* Scrim, phone only. */}
      {open && <div className="docs-rail-scrim" onClick={onClose} aria-hidden />}

      <nav className="docs-rail" data-open={open} aria-label="Docs contents">
        <div className="p-3">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)] pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the docs…"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] pl-9 pr-3 py-2 text-sm outline-none focus:border-[var(--primary)] transition-colors"
            />
          </div>
        </div>

        <div className="px-2 pb-8">
          {loading ? (
            <p className="px-2 py-6 text-sm text-[var(--muted-foreground)]">Loading…</p>
          ) : groups.length === 0 ? (
            <p className="px-2 py-6 text-sm text-[var(--muted-foreground)]">
              Nothing matches that.
            </p>
          ) : (
            groups.map((group) => (
              <RailSection
                key={group.sector}
                sector={group.sector}
                label={group.label}
                categories={group.categories}
                currentSlug={currentSlug}
                // Searching opens everything — a collapsed section hiding the
                // result you searched for is the worst possible default.
                defaultOpen={searching || group.sector === currentSector}
              />
            ))
          )}
        </div>
      </nav>
    </>
  );
}

function RailSection({
  sector,
  label,
  categories,
  currentSlug,
  defaultOpen,
}: {
  sector: DocSector;
  label: string;
  categories: { category: string; articles: DocArticleSummary[] }[];
  currentSlug: string | null;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Follow the reader: arriving in a section from search or a cross-link opens
  // it, without freezing sections the reader has closed by hand afterwards.
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        aria-expanded={open}
      >
        <ChevronRightIcon
          className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        {label}
      </button>

      {open && (
        <div className="pb-1">
          {categories.map((cat) => (
            <div key={`${sector}-${cat.category}`} className="mt-1.5">
              {/* A single-category sector doesn't need the heading repeated
                  under its own name. */}
              {categories.length > 1 && (
                <p className="px-2 pl-7 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]/70">
                  {cat.category}
                </p>
              )}
              <ul className="mt-0.5">
                {cat.articles.map((article) => {
                  const active = article.slug === currentSlug;
                  return (
                    <li key={article.id}>
                      <Link
                        href={`/docs/${article.slug}`}
                        aria-current={active ? 'page' : undefined}
                        className={`flex items-center gap-1.5 rounded-lg pl-7 pr-2 py-1.5 text-sm transition-colors ${
                          active
                            ? 'bg-[var(--primary)]/12 font-medium text-[var(--primary)]'
                            : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">{article.title}</span>
                        {article.needsReview && (
                          <span
                            className="w-1.5 h-1.5 flex-shrink-0 rounded-full bg-amber-500"
                            title="May be out of date"
                          />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
