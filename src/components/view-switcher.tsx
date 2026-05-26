'use client';

import * as React from 'react';
import { Squares2X2Icon, TableCellsIcon } from '@heroicons/react/24/outline';

export type ListView = 'cards' | 'table';

interface ViewSwitcherProps {
  value: ListView;
  onChange: (next: ListView) => void;
  className?: string;
}

/**
 * Reusable Cards / Table toggle. Used on list pages that offer both
 * representations of the same data (Forms, Flows). The parent owns the
 * state — use {@link useListView} below if you want sticky persistence.
 */
export function ViewSwitcher({ value, onChange, className = '' }: ViewSwitcherProps) {
  return (
    <div
      className={`inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5 ${className}`}
      role="tablist"
      aria-label="Switch list view"
    >
      <ViewButton
        active={value === 'cards'}
        onClick={() => onChange('cards')}
        Icon={Squares2X2Icon}
        label="Cards"
      />
      <ViewButton
        active={value === 'table'}
        onClick={() => onChange('table')}
        Icon={TableCellsIcon}
        label="Table"
      />
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      title={label}
      className={`inline-flex items-center gap-1.5 px-2.5 h-8 text-xs font-medium rounded-md transition-colors ${
        active
          ? 'bg-[var(--muted)] text-[var(--foreground)]'
          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/**
 * Sticky list-view preference. Stores the choice in localStorage under
 * a caller-supplied key so each list page can remember its own
 * setting (e.g. `loomi.forms.view`, `loomi.flows.view`). Falls back to
 * `defaultView` when nothing is stored or storage is unavailable
 * (SSR, private mode).
 */
export function useListView(
  storageKey: string,
  defaultView: ListView,
): [ListView, (next: ListView) => void] {
  const [view, setView] = React.useState<ListView>(defaultView);

  // Read from localStorage after mount so the initial server render
  // matches the static default — avoids hydration mismatch.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === 'cards' || stored === 'table') setView(stored);
    } catch {
      // Storage blocked (private mode) — stay on default.
    }
  }, [storageKey]);

  const update = React.useCallback(
    (next: ListView) => {
      setView(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // Best-effort persistence.
      }
    },
    [storageKey],
  );

  return [view, update];
}
