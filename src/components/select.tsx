'use client';

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon, CheckIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

export interface SelectOption {
  value: string;
  label: string;
  /** Optional section header this option is grouped under (e.g. "Serif"). */
  group?: string;
  /**
   * A glyph shown before the label, in the trigger and in the menu.
   *
   * For lists where the icon carries as much meaning as the words — image fit
   * modes, alignment — so naming the options does not mean losing the picture
   * that made them scannable.
   */
  icon?: ReactNode;
}

/** Gap between the trigger and the menu, in px — matches the old mt-2/mb-2. */
const MENU_OFFSET = 8;

/**
 * Loomi's dropdown — use this instead of a native `<select>`, which renders as
 * an OS control that ignores the app's theme.
 *
 * `previewFont` renders the trigger and each option in its own value as a
 * font-family, so a list of fonts previews itself. OPT IN — pass it only on a
 * list of font families.
 *
 * It used to default to TRUE, left over from this beginning life as
 * `FontSelect`, and the old doc called that "harmless". It was not: an option
 * whose value is `contain` sets `font-family: contain`, which is not a family, so
 * the browser falls back to its default SERIF and the menu renders in Times while
 * the rest of the app is sans. Of 66 call sites, 51 had already been made to pass
 * `previewFont={false}` and not one passed it true — the default was wrong and
 * every new dropdown paid for it until someone noticed.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  previewFont = false,
  className = '',
  openUp = false,
  disabled = false,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  previewFont?: boolean;
  className?: string;
  /** Open the menu upward (for triggers anchored near the bottom of a pane). */
  openUp?: boolean;
  /** Non-interactive, dimmed trigger — won't open. */
  disabled?: boolean;
  /** For a trigger whose meaning comes from a separate <label>. */
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Menu geometry, measured from the trigger each time it opens. `null` until
  // the first measurement so the menu never paints at the wrong spot.
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
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
    const map = new Map<string, SelectOption[]>();
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

  /**
   * Place the menu against the trigger's viewport rect. The menu is portalled
   * to <body> (see the render below), so `fixed` coords are the only way to
   * keep it attached — and they have to be recomputed whenever anything moves.
   */
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const height = menuRef.current?.offsetHeight ?? 0;
    const spaceBelow = window.innerHeight - rect.bottom;
    // Honour `openUp`, but flip anyway when the requested side has no room.
    const wantsUp = openUp
      ? rect.top > height + MENU_OFFSET
      : spaceBelow < height + MENU_OFFSET && rect.top > spaceBelow;
    setCoords({
      top: wantsUp ? rect.top - height - MENU_OFFSET : rect.bottom + MENU_OFFSET,
      left: rect.left,
      width: rect.width,
    });
  }, [openUp]);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    place();
    // A second pass once the menu has rendered: the first one measured a height
    // of 0, so an upward-opening menu would sit on top of its own trigger.
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open, place, groups.length]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    // Capture, so a scroll inside any ancestor container (a modal body, a side
    // panel) repositions the menu rather than leaving it stranded mid-air.
    const onReflow = () => place();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [open, place]);

  // Reset the query each time the menu closes so it reopens fresh.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  // A disabled trigger that's still open would strand the menu.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const menu = (
    <div
      ref={menuRef}
      style={{
        top: coords?.top ?? 0,
        left: coords?.left ?? 0,
        width: coords?.width,
        visibility: coords ? 'visible' : 'hidden',
      }}
      /* z-300 clears every modal layer (the tallest is 260). This is portalled
         to <body> precisely so a scrolling ancestor can't clip it, which also
         means it no longer inherits any modal's stacking context. */
      className="glass-dropdown animate-fade-in-up fixed z-[300] shadow-lg"
    >
      {searchable && (
        <div className="border-b border-[var(--border)] p-1.5">
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // `previewFont` is the only signal this component has for
              // whether it's listing fonts. Any other option set (brands,
              // categories) showed "Search fonts…" before this.
              placeholder={previewFont ? 'Search fonts…' : 'Search…'}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] py-1.5 pl-8 pr-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
          </div>
        </div>
      )}
      {/* glass-dropdown is overflow:hidden (rounded); scroll on an inner box. */}
      <div className="max-h-72 overflow-y-auto p-1.5">
        {groups.length === 0 && (
          <p className="px-3 py-2 text-sm text-[var(--muted-foreground)]">
            {previewFont ? 'No fonts found' : 'No matches'}
          </p>
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
                <span className="flex min-w-0 items-center gap-2">
                  {o.icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center">{o.icon}</span>}
                  <span className="truncate">{o.label}</span>
                </span>
                {o.value === value && <CheckIcon className="h-3.5 w-3.5 shrink-0" />}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={previewFont ? { fontFamily: value || undefined } : undefined}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:border-[var(--primary)] focus:border-[var(--primary)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[var(--border)]"
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center">{selected.icon}</span>}
          <span className="truncate">{selected?.label ?? placeholder}</span>
        </span>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && typeof document !== 'undefined' && createPortal(menu, document.body)}
    </div>
  );
}
