'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Height-animated expand/collapse. The default way to reveal content in Loomi —
 * accordions, disclosure panels, inline detail rows.
 *
 * WHY A COMPONENT AND NOT JUST THE CSS CLASS. `globals.css` already has the
 * `collapsible-wrapper` grid trick (`grid-template-rows: 0fr → 1fr`, which is
 * the only way to transition to an unknown content height). But it only
 * animates a node that is ALREADY MOUNTED — the common case, conditionally
 * rendering `{open && <Panel/>}`, mounts straight into the open state and the
 * content just appears. This handles that: it mounts closed and flips open on
 * the next frame, so `mountClosed` content animates the first time too.
 *
 * `unmountOnClose` keeps the node in the tree during the closing transition and
 * removes it after, so collapsing animates instead of vanishing. Leave it off
 * when the content is expensive or holds form state you don't want re-created.
 *
 * Respects `prefers-reduced-motion` through the stylesheet, so nothing here
 * needs to special-case it.
 */
export function Collapse({
  open,
  children,
  className = '',
  innerClassName = '',
  /** Animate open on first mount. On for conditionally-rendered content. */
  mountClosed = true,
  /** Drop children from the tree once the close transition finishes. */
  unmountOnClose = false,
  /** Must match the stylesheet's transition duration. */
  durationMs = 250,
  /**
   * Keep content clipped while opening. On by default: without it the content
   * paints at full height over whatever is below for the length of the
   * transition. Turn it OFF only when something inside needs to escape the box
   * — a dropdown, a popover, a tooltip.
   */
  clip = true,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  mountClosed?: boolean;
  unmountOnClose?: boolean;
  durationMs?: number;
  clip?: boolean;
}) {
  const [shown, setShown] = useState(mountClosed ? false : open);
  const [render, setRender] = useState(open || !unmountOnClose);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (open) setRender(true);
  }, [open]);

  useEffect(() => {
    if (!render) return;
    // Two frames, not one: the browser has to commit the closed state before
    // the open one can be a transition rather than a jump.
    raf.current = requestAnimationFrame(() => {
      raf.current = requestAnimationFrame(() => setShown(open));
    });
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    };
  }, [open, render]);

  useEffect(() => {
    if (open || !unmountOnClose) return;
    const t = setTimeout(() => setRender(false), durationMs);
    return () => clearTimeout(t);
  }, [open, unmountOnClose, durationMs]);

  if (!render) return null;

  return (
    <div
      className={`collapsible-wrapper ${clip ? 'collapsible-clip' : ''} ${className}`.trim()}
      data-open={shown ? 'true' : 'false'}
    >
      <div className={`collapsible-inner ${innerClassName}`.trim()}>{children}</div>
    </div>
  );
}
