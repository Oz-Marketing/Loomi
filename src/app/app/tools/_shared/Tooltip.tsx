'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

// useLayoutEffect warns during SSR; fall back to useEffect on the server. The
// bubble only ever renders after a client hover, so the body never runs on the
// server anyway — this just silences the dev warning.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Loomi tooltip. Wraps any trigger and shows `label` on hover/focus. The bubble
 * is rendered through a portal on document.body and pinned with fixed coords, so
 * it is never clipped by an ancestor's `overflow-hidden` or scroll container —
 * the planner/pacer are full of rounded, clipped cards, bars and tables. The
 * wrapper is a bare `inline-flex` (no `relative`), so a passed-in `className`
 * may freely position it (`absolute …` corner buttons) or shape it (flex/grid
 * bar segments via `className`/`style`). `placement` puts the bubble above
 * (default) or below the trigger.
 *
 * Collision-aware: after the bubble mounts we measure it and clamp it inside the
 * viewport — shifting horizontally so neither side leaves the screen, and
 * flipping to the other side (then clamping) if the preferred side would clip.
 * So a trigger in any corner still gets a fully-visible tooltip.
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
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  // Final top-left of the bubble (fixed coords). Null until measured — the bubble
  // renders hidden at that point so it never flashes at an unpositioned spot.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const compute = useCallback(() => {
    const trigger = ref.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;
    const t = trigger.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const M = 8; // min gap from every viewport edge
    const GAP = 6; // gap between trigger and bubble

    // Horizontal: center over the trigger, then clamp both edges into view.
    const center = t.left + t.width / 2;
    const left = Math.max(M, Math.min(center - b.width / 2, vw - b.width - M));

    // Vertical: prefer the requested side; flip to the other if it would clip.
    const above = t.top - GAP - b.height;
    const below = t.bottom + GAP;
    let top: number;
    if (placement === 'bottom') {
      top = below + b.height <= vh - M ? below : above >= M ? above : below;
    } else {
      top = above >= M ? above : below + b.height <= vh - M ? below : above;
    }
    top = Math.max(M, Math.min(top, vh - b.height - M));

    setPos({ left, top });
  }, [placement]);

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => {
    setOpen(false);
    setPos(null);
  }, []);

  // Measure + position once the bubble is in the DOM (before paint, so there's no
  // flash). Re-runs when the label changes size.
  useIsoLayoutEffect(() => {
    if (open) compute();
  }, [open, compute, label]);

  // Dismiss on scroll/resize rather than re-pinning. The planner scrolls under a
  // fixed cursor, so icons drift beneath the pointer and fire mouseenter on each
  // one in turn; re-pinning would keep every one of them alive as a trail of
  // stuck tooltips. Closing on scroll keeps the tooltip strictly hover-only —
  // it reappears only on a fresh hover once scrolling stops.
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [open, hide]);

  return (
    <span
      ref={ref}
      className={`inline-flex ${className}`.trim()}
      style={style}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <span
            ref={bubbleRef}
            role="tooltip"
            style={{
              position: 'fixed',
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              // Hidden until measured so it never paints at the unpositioned spot.
              visibility: pos ? 'visible' : 'hidden',
              // Never wider than the viewport, regardless of the label length.
              maxWidth: 'min(340px, calc(100vw - 16px))',
            }}
            className="pointer-events-none z-[1000] w-max whitespace-normal text-center rounded-md border border-[var(--border)] bg-[var(--card-strong)] px-2.5 py-1.5 text-[10px] font-medium leading-snug text-[var(--foreground)] shadow-lg backdrop-blur-sm"
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
