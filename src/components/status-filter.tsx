'use client';

import { ChevronUpDownIcon } from '@heroicons/react/24/outline';

// Shared toolbar filter for any table that supports archive lifecycle
// (Flows, Emails). Vocabulary kept identical across surfaces so the
// behaviour is predictable:
//   - all       → live items (everything except archived)
//   - draft     → draft (plus DB-level 'paused' for flows; UI-only)
//   - published → active
//   - archived  → soft-deleted, auto-purges after 30 days
//
// Renders as a compact native <select> so keyboard + accessibility
// come for free. Caller drives the value/onChange.

export type StatusFilterValue = 'all' | 'draft' | 'published' | 'archived';

export interface StatusFilterOption {
  value: StatusFilterValue;
  label: string;
}

const DEFAULT_OPTIONS: StatusFilterOption[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];

export function StatusFilter({
  value,
  onChange,
  className,
  options = DEFAULT_OPTIONS,
}: {
  value: StatusFilterValue;
  onChange: (next: StatusFilterValue) => void;
  className?: string;
  /** Optional override for the option set — surfaces only the values
   *  that make sense for the surface (e.g. campaigns use just
   *  {all, archived} since they have no draft/published vocabulary). */
  options?: StatusFilterOption[];
}) {
  return (
    <div className={`relative inline-flex ${className || ''}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as StatusFilterValue)}
        aria-label="Filter by status"
        className="appearance-none pl-3 pr-7 h-9 text-xs font-medium rounded-lg bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronUpDownIcon className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)]" />
    </div>
  );
}
