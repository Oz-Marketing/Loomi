'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  CogIcon,
  GlobeAltIcon,
  HomeIcon,
  MegaphoneIcon,
  PaperAirplaneIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { useSidebarCollapse } from '@/contexts/sidebar-collapse-context';
import { SidebarTooltip } from '@/components/sidebar-collapsed-ui';
import { AccountSwitcher } from '@/components/account-switcher';

/**
 * Reporting sidebar — branding + nav only. User identity, theme
 * toggle, Studio cross-link, and sign-out all live in the top-bar
 * user dropdown (see `ReportingTopBar`).
 *
 * Nav hrefs are the BROWSER-facing paths on `reporting.loomilm.com`.
 * Proxy/middleware rewrites `/campaigns` → `/reporting/campaigns`
 * etc. before route matching, but `usePathname()` in client
 * components returns the browser URL, so active-state comparison uses
 * the un-rewritten path.
 */
type NavItem = {
  href: string;
  label: string;
  icon: typeof HomeIcon;
  /** When true, only the exact pathname matches (used for root `/`); otherwise a
   *  `startsWith` match treats sub-routes as active. */
  matchExact?: boolean;
};

// Reporting top-level areas. One section per studio tool area so the
// reporting nav mirrors the mental model of where data comes from:
//   - Contacts        — contact growth, lifecycle, suppressions
//   - Engagement      — messaging (campaigns) + flows analytics combined
//   - Websites        — landing page + form analytics
//   - Ads             — paid traffic overview (work happens in studio's Meta tools)
const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: HomeIcon, matchExact: true },
  { href: '/contacts', label: 'Contacts', icon: UsersIcon },
  { href: '/engagement', label: 'Engagement', icon: PaperAirplaneIcon },
  { href: '/websites', label: 'Websites', icon: GlobeAltIcon },
  { href: '/ads', label: 'Ads', icon: MegaphoneIcon },
];

export function ReportingSidebar() {
  const pathname = usePathname();
  const settingsActive = pathname.startsWith('/settings');
  const { collapsed, toggle } = useSidebarCollapse();

  return (
    <aside
      data-collapsed={collapsed}
      className={`glass-panel fixed left-3 top-3 bottom-3 z-50 flex flex-col rounded-2xl text-[var(--sidebar-foreground)] transition-[width] duration-200 ease-out ${
        collapsed ? 'w-[4.5rem]' : 'w-60'
      }`}
    >
      <div className={`border-b border-[var(--sidebar-border)] ${collapsed ? 'p-2 pb-3' : 'p-5 pb-4'}`}>
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} ${collapsed ? '' : 'mb-3'}`}>
          {!collapsed && (
            <Link href="/" className="block">
              <div className="text-base font-semibold tracking-tight">
                loomi <span className="text-[var(--primary)]">reporting</span>
              </div>
            </Link>
          )}
          <SidebarTooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <button
              type="button"
              onClick={toggle}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--sidebar-muted-foreground)] hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)] transition"
            >
              {collapsed ? (
                <ChevronDoubleRightIcon className="h-4 w-4" />
              ) : (
                <ChevronDoubleLeftIcon className="h-4 w-4" />
              )}
            </button>
          </SidebarTooltip>
        </div>
        {/* Account selector — full pill when expanded, avatar-only trigger
            when collapsed (dropdown flies out to the right of the rail).
            Same component + dropdown UI as studio, so switching is
            consistent across surfaces. */}
        {collapsed ? (
          <div className="mt-2">
            <AccountSwitcher compact />
          </div>
        ) : (
          <AccountSwitcher />
        )}
      </div>

      <nav className={`flex-1 space-y-0.5 overflow-y-auto ${collapsed ? 'p-2' : 'p-3'}`}>
        {NAV_ITEMS.map((item) => {
          const isActive = item.matchExact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          const link = (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} rounded-xl py-2.5 text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-[var(--primary)] text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)]'
                  : 'text-[var(--sidebar-muted-foreground)] hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)]'
              }`}
            >
              <item.icon className="h-5 w-5" />
              {!collapsed && item.label}
            </Link>
          );
          return collapsed ? (
            <SidebarTooltip key={item.href} label={item.label}>
              {link}
            </SidebarTooltip>
          ) : link;
        })}
      </nav>

      {/* Settings — mirrors the studio sidebar's bottom Settings link.
          /settings is rewritten to /reporting/settings on the reporting
          host (see proxy.ts); the mirror pages under /reporting/settings/
          re-export the studio settings components so the same UI renders
          on both surfaces, wrapped in whichever layout the surface uses. */}
      <div className={`border-t border-[var(--sidebar-border)] ${collapsed ? 'p-2' : 'p-3'}`}>
        {(() => {
          const settingsLink = (
            <Link
              href="/settings"
              className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} rounded-xl py-2.5 text-sm font-medium transition-all duration-200 ${
                settingsActive
                  ? 'bg-[var(--primary)] text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)]'
                  : 'text-[var(--sidebar-muted-foreground)] hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)]'
              }`}
            >
              <CogIcon className="h-5 w-5" />
              {!collapsed && 'Settings'}
            </Link>
          );
          return collapsed ? (
            <SidebarTooltip label="Settings">{settingsLink}</SidebarTooltip>
          ) : settingsLink;
        })()}
      </div>
    </aside>
  );
}
