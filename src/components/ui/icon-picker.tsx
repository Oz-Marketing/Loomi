'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlassIcon, ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import { ICON_NAMES, LucideIcon } from '@/components/lucide-icon';

const PAGE = 60; // icons revealed per scroll step

/**
 * Loomi icon picker (mirrors Oz Hub): a glyph button that opens a searchable,
 * lazy-revealing grid of lucide icons. `value` is a kebab-case icon name, or
 * null to fall back to the default. `fallback` is the icon shown when value is
 * null (e.g. 'users' for teams).
 */
export function IconPicker({
  value,
  onChange,
  fallbackIcon,
  color,
}: {
  value: string | null;
  onChange: (name: string | null) => void;
  /** Rendered in the trigger when no icon is selected (the default glyph). */
  fallbackIcon?: React.ReactNode;
  color?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [count, setCount] = useState(PAGE);
  const wrapRef = useRef<HTMLDivElement>(null);

  const query = q.trim().toLowerCase();
  const filtered = useMemo(
    () => (query ? ICON_NAMES.filter((n) => n.includes(query)) : ICON_NAMES),
    [query],
  );
  const shown = filtered.slice(0, count);

  useEffect(() => setCount(PAGE), [query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 64) {
      setCount((c) => Math.min(c + PAGE, filtered.length));
    }
  };

  const cell =
    'grid h-9 w-9 place-items-center rounded-lg border transition hover:bg-[var(--muted)]';

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Choose icon"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="grid h-10 w-10 place-items-center rounded-lg border border-[var(--border)] bg-[var(--background)] transition hover:border-[var(--primary)]"
        style={color ? { color } : undefined}
      >
        {value ? <LucideIcon name={value} className="h-5 w-5" /> : (fallbackIcon ?? <LucideIcon name="users" className="h-5 w-5" />)}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-[var(--border)] bg-[var(--card-strong)] p-2 shadow-xl backdrop-blur-2xl">
          <div className="relative mb-2">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search icons…"
              aria-label="Search icons"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] py-1.5 pl-8 pr-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div onScroll={onScroll} className="grid max-h-52 grid-cols-6 gap-1.5 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              title="Default icon"
              aria-label="Default icon"
              className={`${cell} ${
                value == null ? 'border-[var(--primary)] text-[var(--primary)]' : 'border-transparent text-[var(--muted-foreground)]'
              }`}
            >
              <ArrowUturnLeftIcon className="h-4 w-4" />
            </button>
            {shown.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  onChange(name);
                  setOpen(false);
                }}
                title={name}
                aria-label={name}
                className={`${cell} ${
                  value === name ? 'border-[var(--primary)] text-[var(--primary)]' : 'border-transparent text-[var(--foreground)]'
                }`}
              >
                <LucideIcon name={name} className="h-4 w-4" />
              </button>
            ))}
          </div>
          <p className="pt-1.5 text-center text-[11px] text-[var(--muted-foreground)]">
            {shown.length < filtered.length ? 'Scroll for more' : `${filtered.length} icons`}
          </p>
        </div>
      )}
    </div>
  );
}
