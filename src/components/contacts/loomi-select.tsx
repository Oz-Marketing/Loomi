'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

// The segment builder's dropdown. Lifted out of segment-editor.tsx so
// the filter sidebar and the date-value control render the same thing
// rather than each reaching for a bare <select>.
//
// It portals to document.body because both callers live inside an
// `overflow-y-auto` column that would otherwise clip the menu.
//
// SEARCH: the field list is the reason this exists. It carries every
// built-in field plus the account's custom fields — already past sixty
// entries and growing every time someone declares another one — so
// scrolling a categorised list to find "Lease End Date" stopped being
// reasonable. The 8-option threshold matches SearchableSelect and
// MultiSelect, so a short operator list still opens straight to its
// options.

export interface LoomiSelectOption {
  value: string;
  label: string;
}

export interface LoomiSelectGroup {
  label: string;
  options: LoomiSelectOption[];
}

export interface LoomiSelectProps {
  value: string;
  onChange: (value: string) => void;
  options?: LoomiSelectOption[];
  groups?: LoomiSelectGroup[];
  className?: string;
  placeholder?: string;
  /** Show the search box. Defaults to true once there are 8+ options. */
  searchable?: boolean;
  /** Compact geometry for the 320px filter sidebar. */
  size?: 'sm' | 'md';
  /** Amber border for a condition that's missing its value. */
  invalid?: boolean;
}

/** Leave the menu at least this tall; below it, flip above the trigger. */
const MIN_MENU_HEIGHT = 180;
const MAX_MENU_HEIGHT = 320;

export function LoomiSelect({
  value,
  onChange,
  options,
  groups,
  className = '',
  placeholder = 'Select…',
  searchable,
  size = 'md',
  invalid = false,
}: LoomiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const allOptions = useMemo(() => {
    if (options) return options;
    if (groups) return groups.flatMap((g) => g.options);
    return [];
  }, [options, groups]);

  const showSearch = searchable ?? allOptions.length >= 8;
  const selected = allOptions.find((o) => o.value === value);

  // Filtered groups, with headers for emptied categories dropped —
  // a "Vehicle" heading over no rows reads like a broken search.
  const filteredGroups = useMemo<LoomiSelectGroup[]>(() => {
    const source: LoomiSelectGroup[] = groups ?? [{ label: '', options: options ?? [] }];
    const q = query.trim().toLowerCase();
    if (!q) return source;
    return source
      .map((g) => ({
        label: g.label,
        options: g.options.filter((o) => o.label.toLowerCase().includes(q)),
      }))
      .filter((g) => g.options.length > 0);
  }, [groups, options, query]);

  // Flat view of what's on screen, so arrow keys can walk across group
  // boundaries without the caller caring that groups exist.
  const flat = useMemo(
    () => filteredGroups.flatMap((g) => g.options),
    [filteredGroups],
  );

  function openDropdown() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    // Flip up rather than render a menu that runs off the bottom of the
    // viewport — with a search box on top, the list is tall enough that
    // the last few fields would otherwise be unreachable.
    const flipUp = below < MIN_MENU_HEIGHT && above > below;
    setDropdownStyle({
      position: 'fixed',
      ...(flipUp
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
      left: rect.left,
      width: rect.width,
      maxHeight: Math.min(MAX_MENU_HEIGHT, Math.max(flipUp ? above : below, MIN_MENU_HEIGHT)),
      zIndex: 9999,
    });
    setQuery('');
    setHighlight(Math.max(0, allOptions.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleScroll(e: Event) {
      // Ignore scrolls originating inside the dropdown's own option list —
      // only an outside/page scroll should dismiss it.
      if (ref.current && ref.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  // Land the caret in the search box so a user who opened the field
  // picker can just start typing.
  useEffect(() => {
    if (!open || !showSearch) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, showSearch]);

  // Keep the highlighted row on screen — without this, arrowing through
  // sixty fields highlights rows nobody can see.
  useEffect(() => {
    if (!open) return;
    ref.current
      ?.querySelector('[data-highlighted="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight]);

  function pick(next: string) {
    onChange(next);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(flat.length - 1, h + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const choice = flat[highlight];
      if (choice) pick(choice.value);
    }
  }

  const compact = size === 'sm';
  const triggerHeight = compact ? 'py-1.5 text-xs' : 'h-9 text-sm';

  const dropdown = open
    ? createPortal(
        <div
          ref={ref}
          style={dropdownStyle}
          onKeyDown={handleKey}
          className="animate-dropdown-in flex flex-col rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-xl overflow-hidden"
        >
          {showSearch && (
            <div className="p-1.5 border-b border-[var(--border)] flex-shrink-0">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)] pointer-events-none" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlight(0);
                  }}
                  placeholder="Search"
                  className="w-full pl-7 pr-2 py-1.5 text-sm rounded-md border border-[var(--border)] bg-transparent placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
                />
              </div>
            </div>
          )}

          <div role="listbox" className="flex-1 overflow-y-auto py-1">
            {flat.length === 0 ? (
              <p className="px-3 py-3 text-xs text-center text-[var(--muted-foreground)]">
                No fields match “{query.trim()}”
              </p>
            ) : (
              filteredGroups.map((group, groupIndex) => (
                <div key={group.label || `g${groupIndex}`}>
                  {group.label && (
                    <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      {group.label}
                    </p>
                  )}
                  {group.options.map((option) => {
                    const index = flat.indexOf(option);
                    return (
                      <LoomiSelectOptionRow
                        key={option.value}
                        option={option}
                        isSelected={option.value === value}
                        isHighlighted={index === highlight}
                        onSelect={() => pick(option.value)}
                        onHover={() => setHighlight(index)}
                      />
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className={className}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        onKeyDown={(e) => {
          // Opening with the keyboard should work the same as clicking,
          // and ArrowDown is the conventional way to do it.
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
            e.preventDefault();
            openDropdown();
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 pl-3 pr-2 rounded-lg border bg-transparent focus:outline-none transition-colors ${triggerHeight} ${
          invalid
            ? 'border-amber-500/50 focus:border-amber-500'
            : open
              ? 'border-[var(--primary)]'
              : 'border-[var(--border)] hover:border-[var(--primary)]/60'
        }`}
      >
        <span className={`truncate text-left ${selected ? '' : 'text-[var(--muted-foreground)]'}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDownIcon
          className={`w-3.5 h-3.5 text-[var(--muted-foreground)] flex-shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {dropdown}
    </div>
  );
}

function LoomiSelectOptionRow({
  option,
  isSelected,
  isHighlighted,
  onSelect,
  onHover,
}: {
  option: LoomiSelectOption;
  isSelected: boolean;
  isHighlighted: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      data-highlighted={isHighlighted}
      onClick={onSelect}
      onMouseEnter={onHover}
      className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
        isHighlighted
          ? 'bg-[var(--primary)]/15'
          : ''
      } ${
        isSelected
          ? 'text-[var(--primary)] font-medium'
          : 'text-[var(--foreground)]'
      }`}
    >
      {option.label}
    </button>
  );
}
