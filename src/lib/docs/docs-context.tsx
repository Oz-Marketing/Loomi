'use client';

/**
 * The library, loaded once for the whole `/docs` surface.
 *
 * The layout owns the side rail and the search box; the pages under it render
 * articles. All three need the same list, and fetching it per page meant the
 * rail flickered on every navigation. It lives here instead, above the router.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { searchDocs, type DocArticleSummary } from './types';

interface DocsContextValue {
  articles: DocArticleSummary[];
  loading: boolean;
  /** What the rail's search box holds. Empty = browse mode. */
  query: string;
  setQuery: (q: string) => void;
  /** Ranked matches for `query`, title hits first then body-only hits. */
  results: DocArticleSummary[];
  /** Re-read the list — after an in-app edit changes a title or status. */
  refresh: () => void;
}

const DocsContext = createContext<DocsContextValue | null>(null);

export function useDocs(): DocsContextValue {
  const ctx = useContext(DocsContext);
  if (!ctx) throw new Error('useDocs must be used inside the /docs layout');
  return ctx;
}

export function DocsProvider({ children }: { children: ReactNode }) {
  const [articles, setArticles] = useState<DocArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [nonce, setNonce] = useState(0);

  // Articles whose BODY matches — the half the client cannot search, since the
  // list payload deliberately carries no bodies. Debounced so a fast typist
  // fires one query, not eight; the instant title ranking shows meanwhile.
  const [bodyMatches, setBodyMatches] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/docs')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setArticles(data.articles ?? []);
      })
      .catch(() => {
        if (!cancelled) setArticles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setBodyMatches(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`/api/docs?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          setBodyMatches(new Set((data.articles ?? []).map((a: DocArticleSummary) => a.id)));
        })
        .catch(() => {
          // A failed body search leaves the instant title results standing —
          // a worse search rather than a broken page.
          if (!cancelled) setBodyMatches(null);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const results = useMemo(() => {
    const ranked = searchDocs(articles, query);
    if (!bodyMatches) return ranked;
    // Title and summary hits keep their ranking and stay on top; a body-only
    // hit is appended rather than interleaved, because a passing mention is a
    // weaker answer than a title.
    const seen = new Set(ranked.map((a) => a.id));
    return [...ranked, ...articles.filter((a) => bodyMatches.has(a.id) && !seen.has(a.id))];
  }, [articles, query, bodyMatches]);

  const value = useMemo(
    () => ({
      articles,
      loading,
      query,
      setQuery,
      results,
      refresh: () => setNonce((n) => n + 1),
    }),
    [articles, loading, query, results],
  );

  return <DocsContext.Provider value={value}>{children}</DocsContext.Provider>;
}
