'use client';

import { useEffect, useRef } from 'react';

// Click-anchored floating popout used by FlowBuilder for both the
// inspector (when a node is selected) and the step picker (when the
// empty canvas is clicked). Replaces the right-side inspector drawer
// and the modal step picker — both now live as the same shape of
// floating card next to wherever the user clicked.
//
// Positioning is relative to the canvas wrapper (which must be
// `position: relative`). The caller passes a target screen-space point
// (clientX/clientY relative to the wrapper); this component takes care
// of the flip-into-bounds logic so the popout never sits half-off the
// canvas.

interface BuilderPopoutProps {
  /** Coordinates relative to the popout's positioned parent (the
   *  canvas wrapper). The popout's TOP-LEFT defaults to these — see
   *  `anchor` to pin a different corner. */
  x: number;
  y: number;
  /** Which corner of the popout sits at (x, y). Defaults to top-left.
   *  Use `top-right` when anchoring to the right edge of a node so
   *  the popout opens leftward, etc. */
  anchor?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Width in px. Defaults to 440 — fits the inspector content
   *  comfortably without dominating the canvas. */
  width?: number;
  /** Max-height as a CSS value (px or %). Defaults to 75vh so the
   *  popout never escapes the viewport. Internal scroll handles
   *  overflow. */
  maxHeight?: string;
  /** Bounds for the flip-into-canvas logic. Defaults to the popout's
   *  positioned parent's client rect. */
  containerBounds?: { width: number; height: number };
  onClose: () => void;
  children: React.ReactNode;
}

const PAD = 12;

export function BuilderPopout({
  x,
  y,
  anchor = 'top-left',
  width = 440,
  maxHeight = '75vh',
  containerBounds,
  onClose,
  children,
}: BuilderPopoutProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // ── Outside-click + Esc to close ──
  // The mousedown handler fires before the wrapped React onClick, so
  // pointer events on the popout itself don't trigger close (the ref
  // contains check guards that). Esc is a global keydown — typing in
  // an input inside the popout shouldn't trigger close because Esc
  // doesn't blur or bubble in a way that hits the popout's children
  // before us.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      // Dropdowns opened from inside the popout (the merge-tag picker,
      // SearchableSelect, …) render through a portal to document.body, so
      // they sit OUTSIDE this ref's subtree. A click within one must not
      // dismiss the popout — they opt out by tagging their portal root with
      // `data-builder-popout-portal`.
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-builder-popout-portal]')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // ── Translate the anchor into top/left CSS coordinates ──
  // We compute the candidate top/left assuming the popout's natural
  // bounds (width × estimated height), then clamp into containerBounds
  // so it never escapes the canvas card.
  const naturalLeft =
    anchor === 'top-left' || anchor === 'bottom-left' ? x : x - width;
  // Use a conservative height estimate for the initial flip math;
  // the actual rendered height is capped by maxHeight so we won't be
  // off by more than a frame's worth of measurement.
  const estimatedHeight = 480;
  const naturalTop =
    anchor === 'top-left' || anchor === 'top-right'
      ? y
      : y - estimatedHeight;

  const bounds = containerBounds;
  const clampedLeft = bounds
    ? Math.max(PAD, Math.min(naturalLeft, bounds.width - width - PAD))
    : naturalLeft;
  const clampedTop = bounds
    ? Math.max(PAD, Math.min(naturalTop, bounds.height - estimatedHeight - PAD))
    : naturalTop;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      className="absolute z-30 rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] backdrop-blur-xl backdrop-saturate-150 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)] animate-chat-panel-in overflow-hidden"
      style={{
        left: clampedLeft,
        top: clampedTop,
        width,
        maxHeight,
      }}
    >
      <div className="max-h-[inherit] overflow-y-auto">{children}</div>
    </div>
  );
}
