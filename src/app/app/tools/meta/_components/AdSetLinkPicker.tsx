'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDownIcon,
  LinkSlashIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { MetaBrandIcon } from '@/components/icons/platform-logos';
import { Tooltip } from '@/app/app/tools/_shared';

// Meta-only ad-set link picker — passed into the shared <PacerRow> as its
// linkPicker slot. Split out of MetaAdsPlannerTool to shrink the file.
export interface MetaAdSetOption {
  id: string;
  name: string;
  effectiveStatus: string | null;
  /** Parent campaign, shown as context so similar ad-set names are distinct. */
  campaignName: string | null;
}

/**
 * Searchable ad-set link picker — a custom combobox replacing the native
 * <select>. Accounts can have dozens of ad sets with long, similar names, so a
 * type-to-filter box (matching campaign + ad set + status) is far faster than
 * scrolling a plain dropdown. Lazy-loads the list on first open, closes on
 * outside-click / Escape.
 */
export function AdSetLinkPicker({
  value,
  options,
  loading,
  error,
  onOpen,
  onChange,
  disabled,
}: {
  value: string | null;
  options: MetaAdSetOption[] | null;
  loading: boolean;
  error: string | null;
  onOpen: () => void;
  onChange: (id: string | null) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
  } | null>(null);

  // Portal the panel to <body> with fixed coords so it escapes the card's
  // overflow-hidden + backdrop-filter and any scroll container that would
  // otherwise clip an absolutely-positioned dropdown. Flips above the trigger
  // when there isn't room below.
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const estHeight = 340;
    const spaceBelow = window.innerHeight - rect.bottom;
    // Flip above only when there isn't room below AND there's more room above.
    // When flipping, anchor by the panel's *bottom* edge to the trigger's top
    // rather than computing a top from a height estimate — a short list (a few
    // ad sets) is far shorter than `estHeight`, so a top-anchored flip would
    // leave it floating hundreds of px above the trigger. Bottom-anchoring
    // keeps it glued to the trigger no matter how tall the list actually is.
    if (spaceBelow < estHeight && rect.top > spaceBelow) {
      setPos({
        bottom: window.innerHeight - rect.top + 4,
        left: rect.left,
        width: rect.width,
      });
    } else {
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onScroll = () => updatePosition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = (o: MetaAdSetOption) =>
    `${o.campaignName ? `${o.campaignName} › ` : ''}${o.name}`;
  const selected = (options ?? []).find((o) => o.id === value) ?? null;
  const q = query.trim().toLowerCase();
  const filtered = (options ?? []).filter((o) =>
    `${o.campaignName ?? ''} ${o.name} ${o.effectiveStatus ?? ''}`
      .toLowerCase()
      .includes(q),
  );

  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <>
      {value ? (
        // Linked: show the ad-set NAME (never the raw id) + a quick Unlink.
        // Clicking the name reopens the list to change the link.
        <div className="flex items-center gap-1.5 min-w-0">
          <Tooltip label="Linked to a Meta ad set — click to change" className="min-w-0">
          <button
            ref={triggerRef}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              if (!open) {
                onOpen();
                setQuery('');
              }
              setOpen((v) => !v);
            }}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] px-2.5 py-1 text-xs text-[var(--foreground)] hover:border-[var(--primary)] focus:outline-none focus:border-[var(--primary)] disabled:opacity-60"
          >
            <MetaBrandIcon className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate font-medium">
              {loading && !options ? 'Loading…' : selected ? label(selected) : 'Linked'}
            </span>
            <ChevronDownIcon className="w-3 h-3 flex-shrink-0 text-[var(--muted-foreground)]" />
          </button>
          </Tooltip>
          <Tooltip label="Unlink ad set" className="flex-shrink-0">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            aria-label="Unlink ad set"
            className="inline-flex items-center justify-center rounded-md p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[#ef4444] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <LinkSlashIcon className="w-4 h-4" />
          </button>
          </Tooltip>
        </div>
      ) : (
        <Tooltip label="Link this line to a Meta ad set to pull its spend on Sync">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            if (!open) {
              onOpen();
              setQuery('');
            }
            setOpen((v) => !v);
          }}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#1877F2] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#1877F2]/90 focus:outline-none focus:ring-2 focus:ring-[#1877F2]/40 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <MetaBrandIcon className="w-3 h-3 flex-shrink-0 brightness-0 invert" />
          Link ad set
          <ChevronDownIcon className="w-3 h-3 flex-shrink-0 text-white/80" />
        </button>
        </Tooltip>
      )}

      {open && pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              className="glass-dropdown fixed z-[200]"
              style={{
                top: pos.top,
                bottom: pos.bottom,
                left: pos.left,
                width: Math.max(pos.width, 260),
              }}
            >
              <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-2 py-1.5">
                <MagnifyingGlassIcon className="w-3.5 h-3.5 flex-shrink-0 text-[var(--muted-foreground)]" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search ad sets…"
                  className="w-full bg-transparent text-[11px] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none"
                />
              </div>
              <div className="max-h-64 overflow-y-auto themed-scrollbar py-1">
                {loading ? (
                  <div className="px-2.5 py-2 text-[11px] text-[var(--muted-foreground)]">
                    Loading ad sets…
                  </div>
                ) : error ? (
                  <div className="px-2.5 py-2 text-[11px] text-[#ef4444]">
                    {error}
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => pick(null)}
                      className={`flex w-full px-2.5 py-1.5 text-left text-[11px] hover:bg-[var(--muted)] ${
                        value
                          ? 'text-[var(--muted-foreground)]'
                          : 'font-medium text-[var(--foreground)]'
                      }`}
                    >
                      Not linked — match by name
                    </button>
                    {filtered.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => pick(o.id)}
                        className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-[11px] hover:bg-[var(--muted)] ${
                          o.id === value ? 'bg-[var(--muted)]/60 font-medium' : ''
                        }`}
                      >
                        <span className="min-w-0 flex-1 text-[var(--foreground)]">
                          {o.campaignName && (
                            <span className="text-[var(--muted-foreground)]">
                              {o.campaignName} ›{' '}
                            </span>
                          )}
                          {o.name}
                        </span>
                        {o.effectiveStatus && (
                          <span className="flex-shrink-0 text-[9px] uppercase tracking-wide text-[var(--muted-foreground)] mt-0.5">
                            {o.effectiveStatus}
                          </span>
                        )}
                      </button>
                    ))}
                    {filtered.length === 0 && (
                      <div className="px-2.5 py-2 text-[11px] text-[var(--muted-foreground)]">
                        No ad sets match “{query}”.
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
