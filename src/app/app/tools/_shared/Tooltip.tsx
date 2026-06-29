'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Loomi tooltip. Wraps any trigger and shows `label` on hover/focus. The bubble
 * is rendered through a portal on document.body and pinned with fixed coords, so
 * it is never clipped by an ancestor's `overflow-hidden` or scroll container —
 * the planner/pacer are full of rounded, clipped cards, bars and tables. The
 * wrapper is a bare `inline-flex` (no `relative`), so a passed-in `className`
 * may freely position it (`absolute …` corner buttons) or shape it (flex/grid
 * bar segments via `className`/`style`). `placement` puts the bubble above
 * (default) or below the trigger.
 */
export function Tooltip({
  label,
  placement = 'top',
  className = '',
  style,
  children,
}: {
  label: ReactNode;
  placement?: 'top' | 'bottom';
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(
    null,
  );

  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({
      left: r.left + r.width / 2,
      top: placement === 'bottom' ? r.bottom + 6 : r.top - 6,
    });
  }, [placement]);

  const hide = useCallback(() => setCoords(null), []);

  // Dismiss on scroll/resize rather than re-pinning. The planner scrolls under a
  // fixed cursor, so icons drift beneath the pointer and fire mouseenter on each
  // one in turn; re-pinning would keep every one of them alive as a trail of
  // stuck tooltips. Closing on scroll keeps the tooltip strictly hover-only —
  // it reappears only on a fresh hover once scrolling stops.
  useEffect(() => {
    if (!coords) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [coords, hide]);

  return (
    <span
      ref={ref}
      className={`inline-flex ${className}`.trim()}
      style={style}
      onMouseEnter={place}
      onMouseLeave={hide}
      onFocus={place}
      onBlur={hide}
    >
      {children}
      {coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <span
            role="tooltip"
            style={{
              position: 'fixed',
              left: coords.left,
              top: coords.top,
              transform:
                placement === 'bottom'
                  ? 'translate(-50%, 0)'
                  : 'translate(-50%, -100%)',
            }}
            className="pointer-events-none z-[1000] w-max max-w-[340px] whitespace-normal text-center rounded-md border border-[var(--border)] bg-[var(--card-strong)] px-2.5 py-1.5 text-[10px] font-medium leading-snug text-[var(--foreground)] shadow-lg backdrop-blur-sm"
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
