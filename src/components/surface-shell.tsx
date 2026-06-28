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
  // opaque state). Re-sync on navigation since the card element persists.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const onScroll = () => setScrolled(main.scrollTop > 0);
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
          <div
            ref={mainRef}
            data-scrolled={scrolled ? 'true' : 'false'}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain rounded-2xl border border-[var(--border)] bg-[var(--card)] backdrop-blur-xl shadow-sm px-6 md:px-8 pb-6 md:pb-8"
          >
            {children}
          </div>
        </div>
      </main>
    </>
  );
}
