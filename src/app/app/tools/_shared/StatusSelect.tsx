'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon, CheckIcon } from '@heroicons/react/24/outline';

/**
 * Monday-style status dropdown. The trigger renders the current value as a
 * full-width colored chip (matching the chosen status's theme). The popover
 * shows every option as its own colored chip — click to commit. Falls back
 * to the muted treatment when a status isn't in the colorMap.
 */
export function StatusSelect({
  value,
  options,
  onChange,
  colorMap,
  className,
  size = 'md',
  ariaLabel,
}: {
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
  /** [bg, fg] tuple per option. Missing keys fall back to muted. */
  colorMap: Record<string, [string, string]>;
  className?: string;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const margin = 8;
    const popoverHeight = Math.min(360, options.length * 40 + 16);
    let top = rect.bottom + 4;
    if (top + popoverHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - popoverHeight - 4);
    }
    setPos({ top, left: rect.left, width: rect.width });
  }, [options.length]);

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
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const [bg, fg] = colorMap[value] ?? ['var(--muted)', 'var(--muted-foreground)'];
  const heightClass = size === 'sm' ? 'py-1.5' : 'py-2';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? value}
        className={`w-full inline-flex items-center justify-center gap-1.5 rounded-lg ${heightClass} px-3 text-xs font-bold uppercase tracking-wider transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40 ${className ?? ''}`}
        style={{ background: bg, color: fg }}
      >
        <span className="truncate">{value || '—'}</span>
        <ChevronDownIcon className="w-3 h-3 flex-shrink-0 opacity-70" />
      </button>

      {open && pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              role="listbox"
              className="fixed z-[200] rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-2xl p-1.5"
              style={{
                top: pos.top,
                left: pos.left,
                width: Math.max(pos.width, 200),
              }}
            >
              <div className="max-h-[360px] overflow-y-auto themed-scrollbar space-y-1">
                {options.map((option) => {
                  const [optBg, optFg] = colorMap[option] ?? [
                    'var(--muted)',
                    'var(--muted-foreground)',
                  ];
                  const selected = option === value;
                  return (
                    <button
                      key={option}
                      role="option"
                      type="button"
                      aria-selected={selected}
                      onClick={() => {
                        onChange(option);
                        setOpen(false);
                      }}
                      className="w-full inline-flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-opacity focus:outline-none"
                      style={{
                        background: optBg,
                        color: optFg,
                        boxShadow: selected
                          ? `inset 0 0 0 2px ${optFg}`
                          : undefined,
                      }}
                    >
                      <span className="truncate text-left">{option}</span>
                      {selected && (
                        <CheckIcon className="w-3.5 h-3.5 flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
