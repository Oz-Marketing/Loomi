'use client';

import {
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useSidebarCollapse } from '@/contexts/sidebar-collapse-context';
import { SidebarTooltip } from '@/components/sidebar-collapsed-ui';
import { useIsMobile } from '@/hooks/use-is-mobile';

/**
 * Shared sidebar chrome for the studio / reporting / app surfaces.
 *
 * Desktop (md+): a fixed, transparent floating rail that collapses to an icon
 * rail. Mobile (<md): an off-canvas drawer that slides in over a backdrop
 * (the backdrop + hamburger live in SurfaceShell). The collapsed rail mode is
 * desktop-only — on mobile the drawer always renders expanded.
 *
 * Only the nav items + bottom content (which differ per surface) are passed in.
 */
export function SidebarFrame({
  brand,
  account,
  bottom,
  children,
}: {
  brand: React.ReactNode;
  account?: React.ReactNode;
  bottom?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { collapsed, toggle, mobileOpen, setMobileOpen } = useSidebarCollapse();
  const isMobile = useIsMobile();
  // The icon-rail collapse is a desktop affordance; the mobile drawer is always
  // full-width/expanded regardless of the persisted collapse preference.
  const showCollapsed = collapsed && !isMobile;

  return (
    <aside
      data-collapsed={collapsed}
      className={`fixed z-50 flex flex-col overflow-visible text-[var(--sidebar-foreground)] inset-y-0 left-0 w-72 border-r border-[var(--sidebar-border)] bg-[var(--background)] transition-transform duration-200 ease-out md:inset-y-3 md:left-3 md:translate-x-0 md:rounded-2xl md:border-0 md:bg-transparent md:transition-[width] ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      } ${collapsed ? 'md:w-14' : 'md:w-60'}`}
    >
      {/* Logo + collapse/close control, with the account switcher underneath. */}
      <div className={showCollapsed ? 'p-2 pb-3' : 'px-2 pt-4 pb-3'}>
        <div className={`flex items-center ${showCollapsed ? 'justify-center' : 'justify-between'}`}>
          {!showCollapsed && brand}
          {/* Desktop: collapse toggle. */}
          <SidebarTooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <button
              type="button"
              onClick={toggle}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden h-8 w-8 items-center justify-center rounded-lg text-[var(--sidebar-muted-foreground)] transition hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)] md:inline-flex"
            >
              {collapsed ? (
                <ChevronDoubleRightIcon className="h-4 w-4" />
              ) : (
                <ChevronDoubleLeftIcon className="h-4 w-4" />
              )}
            </button>
          </SidebarTooltip>
          {/* Mobile: close the drawer. */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--sidebar-muted-foreground)] transition hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)] md:hidden"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        {account && <div className={showCollapsed ? 'mt-2 flex justify-center' : 'mt-3'}>{account}</div>}
      </div>

      <nav className={`flex-1 space-y-px overflow-y-auto ${showCollapsed ? 'px-1.5 py-2' : 'px-2 py-2'}`}>
        {children}
      </nav>

      {bottom}
    </aside>
  );
}
