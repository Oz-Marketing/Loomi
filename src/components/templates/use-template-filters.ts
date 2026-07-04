'use client';

/**
 * Shared filtering for every /templates tab. A tab feeds its loaded list + field
 * accessors; the hook computes facet counts (from the items actually present),
 * applies the search box + left-rail selections, and returns the filtered list.
 * One implementation → identical behavior across Email/Forms/Landing Pages/Ads.
 */
import { useMemo, useState } from 'react';

export type StatusValue = 'all' | 'published' | 'draft';

export interface TemplateFilterState {
  search: string;
  category: string | null; // single-select
  tags: string[]; // multi-select, AND-match
  status: StatusValue;
}

export interface Facet {
  value: string;
  count: number;
}

export interface TemplateFilterFacets {
  categories: Facet[];
  tags: Facet[];
  /** published/draft counts (status 'all' is implicit). */
  statuses: { published: number; draft: number };
}

export interface TemplateFieldAccessors<T> {
  getName: (item: T) => string;
  getCategory: (item: T) => string | null | undefined;
  getTags: (item: T) => string[] | undefined;
  /** Omit for kinds without a publish state — the status section then hides. */
  getStatus?: (item: T) => 'published' | 'draft';
}

const EMPTY_STATE: TemplateFilterState = { search: '', category: null, tags: [], status: 'all' };

export function useTemplateFilters<T>(items: T[], accessors: TemplateFieldAccessors<T>) {
  const { getName, getCategory, getTags, getStatus } = accessors;
  const [filters, setFilters] = useState<TemplateFilterState>(EMPTY_STATE);

  // Facet counts reflect the CURRENT status/search-independent set so the rail is
  // a stable map of what exists; category/tag counts are computed over all items.
  const facets = useMemo<TemplateFilterFacets>(() => {
    const cat = new Map<string, number>();
    const tag = new Map<string, number>();
    let published = 0;
    let draft = 0;
    for (const it of items) {
      const c = (getCategory(it) || '').trim();
      if (c) cat.set(c, (cat.get(c) ?? 0) + 1);
      for (const t of getTags(it) ?? []) tag.set(t, (tag.get(t) ?? 0) + 1);
      if (getStatus) (getStatus(it) === 'published' ? (published += 1) : (draft += 1));
    }
    const toFacets = (m: Map<string, number>) =>
      [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value));
    return { categories: toFacets(cat), tags: toFacets(tag), statuses: { published, draft } };
  }, [items, getCategory, getTags, getStatus]);

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
      if (q) {
        const hay = `${getName(it)} ${getCategory(it) ?? ''} ${(getTags(it) ?? []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, filters, getName, getCategory, getTags, getStatus]);

  const active = filters.search !== '' || filters.category !== null || filters.tags.length > 0 || filters.status !== 'all';
  const reset = () => setFilters(EMPTY_STATE);

  return { filters, setFilters, facets, filtered, active, reset, hasStatus: !!getStatus };
}
