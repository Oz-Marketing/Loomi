'use client';

// Filter state for the Contacts page: which segment or ad-hoc definition
// is narrowing the list, and the three actions that hang off it (edit,
// export, save as a segment).
//
// Shared by the group roll-up and single-account views so the two behave
// identically. Both used to ignore `?segment=` entirely, which is what
// made "View contacts" on a segment card land on the unfiltered roster.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { exportSegmentCsv } from '@/lib/segments/export-client';
import { toast } from '@/lib/toast';
import type { FilterDefinition } from '@/lib/smart-list-types';
import type { ActiveContactFilter } from './active-filter-bar';

interface SavedSegmentDto {
  id: string;
  name: string;
  accountKey?: string | null;
  filters: string;
}

export interface UseContactFilterResult {
  /** Null when the list is unfiltered. */
  filter: ActiveContactFilter | null;
  /** True while a `?segment=` id is being turned into a definition. */
  resolvingSegment: boolean;
  builderOpen: boolean;
  openBuilder: () => void;
  closeBuilder: () => void;
  applyDefinition: (definition: FilterDefinition) => void;
  clear: () => void;
  exporting: boolean;
  runExport: () => Promise<void>;
  saveAsSegment: (name: string, definition: FilterDefinition) => Promise<void>;
  /** Bumped whenever the filter changes, so callers can reset paging. */
  filterKey: string;
}

/**
 * @param accountKeys Accounts the filter resolves against — one rooftop,
 *   or every rooftop in the current roll-up.
 * @param saveAccountKey Account a newly-saved segment belongs to. Null in
 *   a roll-up, where there is no single owner; the API rejects org-wide
 *   creation for non-privileged users, and the toast says so.
 */
export function useContactFilter(
  accountKeys: string[],
  saveAccountKey: string | null,
): UseContactFilterResult {
  const router = useRouter();
  const searchParams = useSearchParams();
  const segmentParam = searchParams.get('segment') || '';

  const [filter, setFilter] = useState<ActiveContactFilter | null>(null);
  const [resolvingSegment, setResolvingSegment] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ── `?segment=` → a real definition ────────────────────────
  //
  // The definition is fetched here, not just handed to the server as an
  // id, so the filter bar can list the actual conditions and the builder
  // can open pre-populated with them.
  useEffect(() => {
    if (!segmentParam) {
      // Only clear a SEGMENT filter — an ad-hoc filter built on this page
      // has no URL parameter and must survive the param being absent.
      setFilter((current) => (current?.segmentId ? null : current));
      return;
    }
    let cancelled = false;
    setResolvingSegment(true);
    // Show the filter as active immediately. Waiting for the name would
    // leave a filtered list looking unfiltered for the length of a
    // request — the exact confusion this whole change removes.
    setFilter({ segmentId: segmentParam, segmentName: null, definition: null });

    fetch('/api/audiences')
      .then((res) => (res.ok ? res.json() : { audiences: [] }))
      .then((data) => {
        if (cancelled) return;
        const list: SavedSegmentDto[] = Array.isArray(data?.audiences) ? data.audiences : [];
        const found = list.find((s) => s.id === segmentParam);
        if (!found) {
          toast.error('That segment no longer exists.');
          setFilter(null);
          return;
        }
        let definition: FilterDefinition | null = null;
        try {
          const parsed = JSON.parse(found.filters) as FilterDefinition;
          if (parsed?.version === 1 && Array.isArray(parsed.groups)) definition = parsed;
        } catch {
          definition = null;
        }
        setFilter({ segmentId: found.id, segmentName: found.name, definition });
      })
      .catch(() => {
        if (!cancelled) {
          // The server can still resolve the segment by id, so keep the
          // filter on — only the printed rules are missing.
          setFilter({ segmentId: segmentParam, segmentName: null, definition: null });
        }
      })
      .finally(() => {
        if (!cancelled) setResolvingSegment(false);
      });

    return () => {
      cancelled = true;
    };
  }, [segmentParam]);

  // ── Actions ────────────────────────────────────────────────

  /** Drop `?segment=` without adding a history entry to step back through. */
  const stripSegmentParam = useCallback(() => {
    if (!segmentParam) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('segment');
    const query = params.toString();
    router.replace(query ? `?${query}` : window.location.pathname, { scroll: false });
  }, [router, searchParams, segmentParam]);

  const applyDefinition = useCallback(
    (definition: FilterDefinition) => {
      // Editing a saved segment's conditions here filters the VIEW; it
      // does not quietly rewrite the saved segment. Dropping the id (and
      // the URL parameter) is what keeps those two apart.
      setFilter({ segmentId: null, segmentName: null, definition });
      setBuilderOpen(false);
      stripSegmentParam();
    },
    [stripSegmentParam],
  );

  const clear = useCallback(() => {
    setFilter(null);
    setBuilderOpen(false);
    stripSegmentParam();
  }, [stripSegmentParam]);

  const runExport = useCallback(async () => {
    if (!filter) return;
    setExporting(true);
    try {
      await exportSegmentCsv({
        accountKeys,
        segmentId: filter.segmentId ?? null,
        definition: filter.segmentId ? null : filter.definition,
        label: filter.segmentName || 'contacts-filter',
      });
    } finally {
      setExporting(false);
    }
  }, [filter, accountKeys]);

  const saveAsSegment = useCallback(
    async (name: string, definition: FilterDefinition) => {
      const trimmed = name.trim();
      if (!trimmed) {
        toast.error('Give the segment a name.');
        return;
      }
      try {
        const res = await fetch('/api/audiences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmed,
            filters: JSON.stringify(definition),
            ...(saveAccountKey ? { accountKey: saveAccountKey } : {}),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to save segment');
        }
        const saved = data?.audience as SavedSegmentDto | undefined;
        toast.success(`Segment "${trimmed}" saved.`);
        // Re-anchor the view on the segment that was just created, so the
        // bar names it and Export goes through the saved id.
        if (saved?.id) {
          setFilter({ segmentId: saved.id, segmentName: saved.name, definition });
          // Saving a modified copy leaves `?segment=` pointing at the
          // segment it was forked FROM, so a refresh would silently go
          // back to the original. Drop it.
          stripSegmentParam();
        }
        setBuilderOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save segment');
      }
    },
    [saveAccountKey, stripSegmentParam],
  );

  // Identity of the current filter, for effects that must reset when it
  // changes (paging, mainly). JSON of the definition rather than object
  // identity, which changes on every render.
  const filterKey = useMemo(
    () =>
      filter
        ? filter.segmentId
          ? `segment:${filter.segmentId}`
          : `adhoc:${JSON.stringify(filter.definition)}`
        : 'none',
    [filter],
  );

  return {
    filter,
    resolvingSegment,
    builderOpen,
    openBuilder: useCallback(() => setBuilderOpen(true), []),
    closeBuilder: useCallback(() => setBuilderOpen(false), []),
    applyDefinition,
    clear,
    exporting,
    runExport,
    saveAsSegment,
    filterKey,
  };
}
