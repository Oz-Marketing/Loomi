'use client';

import * as React from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { ViewSwitcher, type ListView } from '@/components/view-switcher';
import {
  StatusFilter,
  type StatusFilterValue,
  type StatusFilterOption,
} from '@/components/status-filter';

interface ListToolbarProps {
  /** Cards / Table toggle on the left. Omit both props to skip the
   *  switcher entirely (e.g. Campaigns has a single view). */
  view?: ListView;
  onViewChange?: (next: ListView) => void;

  /** Custom content for the left slot — replaces the view switcher.
   *  Used when the surface doesn't have multiple views but still wants
   *  to show something on the left (e.g. an "X campaigns" count). */
  leading?: React.ReactNode;

  /** Controlled search string. */
  search: string;
  onSearchChange: (next: string) => void;
  searchPlaceholder?: string;

  /** Optional status filter. Omit both props to hide it. */
  status?: StatusFilterValue;
  onStatusChange?: (next: StatusFilterValue) => void;
  statusOptions?: StatusFilterOption[];

  /** Free-form slot rendered after status (e.g. date picker, filter button). */
  trailing?: React.ReactNode;
}

/**
 * Shared toolbar for list pages (Forms, Flows, Campaigns). Sits above
 * the content so the layout is identical regardless of which view is
 * active — and so any table component below can hide its own internal
 * toolbar via `hideToolbar={true}`.
 *
 * Layout:  [view toggle | leading]   [Search]  [Status]  [trailing]
 */
export function ListToolbar({
  view,
  onViewChange,
  leading,
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  status,
  onStatusChange,
  statusOptions,
  trailing,
}: ListToolbarProps) {
  // Left slot priority:
  //   1. Explicit `leading` node (used when the page has no view choice)
  //   2. ViewSwitcher when both view props are wired
  //   3. Nothing
  const leftSlot =
    leading ??
    (view !== undefined && onViewChange ? (
      <ViewSwitcher value={view} onChange={onViewChange} />
    ) : null);

  return (
    <div className="flex items-center justify-between gap-3 pb-3 flex-wrap">
      <div className="min-w-0">{leftSlot}</div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <MagnifyingGlassIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-56 pl-8 pr-3 h-9 text-xs rounded-lg bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
          />
        </div>

        {status !== undefined && onStatusChange && (
          <StatusFilter
            value={status}
            onChange={onStatusChange}
            options={statusOptions}
          />
        )}

        {trailing}
      </div>
    </div>
  );
}
