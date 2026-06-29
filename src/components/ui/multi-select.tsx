'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckIcon,
  ChevronUpDownIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

// Generic searchable MULTI-select. Sibling to SearchableSelect — same portal +
// search + theming, but holds an array of values and toggles them. Renders the
// popover into document.body so it isn't clipped by scroll containers.

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Optional leading visual (avatar/logo) shown before the label in the
   *  selected pills and the option rows. */
  icon?: React.ReactNode;
}

export interface MultiSelectProps {
  value: string[];
  onChange: (value: string[]) => void;
  options: MultiSelectOption[];
  placeholder?: string;
  /** Hide the search box. Defaults to true once there are 8+ options. */
  searchable?: boolean;
  className?: string;
  /** Color for the selected pills (e.g. a team color). Defaults to primary. */
  accentColor?: string;
}

export function MultiSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchable,
  className,
  accentColor,
}: MultiSelectProps) {
  const accent = accentColor ?? 'var(--primary)';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);

  const showSearch = searchable ?? options.length >= 8;
  const selected = useMemo(() => new Set(value), [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  const positionPopover = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, []);

  useLayoutEffect(() => {
    if (open) positionPopover();
  }, [open, positionPopover]);

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

  useEffect(() => {
    if (!open) return;
    setQuery('');
    requestAnimationFrame(() => {
      if (showSearch) searchRef.current?.focus();
      else popoverRef.current?.focus();
    });
  }, [open, showSearch]);

  function toggle(v: string) {
    if (selected.has(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  }

  return (
    <>
      {/* A clickable <div> (not <button>) so the per-pill remove buttons can
          nest without invalid button-in-button markup. */}
      <div
        ref={triggerRef}
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        className={`w-full flex items-center gap-1.5 min-h-[2.5rem] px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs text-left cursor-pointer hover:border-[var(--primary)] focus:outline-none focus-visible:border-[var(--primary)] transition-colors ${className ?? ''}`}
      >
        {value.length === 0 ? (
          <span className="flex-1 min-w-0 truncate text-[var(--muted-foreground)]">{placeholder}</span>
        ) : (
          <span className="flex flex-1 flex-wrap gap-1">
            {value.map((v) => {
              const opt = options.find((o) => o.value === v);
              const label = opt?.label ?? v;
              return (
                <span
                  key={v}
                  className="inline-flex items-center gap-1 rounded-md py-0.5 pl-1 pr-1.5 text-xs font-medium"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
                    color: accent,
                  }}
                >
                  {opt?.icon}
                  {label}
                  <button
                    type="button"
                    aria-label={`Remove ${label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(value.filter((x) => x !== v));
                    }}
                    className="-mr-0.5 rounded p-0.5 hover:opacity-60"
                  >
                    <XMarkIcon className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </span>
        )}
        <ChevronUpDownIcon className="w-3.5 h-3.5 self-center text-[var(--muted-foreground)] flex-shrink-0" />
      </div>

      {open && coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
                triggerRef.current?.focus();
              }
            }}
            data-builder-popout-portal
            className="fixed z-[200] rounded-xl border border-[var(--border)] bg-[var(--card-strong)] backdrop-blur-2xl backdrop-saturate-150 shadow-2xl overflow-hidden focus:outline-none"
            style={{
              top: coords.top,
              left: coords.left,
              minWidth: coords.width,
              maxWidth: Math.max(coords.width, 280),
            }}
          >
            {showSearch && (
              <div className="p-2 border-b border-[var(--border)]">
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search…"
                    className="w-full pl-8 pr-2 py-2 rounded-lg border border-[var(--border)] bg-[var(--input)] text-sm placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
                  />
                </div>
              </div>
            )}

            <ul className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
              {filtered.length === 0 && (
                <li className="px-2 py-3 text-[11px] text-[var(--muted-foreground)] text-center">
                  No matches
                </li>
              )}
              {filtered.map((opt) => {
                const isSelected = selected.has(opt.value);
                return (
                  <li key={opt.value}>
                    <button
                      type="button"
                      onClick={() => toggle(opt.value)}
                      className={`group w-full flex items-center gap-2.5 text-left px-2.5 py-2 rounded-lg text-sm transition-colors ${
                        isSelected
                          ? 'bg-[var(--primary)]/10 text-[var(--primary)] font-medium'
                          : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded-[5px] border transition-colors ${
                          isSelected
                            ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                            : 'border-[var(--border)] group-hover:border-[var(--muted-foreground)]'
                        }`}
                      >
                        {isSelected && <CheckIcon className="h-3 w-3" strokeWidth={2.5} />}
                      </span>
                      {opt.icon}
                      <span className="flex-1 min-w-0 truncate">{opt.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
