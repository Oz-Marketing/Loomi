'use client';

import { useMemo, useState } from 'react';
import { ChevronDownIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

/**
 * One collapsible multi-select facet, and the segmented control that sits
 * alongside it in a filter popover.
 *
 * Extracted from `ad-generator/ad-filter-panel.tsx` when the media library
 * needed the same controls. Nothing here knows what it is filtering — the
 * caller supplies the label and the options — so the two filter panels stay
 * visually and behaviourally identical without either owning the other's types.
 */

/** Long facet lists (models, brands) get a filter box rather than a long scroll. */
const SEARCHABLE_AT = 8;

export interface FacetSectionOption {
  value: string;
  label: string;
  count: number;
}

export function FacetSection({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: FacetSectionOption[];
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
        <span className="text-xs font-medium text-[var(--foreground)]">{label}</span>
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
                placeholder={`Search ${label.toLowerCase()}…`}
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

/** A one-of-N segmented control, for filters that aren't multi-select. */
export function FacetSegmented<T extends string>({
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
