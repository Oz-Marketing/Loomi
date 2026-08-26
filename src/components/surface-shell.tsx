'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useDockedScroll } from '@/hooks/use-docked-scroll';
import { Bars3Icon } from '@heroicons/react/24/outline';
import { useSidebarCollapse } from '@/contexts/sidebar-collapse-context';
import { useAiPanel, AI_PANEL_WIDTH } from '@/contexts/ai-panel-context';

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
  const { collapsed, setAutoCollapsed, mobileOpen, setMobileOpen } = useSidebarCollapse();
  const { isOpen, expanded, setSlotEl } = useAiPanel();
  // Expanded covers the page, so the content column must reclaim its width.
  const aiOpen = isOpen && !expanded;
  const pathname = usePathname();
  const mainRef = useRef<HTMLDivElement>(null);

  // The AI panel takes a rail's worth of width off the right, so give it back by
  // folding the nav on the left. Temporary — `setAutoCollapsed` deliberately does
  // not touch the saved preference, so closing the panel restores whatever the
  // user actually chose.
  useEffect(() => {
    setAutoCollapsed(aiOpen);
  }, [aiOpen, setAutoCollapsed]);

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

  // Paints the pinned header's backdrop once the card scrolls.
  useDockedScroll(mainRef);

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
          {/* The rounded clip lives on this NON-scrolling wrapper so the
              scroller inside stays a plain, unpromoted scroll container. */}
          {/* Page card + AI panel share one row. The panel is a SIBLING of the card,
              which is what keeps the utility header above at full width and gives
              the panel the card's exact top, height and rounding for free — no
              fixed positioning, no hardcoded offset to the header. */}
          <div className="relative flex flex-1 min-h-0 gap-3">
          <div className="relative flex-1 min-w-0 min-h-0 overflow-hidden rounded-2xl">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-2xl border border-[var(--border)] bg-[var(--card)] backdrop-blur-xl shadow-sm"
            />
            {/* Plain scroll container — deliberately NOT GPU-promoted.
                A hairline of scrolled-away content used to show along the card's
                top edge, and this element carried a `translateZ(0)` blamed for
                fixing it. It never did: the culprit was `.page-sticky-header`'s
                1px transparent border, which its backdrop pseudo-element didn't
                cover (see globals.css). Proven with a clip-path on the wrapper —
                authoritative, and the hairline survived it — so nothing was
                escaping the clip in the first place. Promotion here is not free:
                it would make this element the containing block for every
                `position: fixed` descendant. */}
            <div
              ref={mainRef}
              data-scrolled="false"
              className="relative h-full overflow-y-auto overflow-x-hidden overscroll-contain rounded-2xl px-6 md:px-8 pb-6 md:pb-8"
            >
              {/* Rest-state clearance above a pinned page header. Scrolls away
                  under the docked bar, so the header itself never resizes. */}
              <div aria-hidden className="content-dock-lead" />
              {children}
            </div>
          </div>
          {/* The slot the panel portals into. Only exists while open, so it takes
              no space otherwise. Below `md` there is no room to split the screen,
              so it overlays the card instead of shrinking it. */}
          {aiOpen && (
            <div
              ref={setSlotEl}
              style={{ ['--ai-panel-w' as string]: AI_PANEL_WIDTH }}
              className="relative z-30 max-md:absolute max-md:inset-0 max-md:w-full md:w-[var(--ai-panel-w)] md:shrink-0"
            />
          )}
          </div>
        </div>
      </main>
    </>
  );
}
