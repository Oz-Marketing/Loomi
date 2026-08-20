'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import {
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

import { useAccount } from '@/contexts/account-context';
import { useDocs } from '@/lib/docs/docs-context';
import {
  DOC_SECTOR_META,
  groupDocs,
  type DocArticleSummary,
  type DocSector,
} from '@/lib/docs/types';

/**
 * `/docs` — the library's front page.
 *
 * Navigation and search live in the rail (`src/app/docs/layout.tsx`), so this
 * page is the thing a rail can't be: an overview that says what each area is
 * for, for somebody who doesn't yet know which section holds their answer.
 *
 * What a reader sees is decided on the server. Nothing on this page is a
 * permission gate.
 */
export default function DocsIndexPage() {
  const { userRole } = useAccount();
  const canEdit =
    userRole === 'developer' || userRole === 'admin' || userRole === 'super_admin';

  const { articles, loading, query, results } = useDocs();
  const searching = query.trim().length > 0;

  const groups = useMemo(() => groupDocs(articles), [articles]);
  const staleCount = articles.filter((a) => a.needsReview).length;

  // While the rail is filtering, the front page follows it rather than sitting
  // there showing an unfiltered contents list beside a filtered rail.
  if (searching) return <SearchResults results={results} query={query} />;

  return (
    <div className="max-w-4xl">
      <h1 className="text-3xl font-bold">Docs</h1>
      <p className="text-base text-[var(--muted-foreground)] mt-2">
        How Loomi works, what each part is for, and how to do the job in it.
      </p>

      {/* Staff-only: what the drift job flagged. Clients never see a review
          badge — an article being out of date is our problem, not theirs. */}
      {canEdit && staleCount > 0 && (
        <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <ExclamationTriangleIcon className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm">
            <span className="font-semibold">
              {staleCount} article{staleCount === 1 ? '' : 's'} may be out of date.
            </span>{' '}
            <span className="text-[var(--muted-foreground)]">
              Code changed under paths {staleCount === 1 ? 'it documents' : 'they document'} since
              {staleCount === 1 ? ' it was' : ' they were'} last checked. They&rsquo;re marked in the
              rail.
            </span>
          </p>
        </div>
      )}

      {loading ? (
        <p className="mt-10 text-sm text-[var(--muted-foreground)]">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="mt-10 text-sm text-[var(--muted-foreground)]">No articles yet.</p>
      ) : (
        <div className="mt-10 space-y-10">
          {groups.map((group) => {
            const count = group.categories.reduce((n, c) => n + c.articles.length, 0);
            const first = group.categories[0]?.articles[0];
            return (
              <section key={group.sector}>
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <h2 className="text-lg font-semibold">{group.label}</h2>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {count} article{count === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="text-sm text-[var(--muted-foreground)] mt-1">{group.blurb}</p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {group.categories.map((cat) => (
                    <CategoryCard
                      key={cat.category}
                      sector={group.sector}
                      category={cat.category}
                      articles={cat.articles}
                      showBadges={canEdit}
                    />
                  ))}
                </div>

                {first && (
                  <Link
                    href={`/docs/${first.slug}`}
                    className="inline-block mt-3 text-sm font-medium text-[var(--primary)] hover:underline"
                  >
                    Start with {first.title} →
                  </Link>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Release notes are a separate, already-solved surface. Pointing at it
          beats re-stating it here and letting the two drift apart. */}
      <div className="mt-14 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3.5 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-[var(--muted-foreground)]">
          Looking for what changed recently? That lives in the changelog.
        </p>
        <Link
          href="/changelog"
          className="text-sm font-medium text-[var(--primary)] hover:underline inline-flex items-center gap-1"
        >
          Open the changelog
          <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}

function CategoryCard({
  sector,
  category,
  articles,
  showBadges,
}: {
  sector: DocSector;
  category: string;
  articles: DocArticleSummary[];
  showBadges: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
        {category}
      </p>
      <ul className="mt-2 space-y-1.5">
        {articles.map((article) => (
          <li key={article.id} className="flex items-center gap-1.5">
            <Link
              href={`/docs/${article.slug}`}
              className="text-sm text-[var(--foreground)] hover:text-[var(--primary)] transition-colors"
              title={article.summary}
            >
              {article.title}
            </Link>
            {showBadges && article.status === 'draft' && <Badge tone="muted">Draft</Badge>}
            {showBadges && article.audience === 'staff' && <Badge tone="muted">Staff</Badge>}
            {showBadges && article.needsReview && <Badge tone="warn">Review</Badge>}
          </li>
        ))}
      </ul>
      <span className="sr-only">{DOC_SECTOR_META[sector].label}</span>
    </div>
  );
}

/** Flat, ranked, and labeled with where each result lives — a search result
    without its section is a page you can't put back in context. */
function SearchResults({ results, query }: { results: DocArticleSummary[]; query: string }) {
  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold">
        {results.length} result{results.length === 1 ? '' : 's'} for &ldquo;{query.trim()}&rdquo;
      </h1>

      {results.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted-foreground)]">
          Nothing matches. Try a single word — the search wants every term to appear somewhere in
          the article.
        </p>
      ) : (
        <div className="mt-5 space-y-2">
          {results.map((article) => (
            <Link
              key={article.id}
              href={`/docs/${article.slug}`}
              className="block rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 hover:border-[var(--primary)] transition-colors"
            >
              <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
                {DOC_SECTOR_META[article.sector].label} · {article.category}
              </p>
              <p className="text-sm font-semibold mt-0.5">{article.title}</p>
              <p className="text-sm text-[var(--muted-foreground)] mt-0.5">{article.summary}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Badge({ tone, children }: { tone: 'muted' | 'warn'; children: React.ReactNode }) {
  const cls =
    tone === 'warn'
      ? 'bg-amber-500/15 text-amber-500'
      : 'bg-[var(--muted)] text-[var(--muted-foreground)]';
  return (
    <span
      className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls}`}
    >
      {children}
    </span>
  );
}
