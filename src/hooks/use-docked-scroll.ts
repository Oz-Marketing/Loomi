'use client';

import { useEffect, type RefObject } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Mark a scroll container as scrolled, so a pinned `.page-sticky-header` inside
 * it paints its backdrop.
 *
 * Extracted from `surface-shell.tsx`, which owned it privately. The media
 * library renders its own chrome — no sidebar, so no SurfaceShell — and
 * therefore had no `data-scrolled` on its scroller at all: the sticky header sat
 * transparent over the grid and you could read the content straight through it.
 * Copying the logic would have meant duplicating two decisions the original
 * comments describe as learned the hard way, so it lives here instead.
 *
 * Those two decisions, preserved:
 *
 *   1. The attribute is written DIRECTLY to the DOM rather than through React
 *      state. Docking is a paint-only change to one pseudo-element, so there is
 *      nothing to re-render — and routing it through state re-rendered the whole
 *      page subtree mid-gesture, exactly when you can least afford the work.
 *   2. Hysteresis: dock past DOCK_ON, undock only below DOCK_OFF. One boundary
 *      can flip twice inside a single trackpad wobble; two can't.
 *
 * Deliberately NOT here: any resize on dock. Docking used to shrink the header
 * ~20px, which moved scrollHeight and let scroll anchoring shove scrollTop
 * around. It is now paint-only (see `.page-sticky-header` in globals.css).
 * Anything that changes layout on `data-scrolled` brings the jitter straight
 * back.
 */

/** Dock once scrolled past this. */
const DOCK_ON = 14;
/** Undock once back under this — the hysteresis gap is the point. */
const DOCK_OFF = 6;

export function useDockedScroll(ref: RefObject<HTMLElement | null>) {
  // Re-sync on navigation: the scroll element persists across route changes, so
  // its attribute can otherwise describe the previous page's scroll position.
  const pathname = usePathname();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let docked = el.dataset.scrolled === 'true';
    const apply = (next: boolean) => {
      if (next === docked) return;
      docked = next;
      el.dataset.scrolled = next ? 'true' : 'false';
    };

    const onScroll = () =>
      apply(docked ? el.scrollTop > DOCK_OFF : el.scrollTop > DOCK_ON);

    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [ref, pathname]);
}
