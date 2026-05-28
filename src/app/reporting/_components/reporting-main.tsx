'use client';

import { useSidebarCollapse } from '@/contexts/sidebar-collapse-context';

/**
 * Client wrapper around the reporting `<main>` element. Reads the
 * shared sidebar collapse state and switches left padding so the
 * content reflows when the sidebar collapses/expands. Same `pl` values
 * as the studio AppShell — visual parity across surfaces.
 */
export function ReportingMain({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebarCollapse();
  return (
    <main
      className={`flex-1 min-w-0 h-screen overflow-y-auto overflow-x-hidden overscroll-contain p-8 transition-[padding-left] duration-200 ease-out ${
        collapsed ? 'pl-[7.5rem]' : 'pl-[18.5rem]'
      }`}
    >
      {children}
    </main>
  );
}
