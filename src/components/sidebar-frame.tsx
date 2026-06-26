'use client';

import {
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
} from '@heroicons/react/24/outline';
import { useSidebarCollapse } from '@/contexts/sidebar-collapse-context';
import { SidebarTooltip } from '@/components/sidebar-collapsed-ui';

/**
 * Shared sidebar rail chrome for BOTH the studio and reporting surfaces: the
 * fixed transparent rail, collapse toggle, branding + (optional) account
 * switcher header, the scrolling nav area, and a bottom slot. Only the nav
 * items + bottom content (which differ per surface) are passed in — the rail's
 * look, dimensions, and collapse behavior live here once.
 *
 * `brand` is hidden when collapsed; `account` and `bottom` should already be
 * collapse-aware (each surface reads the same shared collapse context).
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
  const { collapsed, toggle } = useSidebarCollapse();
  return (
    <aside
      data-collapsed={collapsed}
      className={`fixed left-3 top-3 bottom-3 z-50 flex flex-col rounded-2xl text-[var(--sidebar-foreground)] overflow-visible transition-[width] duration-200 ease-out ${
        collapsed ? 'w-14' : 'w-60'
      }`}
    >
      {/* Logo + collapse toggle, with the account switcher underneath. */}
      <div className={collapsed ? 'p-2 pb-3' : 'px-2 pt-4 pb-3'}>
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
          {!collapsed && brand}
          <SidebarTooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <button
              type="button"
              onClick={toggle}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--sidebar-muted-foreground)] hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)] transition"
            >
              {collapsed ? (
                <ChevronDoubleRightIcon className="w-4 h-4" />
              ) : (
                <ChevronDoubleLeftIcon className="w-4 h-4" />
              )}
            </button>
          </SidebarTooltip>
        </div>
        {account && (
          <div className={collapsed ? 'mt-2 flex justify-center' : 'mt-3'}>{account}</div>
        )}
      </div>

      <nav className={`flex-1 space-y-px overflow-y-auto ${collapsed ? 'px-1.5 py-2' : 'px-2 py-2'}`}>
        {children}
      </nav>

      {bottom}
    </aside>
  );
}
