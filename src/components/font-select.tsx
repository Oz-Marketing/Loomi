'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDownIcon, CheckIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

export interface FontSelectOption {
  value: string;
  label: string;
  /** Optional section header this option is grouped under (e.g. "Serif"). */
  group?: string;
}

/**
 * Loomi-styled custom dropdown (replaces the native <select>). When
 * `previewFont` is set (default), the trigger and each option render in their
 * own value as a font-family — so a list of fonts previews itself. Set it false
 * for non-font option sets (e.g. weight/style).
 */
export function FontSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  previewFont = true,
  className = '',
  openUp = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: FontSelectOption[];
  placeholder?: string;
  previewFont?: boolean;
  className?: string;
  /** Open the menu upward (for triggers anchored near the bottom of a pane). */
  openUp?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  // Show a search box once the list is long enough to be annoying to scroll.
  const searchable = options.length > 12;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  // Group filtered options while preserving order; ungrouped options come first
  // under no header.
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, FontSelectOption[]>();
    for (const o of filtered) {
      const key = o.group ?? '';
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(o);
    }
    return order.map((key) => ({ key, items: map.get(key)! }));
  }, [filtered]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Reset the query each time the menu closes so it reopens fresh.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={previewFont ? { fontFamily: value || undefined } : undefined}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:border-[var(--primary)] focus:border-[var(--primary)] focus:outline-none"
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className={`glass-dropdown animate-fade-in-up absolute left-0 right-0 z-50 shadow-lg ${
            openUp ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          {searchable && (
            <div className="border-b border-[var(--border)] p-1.5">
              <div className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search fonts…"
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] py-1.5 pl-8 pr-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                />
              </div>
            </div>
          )}
          {/* glass-dropdown is overflow:hidden (rounded); scroll on an inner box. */}
          <div className="max-h-72 overflow-y-auto p-1.5">
            {groups.length === 0 && (
              <p className="px-3 py-2 text-sm text-[var(--muted-foreground)]">No fonts found</p>
            )}
            {groups.map((g) => (
              <div key={g.key || '_'}>
                {g.key && (
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    {g.key}
                  </p>
                )}
                {g.items.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    style={previewFont ? { fontFamily: o.value || undefined } : undefined}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                      o.value === value
                        ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                        : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
                    }`}
                  >
                    <span className="truncate">{o.label}</span>
                    {o.value === value && <CheckIcon className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
