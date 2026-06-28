'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronUpDownIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';

// Generic searchable combobox. Renders the popover into a portal on
// document.body so the dropdown isn't clipped by the inspector's
// `overflow-y-auto` container. Positioned with `fixed` coords pulled
// from the trigger button's bounding rect on every open.

export interface SearchableSelectOption {
  value: string;
  label: string;
  /** Optional group header — options sharing the same group render
   *  together under a single category label. Pass undefined for
   *  ungrouped lists. */
  group?: string;
  /** Optional leading visual (e.g. an avatar/logo) shown before the label
   *  in both the trigger and the option rows. */
  icon?: React.ReactNode;
}

export interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  /** Hide the search input when there are only a few options. Defaults
   *  to true if there are 8+ options. */
  searchable?: boolean;
  className?: string;
  /** Tailwind class merged into the popover root — use to widen, etc. */
  popoverClassName?: string;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchable,
  className,
  popoverClassName,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);

  const showSearch = searchable ?? options.length >= 8;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  // Group filtered options for rendering. Ungrouped options come first
  // (no header); grouped options render under their group label.
  const grouped = useMemo(() => {
    const map = new Map<string, SearchableSelectOption[]>();
    for (const o of filtered) {
      const key = o.group ?? '';
      const arr = map.get(key) ?? [];
      arr.push(o);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([group, items]) => ({ group, items }));
  }, [filtered]);

  // Selected option label for the trigger. Looking it up on every
  // render is cheap enough — the option list is short.
  const selectedOption = useMemo(() => options.find((o) => o.value === value), [options, value]);
  const selectedLabel = selectedOption?.label ?? '';

  const positionPopover = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setCoords({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    positionPopover();
  }, [open, positionPopover]);

  // Reposition on scroll/resize so the popover stays anchored. We listen
  // on the capture phase to catch scrolls in any ancestor (the inspector
  // body scrolls independently from the page).
  useEffect(() => {
    if (!open) return;
    const handler = () => positionPopover();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open, positionPopover]);

  // Click-outside to close — fires on pointerdown so the focus-stealing
  // browser default doesn't interfere.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Focus the search input (or the popover body if no search) when
  // opening so keyboard users land somewhere meaningful.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHighlight(0);
    requestAnimationFrame(() => {
      if (showSearch) searchRef.current?.focus();
      else popoverRef.current?.focus();
    });
  }, [open, showSearch]);

  function handleKey(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const choice = filtered[highlight];
      if (choice) {
        onChange(choice.value);
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs text-left hover:border-[var(--primary)] focus:outline-none focus:border-[var(--primary)] transition-colors ${className ?? ''}`}
      >
        <span className="flex flex-1 min-w-0 items-center gap-1.5">
          {selectedOption?.icon}
          <span className={`min-w-0 truncate ${selectedLabel ? '' : 'text-[var(--muted-foreground)]'}`}>
            {selectedLabel || placeholder}
          </span>
        </span>
        <ChevronUpDownIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] flex-shrink-0" />
      </button>

      {open && coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            tabIndex={-1}
            onKeyDown={handleKey}
            data-builder-popout-portal
            className={`fixed z-[200] rounded-lg border border-[var(--border)] bg-[var(--card-strong)] backdrop-blur-2xl backdrop-saturate-150 shadow-xl overflow-hidden focus:outline-none ${popoverClassName ?? ''}`}
            style={{
              top: coords.top,
              left: coords.left,
              minWidth: coords.width,
              maxWidth: Math.max(coords.width, 280),
            }}
          >
            {showSearch && (
              <div className="px-2 py-1.5 border-b border-[var(--border)]">
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setHighlight(0);
                    }}
                    placeholder="Search"
                    className="w-full pl-7 pr-2 py-2 rounded-md border border-[var(--border)] bg-[var(--input)] text-sm placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>
            )}

            <ul className="max-h-60 overflow-y-auto p-1">
              {filtered.length === 0 && (
                <li className="px-2 py-2 text-[11px] text-[var(--muted-foreground)] text-center">
                  No matches
                </li>
              )}
              {grouped.map((g) => (
                <GroupSection
                  key={g.group}
                  label={g.group}
                  items={g.items}
                  value={value}
                  // Highlight index is over the FLAT filtered list, not
                  // per-group. We compute the offset by counting items
                  // in preceding groups.
                  highlightIndexBase={
                    grouped
                      .slice(0, grouped.indexOf(g))
                      .reduce((acc, prev) => acc + prev.items.length, 0)
                  }
                  highlightIndex={highlight}
                  onPick={(v) => {
                    onChange(v);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  onHover={(absIdx) => setHighlight(absIdx)}
                />
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}

function GroupSection({
  label,
  items,
  value,
  highlightIndex,
  highlightIndexBase,
  onPick,
  onHover,
}: {
  label: string;
  items: SearchableSelectOption[];
  value: string;
  highlightIndex: number;
  highlightIndexBase: number;
  onPick: (value: string) => void;
  onHover: (absIdx: number) => void;
}) {
  return (
    <li>
      {label && (
        <div className="px-2 pt-2 pb-1 text-[9px] uppercase tracking-wider text-[var(--muted-foreground)]">
          {label}
        </div>
      )}
      <ul>
        {items.map((opt, i) => {
          const absIdx = highlightIndexBase + i;
          const isHighlighted = absIdx === highlightIndex;
          const isSelected = opt.value === value;
          return (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => onPick(opt.value)}
                onMouseEnter={() => onHover(absIdx)}
                className={`w-full flex items-center gap-2 text-left px-2.5 py-2 rounded-md text-sm transition-colors ${
                  isHighlighted
                    ? 'bg-[var(--primary)] text-white'
                    : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
                } ${isSelected && !isHighlighted ? 'font-semibold' : ''}`}
              >
                {opt.icon}
                <span className="flex-1 min-w-0 truncate">{opt.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </li>
  );
}
