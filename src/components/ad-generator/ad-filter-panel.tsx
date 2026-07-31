'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon, FunnelIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
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

/** Long facet lists (models, mostly) get a filter box rather than a long scroll. */
const SEARCHABLE_AT = 8;

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="px-3 py-2">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </div>
      <div className="flex items-center rounded-lg border border-[var(--border)] p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              value === o.value
                ? 'bg-[var(--primary)] text-white'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FacetSection({
  facet,
  options,
  selected,
  onChange,
}: {
  facet: FacetKey;
  options: FacetOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  // Open when it already has picks, so reopening the panel shows what's on.
  const [open, setOpen] = useState(selected.length > 0);
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  function toggle(value: string) {
    onChange(
      selected.some((s) => s.toLowerCase() === value.toLowerCase())
        ? selected.filter((s) => s.toLowerCase() !== value.toLowerCase())
        : [...selected, value],
    );
  }

  const summary =
    selected.length === 0
      ? null
      : selected.length === 1
        ? (options.find((o) => o.value.toLowerCase() === selected[0].toLowerCase())?.label ?? selected[0])
        : `${selected.length} selected`;

  return (
    <div className="border-t border-[var(--border)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--muted)]"
      >
        <span className="text-xs font-medium text-[var(--foreground)]">{FACET_LABELS[facet]}</span>
        {summary && (
          <span className="min-w-0 flex-1 truncate text-right text-[11px] text-[var(--primary)]">{summary}</span>
        )}
        <ChevronDownIcon
          className={`h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] transition-transform ${
            open ? 'rotate-180' : ''
          } ${summary ? '' : 'ml-auto'}`}
        />
      </button>

      {open && (
        <div className="pb-1">
          {options.length >= SEARCHABLE_AT && (
            <div className="relative px-3 pb-1.5">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${FACET_LABELS[facet].toLowerCase()}…`}
                className="h-7 w-full rounded-md border border-[var(--border)] bg-[var(--muted)] pl-7 pr-2 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
              />
            </div>
          )}

          <div className="max-h-48 overflow-y-auto">
            {shown.length === 0 ? (
              <div className="px-3 py-1.5 text-xs text-[var(--muted-foreground)]">No matches</div>
            ) : (
              shown.map((o) => {
                const checked = selected.some((s) => s.toLowerCase() === o.value.toLowerCase());
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggle(o.value)}
                    className="flex w-full items-center gap-2 py-1.5 pl-3 pr-3 text-left text-xs hover:bg-[var(--muted)]"
                  >
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                        checked ? 'border-[var(--primary)] bg-[var(--primary)]' : 'border-[var(--border)]'
                      }`}
                    >
                      {checked && (
                        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none">
                          <path
                            d="M2.5 6.5l2.5 2.5 4.5-5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">{o.label}</span>
                    <span className="shrink-0 tabular-nums text-[10px] text-[var(--muted-foreground)]">{o.count}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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
          <Segmented
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
            <Segmented
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

          <Segmented
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
              facet={key}
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
