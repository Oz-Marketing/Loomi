'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Bars3Icon } from '@heroicons/react/24/outline';
import { useSidebarCollapse } from '@/contexts/sidebar-collapse-context';

/**
 * Shared shell layout for BOTH the studio and reporting surfaces.
 *
 * It owns only the structure + behavior — a fixed sidebar rail plus a
 * fixed-height main column where the top bar stays put and only the rounded
 * content card scrolls. The card carries `data-scrolled` so a pinned
 * `.page-sticky-header` inside it can go opaque on scroll. Collapse padding
 * comes from the shared sidebar-collapse context.
 *
 * Surface-specific chrome (the sidebar, the top bar) is passed in, so the
 * reskin lives in exactly one place instead of being duplicated per surface.
 */
export function SurfaceShell({
  sidebar,
  topBar,
  children,
}: {
  sidebar: React.ReactNode;
  topBar: React.ReactNode;
  children: React.ReactNode;
}) {
  const { collapsed, mobileOpen, setMobileOpen } = useSidebarCollapse();
  const pathname = usePathname();
  const mainRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  // Close the mobile drawer on navigation (e.g. tapping a nav link).
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  // Close the mobile drawer on Escape.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, setMobileOpen]);

  // Track whether the content card has scrolled (drives the pinned header's
  // opaque + compacted state). Re-sync on navigation since the card element
  // persists.
  //
  // The docked header compacts its top padding, which SHORTENS the header by
  // ~14–20px. On a page that only just overflows, docking removes enough
  // height to clamp scrollTop back under the trigger, which un-docks, which
  // restores the height — a feedback loop that reads as scroll jitter. Two
  // guards kill it:
  //   1. Hysteresis — dock past DOCK_ON, only pop back up below DOCK_OFF, so a
  //      single boundary can't flip the state twice per gesture.
  //   2. A minimum scroll range — never dock unless the page overflows by more
  //      than the compaction delta (measured while un-docked, so it reflects
  //      the rest-state range). Below that, docking would always clamp-bounce,
  //      so we simply stay at rest. Barely-scrolling pages lose the compaction,
  //      which is invisible there anyway.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const DOCK_ON = 16; // enter docked once scrolled past this
    const DOCK_OFF = 4; // leave docked once back under this (hysteresis)
    const MIN_RANGE = 48; // rest-state overflow required to dock at all
    const onScroll = () =>
      setScrolled((prev) => {
        const top = main.scrollTop;
        if (prev) return top > DOCK_OFF;
        const restRange = main.scrollHeight - main.clientHeight; // un-docked here
        if (restRange < MIN_RANGE) return false;
        return top > DOCK_ON;
      });
    onScroll();
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, [pathname]);

  return (
    <>
      {sidebar}

      {/* Mobile drawer backdrop — sits below the sidebar (z-50) but above
          content; tapping it closes the drawer. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* Fixed-height column: the top bar + card never scroll; only the
          card's inner content does. On mobile the sidebar is an off-canvas
          drawer, so the column spans full width (just the p-3 gutter); from
          md up it offsets by the rail width. */}
      <main
        className={`flex-1 min-w-0 h-screen flex flex-col overflow-hidden p-3 transition-[padding-left] duration-200 ease-out ${
          collapsed ? 'md:pl-[4.5rem]' : 'md:pl-[16.5rem]'
        }`}
      >
        <div className="flex w-full flex-1 flex-col min-h-0 gap-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] md:hidden"
            >
              <Bars3Icon className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">{topBar}</div>
          </div>
          {/* The frosted card look lives on a SEPARATE background layer, not on
              the scroll container. `backdrop-filter` (backdrop-blur) creates a
              containing block for position:fixed descendants — if it were on the
              element holding the page content, every `fixed inset-0` modal would
              be trapped inside this card instead of covering the viewport. Keeping
              the blur on a sibling layer preserves the look while letting modals
              go truly full-screen. */}
          <div className="relative flex-1 min-h-0">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-2xl border border-[var(--border)] bg-[var(--card)] backdrop-blur-xl shadow-sm"
            />
            <div
              ref={mainRef}
              data-scrolled={scrolled ? 'true' : 'false'}
              className="relative h-full overflow-y-auto overflow-x-hidden overscroll-contain rounded-2xl px-6 md:px-8 pb-6 md:pb-8"
            >
              {children}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
