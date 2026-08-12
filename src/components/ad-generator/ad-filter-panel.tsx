'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, FunnelIcon } from '@heroicons/react/24/outline';
import { FacetSection, FacetSegmented } from '@/components/filters/facet-section';
import type { StatusFilterValue } from '@/components/status-filter';
import {
  FACET_KEYS,
  FACET_LABELS,
  countSelected,
  type FacetKey,
  type FacetOption,
  type FacetSelection,
  type OfferWindow,
} from '@/lib/ad-generator/ad-facets';

/**
 * Every ad-list filter behind one control.
 *
 * The toolbar had grown a status select, a manual/automated segment and five
 * facet dropdowns sitting side by side, which crowded the row and pushed the
 * ad count off on narrow screens. They're all one question — "which ads am I
 * looking at" — so they live in one popover with a single count badge and a
 * single Clear.
 */

/** Manual / automated split. Mirrors the page's own SourceFilter. */
export type SourceFilterValue = 'all' | 'manual' | 'auto';

export interface AdFilterPanelProps {
  status: StatusFilterValue;
  onStatusChange: (next: StatusFilterValue) => void;
  source: SourceFilterValue;
  onSourceChange: (next: SourceFilterValue) => void;
  offerWindow: OfferWindow;
  onOfferWindowChange: (next: OfferWindow) => void;

  options: Record<FacetKey, FacetOption[]>;
  /**
   * Which facet sections exist at all — decided from the account's WHOLE ad
   * list, so the panel keeps a stable shape while you filter. A facet with one
   * value across every ad can't narrow anything and stays hidden: a Young Mazda
   * rooftop shouldn't carry a Make section whose only entry is "Mazda".
   */
  visibleFacets: FacetKey[];
  selection: FacetSelection;
  onSelectionChange: (next: FacetSelection) => void;

  /** Hide the manual/automated split until the job has actually produced something. */
  showSource: boolean;
}

export function AdFilterPanel({
  status,
  onStatusChange,
  source,
  onSourceChange,
  offerWindow,
  onOfferWindowChange,
  options,
  visibleFacets,
  selection,
  onSelectionChange,
  showSource,
}: AdFilterPanelProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Anything selected stays rendered regardless, so a filter can always be undone.
  const sections = FACET_KEYS.filter((k) => visibleFacets.includes(k) || (selection[k]?.length ?? 0) > 0);

  const active =
    countSelected(selection) +
    (status !== 'all' ? 1 : 0) +
    (source !== 'all' ? 1 : 0) +
    (offerWindow !== 'all' ? 1 : 0);

  function clearAll() {
    onSelectionChange({});
    onStatusChange('all');
    onSourceChange('all');
    onOfferWindowChange('all');
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Filter ads"
        className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
          active > 0
            ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
            : 'border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)] hover:border-[var(--primary)]'
        }`}
      >
        <FunnelIcon className="h-3.5 w-3.5" />
        Filters
        {active > 0 && (
          <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[10px] font-semibold text-white">
            {active}
          </span>
        )}
        <ChevronDownIcon className={`h-3.5 w-3.5 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        // z-20, deliberately: `.page-sticky-header` is z-30 in this same
        // stacking context, so an equal z-index would let DOM order win and the
        // panel would slide over the docked title as you scroll. Below the
        // header, above the ad grid.
        <div className="absolute right-0 z-20 mt-1 max-h-[70vh] w-72 overflow-y-auto overscroll-contain rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-lg">
          <FacetSegmented
            label="Status"
            value={status}
            onChange={onStatusChange}
            options={[
              { value: 'all' as StatusFilterValue, label: 'All' },
              { value: 'draft' as StatusFilterValue, label: 'Draft' },
              { value: 'published' as StatusFilterValue, label: 'Ready' },
            ]}
          />

          {showSource && (
            <FacetSegmented
              label="Source"
              value={source}
              onChange={onSourceChange}
              options={[
                { value: 'all' as SourceFilterValue, label: 'All' },
                { value: 'manual' as SourceFilterValue, label: 'Manual' },
                { value: 'auto' as SourceFilterValue, label: 'Automated' },
              ]}
            />
          )}

          <FacetSegmented
            label="Offer window"
            value={offerWindow}
            onChange={onOfferWindowChange}
            options={[
              { value: 'all' as OfferWindow, label: 'All' },
              { value: 'active' as OfferWindow, label: 'Active' },
              { value: 'expired' as OfferWindow, label: 'Expired' },
            ]}
          />

          {sections.map((key) => (
            <FacetSection
              key={key}
              label={FACET_LABELS[key]}
              options={options[key]}
              selected={selection[key] ?? []}
              onChange={(next) => onSelectionChange({ ...selection, [key]: next })}
            />
          ))}

          {active > 0 && (
            <div className="sticky bottom-0 border-t border-[var(--border)] bg-[var(--background)] p-2">
              <button
                type="button"
                onClick={clearAll}
                className="w-full rounded-md px-2 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              >
                {active === 1 ? 'Clear filter' : `Clear all ${active} filters`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
