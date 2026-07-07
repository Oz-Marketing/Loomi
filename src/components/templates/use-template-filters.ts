'use client';

/**
 * Shared filtering for every /templates tab. A tab feeds its loaded list + field
 * accessors; the hook computes facet counts (from the items actually present),
 * applies the search box + left-rail selections, and returns the filtered list.
 * One implementation → identical behavior across Email/Forms/Landing Pages/Ads.
 */
import { useMemo, useState } from 'react';

export type StatusValue = 'all' | 'published' | 'draft';

/** Facet value for the global ("All accounts") scope — a template with no
 *  accountKey. A real key can't collide with it (keys are account slugs). */
export const GLOBAL_SCOPE = '__global__';

export interface TemplateFilterState {
  search: string;
  category: string | null; // single-select
  tags: string[]; // multi-select, AND-match
  status: StatusValue;
  /** Subaccount scope filter: null = every scope, GLOBAL_SCOPE = global only,
   *  else a specific account key. Single-select. */
  accountKey: string | null;
}

export interface Facet {
  value: string;
  count: number;
}

export interface TemplateFilterFacets {
  categories: Facet[];
  tags: Facet[];
  /** Scope buckets (global + each subaccount present). Empty when the tab
   *  doesn't provide getAccountKey. */
  accounts: Facet[];
  /** published/draft counts (status 'all' is implicit). */
  statuses: { published: number; draft: number };
}

export interface TemplateFieldAccessors<T> {
  getName: (item: T) => string;
  getCategory: (item: T) => string | null | undefined;
  getTags: (item: T) => string[] | undefined;
  /** Omit for kinds without a publish state — the status section then hides. */
  getStatus?: (item: T) => 'published' | 'draft';
  /** Omit to hide the Subaccount facet. Return null/undefined for a global
   *  (unscoped) template. */
  getAccountKey?: (item: T) => string | null | undefined;
}

const EMPTY_STATE: TemplateFilterState = { search: '', category: null, tags: [], status: 'all', accountKey: null };

export function useTemplateFilters<T>(items: T[], accessors: TemplateFieldAccessors<T>) {
  const { getName, getCategory, getTags, getStatus, getAccountKey } = accessors;
  const [filters, setFilters] = useState<TemplateFilterState>(EMPTY_STATE);

  // Facet counts reflect the CURRENT status/search-independent set so the rail is
  // a stable map of what exists; category/tag counts are computed over all items.
  const facets = useMemo<TemplateFilterFacets>(() => {
    const cat = new Map<string, number>();
    const tag = new Map<string, number>();
    const acct = new Map<string, number>();
    let published = 0;
    let draft = 0;
    for (const it of items) {
      const c = (getCategory(it) || '').trim();
      if (c) cat.set(c, (cat.get(c) ?? 0) + 1);
      for (const t of getTags(it) ?? []) tag.set(t, (tag.get(t) ?? 0) + 1);
      if (getStatus) (getStatus(it) === 'published' ? (published += 1) : (draft += 1));
      if (getAccountKey) {
        const k = getAccountKey(it) || GLOBAL_SCOPE;
        acct.set(k, (acct.get(k) ?? 0) + 1);
      }
    }
    const toFacets = (m: Map<string, number>) =>
      [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value));
    // Sort scope facets with the global bucket pinned first, then A→Z by key.
    const accounts = [...acct.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) =>
        a.value === GLOBAL_SCOPE ? -1 : b.value === GLOBAL_SCOPE ? 1 : a.value.localeCompare(b.value),
      );
    return { categories: toFacets(cat), tags: toFacets(tag), accounts, statuses: { published, draft } };
  }, [items, getCategory, getTags, getStatus, getAccountKey]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return items.filter((it) => {
      if (filters.category && (getCategory(it) || '') !== filters.category) return false;
      if (filters.tags.length) {
        const t = getTags(it) ?? [];
        if (!filters.tags.every((want) => t.includes(want))) return false;
      }
      if (filters.status !== 'all' && getStatus) {
        if (getStatus(it) !== filters.status) return false;
      }
      if (filters.accountKey && getAccountKey) {
        if ((getAccountKey(it) || GLOBAL_SCOPE) !== filters.accountKey) return false;
      }
      if (q) {
        const hay = `${getName(it)} ${getCategory(it) ?? ''} ${(getTags(it) ?? []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, filters, getName, getCategory, getTags, getStatus, getAccountKey]);

  const active =
    filters.search !== '' ||
    filters.category !== null ||
    filters.tags.length > 0 ||
    filters.status !== 'all' ||
    filters.accountKey !== null;
  const reset = () => setFilters(EMPTY_STATE);

  return { filters, setFilters, facets, filtered, active, reset, hasStatus: !!getStatus };
}
