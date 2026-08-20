'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  CheckIcon,
  ExclamationTriangleIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';

import PrimaryButton from '@/components/primary-button';
import { useAccount } from '@/contexts/account-context';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';
import { toast } from '@/lib/toast';
import { useDocs } from '@/lib/docs/docs-context';
import { renderMarkdown } from '@/lib/docs/markdown';
import {
  DOC_AUDIENCE_META,
  DOC_SECTOR_META,
  type DocArticle,
  type DocAudience,
  type DocSector,
} from '@/lib/docs/types';

/**
 * `/docs/[slug]` — one article.
 *
 * Section navigation lives in the layout's side rail, so this page is the
 * article and its own table of contents, nothing else.
 *
 * The markdown is rendered in the browser rather than on the server so the edit
 * view can preview through the same code path that renders the published page.
 * There is one renderer, so a doc cannot look right in the editor and wrong once
 * saved.
 */
export default function DocArticlePage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;

  const { userRole } = useAccount();
  const canEdit =
    userRole === 'developer' || userRole === 'admin' || userRole === 'super_admin';

  // The rail reads the same list, so a saved title or status has to invalidate
  // it — otherwise the rail keeps showing the old title until a reload.
  const { refresh } = useDocs();

  const [article, setArticle] = useState<DocArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    title: '',
    summary: '',
    body: '',
    audience: 'everyone' as DocAudience,
    status: 'published' as 'draft' | 'published',
  });

  const { markClean, markDirty } = useUnsavedChanges();

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setNotFound(false);
    setEditing(false);
    fetch(`/api/docs/${slug}`)
      .then(async (r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (!data?.article) return;
        setArticle(data.article as DocArticle);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  const rendered = useMemo(
    () => renderMarkdown(editing ? draft.body : (article?.body ?? '')),
    [editing, draft.body, article?.body],
  );

  const dirty =
    editing &&
    !!article &&
    (draft.title !== article.title ||
      draft.summary !== article.summary ||
      draft.body !== article.body ||
      draft.audience !== article.audience ||
      draft.status !== article.status);

  useEffect(() => {
    if (dirty) markDirty();
    else markClean();
    // markClean/markDirty are stable refs from context
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  const startEditing = useCallback(() => {
    if (!article) return;
    setDraft({
      title: article.title,
      summary: article.summary,
      body: article.body,
      audience: article.audience,
      status: article.status,
    });
    setEditing(true);
  }, [article]);

  const save = useCallback(async () => {
    if (!article) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/docs/${article.slug}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setArticle(data.article as DocArticle);
      setEditing(false);
      markClean();
      refresh();
      toast.success('Article saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [article, draft, markClean, refresh]);

  const markReviewed = useCallback(async () => {
    if (!article) return;
    try {
      const res = await fetch(`/api/docs/${article.slug}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ needsReview: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setArticle(data.article as DocArticle);
      refresh();
      toast.success('Marked as reviewed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    }
  }, [article, refresh]);

  if (loading) {
    return <p className="text-sm text-[var(--muted-foreground)] py-16">Loading…</p>;
  }

  if (notFound || !article) {
    return (
      <div className="max-w-2xl py-16">
        <h1 className="text-xl font-bold">That article isn&rsquo;t here</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-2">
          It may have been renamed, or it may not be one you have access to.
        </p>
        <Link href="/docs" className="text-sm text-[var(--primary)] hover:underline mt-4 inline-block">
          Back to the docs
        </Link>
      </div>
    );
  }

  const sectorMeta = DOC_SECTOR_META[article.sector as DocSector];

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,44rem)_13rem] xl:gap-12">
      <article className="min-w-0 max-w-3xl">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
            {sectorMeta?.label ?? article.sector} · {article.category}
          </p>
          {/* Staff need to know an article's state from the article itself.
              Without this, the only place a draft looks like a draft is the
              rail you arrived from — and links get shared directly. */}
          {canEdit && article.status === 'draft' && <StateBadge>Draft</StateBadge>}
          {canEdit && article.audience === 'staff' && <StateBadge>Staff only</StateBadge>}
        </div>

        {editing ? (
          <input
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            className="w-full mt-1 bg-transparent text-3xl font-bold outline-none border-b border-[var(--border)] focus:border-[var(--primary)] pb-1"
          />
        ) : (
          <h1 className="text-3xl font-bold mt-1">{article.title}</h1>
        )}

        {editing ? (
          <textarea
            value={draft.summary}
            onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))}
            rows={2}
            className="w-full mt-3 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
            placeholder="One line — the card subtitle and the search blurb."
          />
        ) : (
          <p className="text-base text-[var(--muted-foreground)] mt-2">{article.summary}</p>
        )}

        {/* Staff controls. A client sees none of this, and no review state. */}
        {canEdit && (
          <div className="mt-5 flex items-center gap-2 flex-wrap">
            {editing ? (
              <>
                <PrimaryButton onClick={save} disabled={saving || !dirty}>
                  {saving ? 'Saving…' : 'Save'}
                </PrimaryButton>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    markClean();
                  }}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:border-[var(--primary)] transition-colors"
                >
                  Cancel
                </button>
                <select
                  value={draft.audience}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, audience: e.target.value as DocAudience }))
                  }
                  className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-sm"
                  title={DOC_AUDIENCE_META[draft.audience].description}
                >
                  <option value="everyone">Everyone</option>
                  <option value="staff">Staff only</option>
                </select>
                <select
                  value={draft.status}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, status: e.target.value as 'draft' | 'published' }))
                  }
                  className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-sm"
                >
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                </select>
              </>
            ) : (
              <button
                type="button"
                onClick={startEditing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:border-[var(--primary)] transition-colors"
              >
                <PencilSquareIcon className="w-4 h-4" />
                Edit
              </button>
            )}
          </div>
        )}

        {/* The first in-app edit detaches the article from its file. Said
            before the save, not after, because it is not reversible here. */}
        {canEdit && editing && !article.editedInApp && (
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">
            Saving detaches this article from{' '}
            <code className="text-[var(--foreground)]">content/docs/{article.sourceKey}</code> —
            deploys will stop overwriting it, and future edits happen here rather than in the repo.
          </p>
        )}

        {canEdit && article.needsReview && !editing && (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">This may be out of date</p>
              <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
                {article.reviewNote ?? 'Code changed under the paths this article documents.'}
              </p>
              <button
                type="button"
                onClick={markReviewed}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--primary)] hover:underline"
              >
                <CheckIcon className="w-4 h-4" />
                I&rsquo;ve checked it — it&rsquo;s still correct
              </button>
            </div>
          </div>
        )}

        {editing ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <textarea
              value={draft.body}
              onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              spellCheck
              className="min-h-[32rem] w-full rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 font-mono text-[13px] leading-relaxed outline-none focus:border-[var(--primary)]"
            />
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 overflow-auto max-h-[32rem]">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-3">
                Preview
              </p>
              <div className="doc-body" dangerouslySetInnerHTML={{ __html: rendered.html }} />
            </div>
          </div>
        ) : (
          <div className="doc-body mt-8" dangerouslySetInnerHTML={{ __html: rendered.html }} />
        )}

        <footer className="mt-14 pt-5 border-t border-[var(--border)] text-xs text-[var(--muted-foreground)]">
          Last updated{' '}
          {new Date(article.updatedAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
          {article.updatedBy ? ` by ${article.updatedBy}` : ''}.
        </footer>
      </article>

      {/* On this page. Hidden below xl — on a narrow window the article is the
          page, and the rail already answers "where am I". */}
      <aside className="hidden xl:block">
        {rendered.headings.length > 1 && !editing && (
          <nav className="sticky top-8">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">
              On this page
            </p>
            <ul className="space-y-1.5 border-l border-[var(--border)]">
              {rendered.headings.map((h) => (
                <li key={h.id}>
                  <a
                    href={`#${h.id}`}
                    className="block -ml-px border-l border-transparent pl-3 text-sm text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)] transition-colors"
                  >
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </aside>
    </div>
  );
}

function StateBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
      {children}
    </span>
  );
}
