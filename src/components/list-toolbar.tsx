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
  /** Cards / Table toggle on the left (replaces the legacy count text). */
  view: ListView;
  onViewChange: (next: ListView) => void;

  /** Controlled search string. */
  search: string;
  onSearchChange: (next: string) => void;
  searchPlaceholder?: string;

  /** Optional status filter on the right. Omit both props to hide it. */
  status?: StatusFilterValue;
  onStatusChange?: (next: StatusFilterValue) => void;
  statusOptions?: StatusFilterOption[];

  /** Free-form slot rendered between search and status (e.g. "Expand all"). */
  trailing?: React.ReactNode;
}

/**
 * Shared toolbar for list pages that offer both card + table views
 * (Forms, Flows). Sits above the content so the toolbar layout is
 * identical regardless of which view is active, and so the table
 * can hide its own internal toolbar via `hideToolbar={true}`.
 *
 * Layout:  [Cards|Table]                [Search]  [Status]  [trailing]
 */
export function ListToolbar({
  view,
  onViewChange,
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  status,
  onStatusChange,
  statusOptions,
  trailing,
}: ListToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-3 pb-3 flex-wrap">
      <ViewSwitcher value={view} onChange={onViewChange} />

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
