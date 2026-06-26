'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
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
  const { collapsed } = useSidebarCollapse();
  const pathname = usePathname();
  const mainRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

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
      {/* Fixed-height column: the top bar + card never scroll; only the
          card's inner content does. */}
      <main
        className={`flex-1 min-w-0 h-screen flex flex-col overflow-hidden p-3 transition-[padding-left] duration-200 ease-out ${
          collapsed ? 'pl-[4.5rem]' : 'pl-[16.5rem]'
        }`}
      >
        <div className="flex w-full flex-1 flex-col min-h-0 gap-3">
          {topBar}
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
