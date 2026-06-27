'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarIcon,
  ChevronDownIcon,
  CogIcon,
  MegaphoneIcon,
  PlusIcon,
  RectangleStackIcon,
  UserCircleIcon,
  UsersIcon,
  ViewColumnsIcon,
} from '@heroicons/react/24/outline';
import { useSidebarCollapse } from '@/contexts/sidebar-collapse-context';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { SidebarTooltip, SidebarPopout } from '@/components/sidebar-collapsed-ui';
import { SidebarFrame } from '@/components/sidebar-frame';
import { AccountSwitcher } from '@/components/account-switcher';
import { SurfaceSwitch } from '@/components/surface-switch';
import { MetaBrandIcon, GoogleAdsBrandIcon } from '@/components/icons/platform-logos';
import { LoomiWordmark } from './loomi-wordmark';

/**
 * App-surface sidebar. Branding + nav only — user identity, theme toggle,
 * Studio cross-link, and sign-out live in the top-bar dropdown.
 *
 * Hrefs are BROWSER-facing paths on `app.loomilm.com`; the proxy rewrites
 * `/projects/*` → `/app/projects/*` and `/tools/*` → `/app/tools/*`, and
 * `usePathname()` returns the browser URL, so active-state comparison uses the
 * un-rewritten path.
 *
 * Account switcher under the logo (shared with studio/reporting via the
 * active-account cookie): picking a sub-account scopes Initiatives, Tasks,
 * Calendar, and the Ad Pacer to it; Admin shows everything. My Work stays
 * personal (your assigned tasks across every account).
 */

type IconType = React.ComponentType<{ className?: string }>;

type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: IconType;
  matchExact?: boolean;
  /** Active-state prefix when it differs from `href` (e.g. a section root). */
  match?: string;
};

type NavGroup = {
  key: string;
  label: string;
  icon: IconType;
  children: NavItem[];
};

type NavEntry = NavItem | NavGroup;

const isGroup = (e: NavEntry): e is NavGroup => 'children' in e;

const NAV: NavEntry[] = [
  { key: 'initiatives', label: 'Initiatives', href: '/projects', icon: RectangleStackIcon, matchExact: true },
  { key: 'tasks', label: 'Tasks', href: '/projects/tasks', icon: ViewColumnsIcon },
  { key: 'my-work', label: 'My Work', href: '/projects/my-work', icon: UserCircleIcon },
  { key: 'calendar', label: 'Calendar', href: '/projects/calendar', icon: CalendarIcon },
  // Ad Planning & Pacing — Meta and Google kept fully separate (different
  // specialists). Relocated from Studio /tools/*; the proxy rewrites those to
  // /app/tools/* on this host. Account-scoped by the global selector.
  {
    key: 'ads',
    label: 'Ad Planning & Pacing',
    icon: MegaphoneIcon,
    children: [
      { key: 'ads-meta', label: 'Meta', href: '/tools/meta', icon: MetaBrandIcon, match: '/tools/meta' },
      { key: 'ads-google', label: 'Google', href: '/tools/google/ad-pacer', icon: GoogleAdsBrandIcon, match: '/tools/google' },
    ],
  },
];

function itemActive(item: NavItem, pathname: string): boolean {
  return item.matchExact ? pathname === item.href : pathname.startsWith(item.match ?? item.href);
}

export function AppSidebar() {
  const pathname = usePathname();
  const { collapsed } = useSidebarCollapse();
  const isMobile = useIsMobile();
  // The icon-rail collapse is desktop-only; the mobile drawer always renders
  // nav items expanded regardless of the persisted collapse preference.
  const showCollapsed = collapsed && !isMobile;
  const settingsActive = pathname.startsWith('/settings');

  return (
    <SidebarFrame
      brand={
        <Link href="/projects" className="block text-[var(--sidebar-foreground)]">
          <LoomiWordmark className="h-8 w-auto" />
        </Link>
      }
      account={showCollapsed ? <AccountSwitcher compact /> : <AccountSwitcher />}
      bottom={
        <>
          {/* Quick switch between Projects (App) and Studio. */}
          <div className="px-2 pb-1">
            <SurfaceSwitch collapsed={showCollapsed} />
          </div>
          <div className={showCollapsed ? 'p-2' : 'px-2 py-2'}>
            <BottomLink
              href="/settings"
              label="Settings"
              icon={CogIcon}
              active={settingsActive}
              collapsed={showCollapsed}
            />
          </div>
        </>
      }
    >
      {/* New ticket — primary CTA */}
      <NewTicketButton collapsed={showCollapsed} />

      <div className="mt-4 space-y-px">
        {NAV.map((entry) =>
          isGroup(entry) ? (
            <GroupNav key={entry.key} group={entry} collapsed={showCollapsed} pathname={pathname} />
          ) : (
            <LeafNav
              key={entry.key}
              item={entry}
              collapsed={showCollapsed}
              active={itemActive(entry, pathname)}
            />
          ),
        )}
      </div>
    </SidebarFrame>
  );
}

function NewTicketButton({ collapsed }: { collapsed: boolean }) {
  const link = (
    <Link
      href="/projects/new"
      className={`flex items-center ${
        collapsed ? 'justify-center px-2' : 'gap-2 px-3'
      } rounded-xl py-2 text-sm font-medium bg-[var(--primary)] text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)] transition hover:opacity-90`}
    >
      <PlusIcon className="h-5 w-5" />
      {!collapsed && 'New ticket'}
    </Link>
  );
  return collapsed ? <SidebarTooltip label="New ticket">{link}</SidebarTooltip> : link;
}

function LeafNav({
  item,
  collapsed,
  active,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
}) {
  const link = (
    <Link
      href={item.href}
      className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} rounded-xl py-2 text-sm font-normal transition-all duration-200 ${
        active
          ? 'bg-[var(--primary)]/10 text-[var(--primary)] font-medium'
          : 'text-[var(--sidebar-muted-foreground)] hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)]'
      }`}
    >
      <item.icon className="h-5 w-5" />
      {!collapsed && item.label}
    </Link>
  );
  return collapsed ? <SidebarTooltip label={item.label}>{link}</SidebarTooltip> : link;
}

/** A collapsible parent with child links (e.g. Ad Planning & Pacing → Meta/Google). */
function GroupNav({
  group,
  collapsed,
  pathname,
}: {
  group: NavGroup;
  collapsed: boolean;
  pathname: string;
}) {
  const childActive = group.children.some((c) => pathname.startsWith(c.match ?? c.href));
  const [open, setOpen] = useState(childActive);
  // Auto-expand when navigating into one of the children.
  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  // Collapsed desktop rail → icon trigger with a flyout of the children.
  if (collapsed) {
    return (
      <SidebarPopout label={group.label} icon={group.icon} active={childActive}>
        {group.children.map((c) => {
          const active = pathname.startsWith(c.match ?? c.href);
          return (
            <Link
              key={c.key}
              href={c.href}
              role="menuitem"
              className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                active
                  ? 'bg-[var(--sidebar-muted)] font-medium text-[var(--primary)]'
                  : 'text-[var(--sidebar-muted-foreground)] hover:bg-[var(--sidebar-muted)]/60 hover:text-[var(--sidebar-foreground)]'
              }`}
            >
              <c.icon className="h-4 w-4" />
              {c.label}
            </Link>
          );
        })}
      </SidebarPopout>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-normal transition-all duration-200 ${
          childActive
            ? 'text-[var(--sidebar-foreground)]'
            : 'text-[var(--sidebar-muted-foreground)] hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)]'
        }`}
      >
        <group.icon className="h-5 w-5" />
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDownIcon className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-px space-y-px pl-4">
          {group.children.map((c) => {
            const active = pathname.startsWith(c.match ?? c.href);
            return (
              <Link
                key={c.key}
                href={c.href}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-all duration-200 ${
                  active
                    ? 'bg-[var(--primary)]/10 font-medium text-[var(--primary)]'
                    : 'text-[var(--sidebar-muted-foreground)] hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)]'
                }`}
              >
                <c.icon className="h-4 w-4" />
                {c.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BottomLink({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
}: {
  href: string;
  label: string;
  icon: typeof UsersIcon;
  active: boolean;
  collapsed: boolean;
}) {
  const link = (
    <Link
      href={href}
      className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} rounded-xl py-2 text-sm font-normal transition-all duration-200 ${
        active
          ? 'bg-[var(--primary)]/10 text-[var(--primary)] font-medium'
          : 'text-[var(--sidebar-muted-foreground)] hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)]'
      }`}
    >
      <Icon className="h-5 w-5" />
      {!collapsed && label}
    </Link>
  );
  return collapsed ? <SidebarTooltip label={label}>{link}</SidebarTooltip> : link;
}
