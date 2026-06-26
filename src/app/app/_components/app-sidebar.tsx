'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarIcon,
  CogIcon,
  PlusIcon,
  RectangleStackIcon,
  TableCellsIcon,
  UserCircleIcon,
  UsersIcon,
  ViewColumnsIcon,
} from '@heroicons/react/24/outline';
import { useSidebarCollapse } from '@/contexts/sidebar-collapse-context';
import { SidebarTooltip } from '@/components/sidebar-collapsed-ui';
import { SidebarFrame } from '@/components/sidebar-frame';

/**
 * App-surface sidebar (Projects). Branding + nav only — user identity, theme
 * toggle, Studio cross-link, and sign-out live in the top-bar dropdown.
 *
 * Hrefs are BROWSER-facing paths on `app.loomilm.com`; the proxy rewrites
 * `/projects/*` → `/app/projects/*`, and `usePathname()` returns the browser
 * URL, so active-state comparison uses the un-rewritten path.
 *
 * No account switcher: Projects is cross-account (My Work and the board span
 * every account the user can see), so account filtering is a per-view control.
 */

type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: typeof RectangleStackIcon;
  matchExact?: boolean;
};

const NAV: NavItem[] = [
  { key: 'initiatives', label: 'Initiatives', href: '/projects', icon: RectangleStackIcon, matchExact: true },
  { key: 'board', label: 'Board', href: '/projects/board', icon: ViewColumnsIcon },
  { key: 'table', label: 'Table', href: '/projects/table', icon: TableCellsIcon },
  { key: 'my-work', label: 'My Work', href: '/projects/my-work', icon: UserCircleIcon },
  { key: 'calendar', label: 'Calendar', href: '/projects/calendar', icon: CalendarIcon },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { collapsed } = useSidebarCollapse();
  const teamsActive = pathname.startsWith('/projects/teams');

  const isActive = (item: NavItem) =>
    item.matchExact ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <SidebarFrame
      brand={
        <Link href="/projects" className="block">
          <div className="text-base font-semibold tracking-tight">
            loomi
          </div>
        </Link>
      }
      bottom={
        <div className={collapsed ? 'p-2' : 'px-2 py-2'}>
          <BottomLink
            href="/projects/teams"
            label="Teams"
            icon={CogIcon}
            active={teamsActive}
            collapsed={collapsed}
          />
        </div>
      }
    >
      {/* New ticket — primary CTA */}
      <NewTicketButton collapsed={collapsed} />

      <div className="mt-1 space-y-px">
        {NAV.map((item) => (
          <LeafNav key={item.key} item={item} collapsed={collapsed} active={isActive(item)} />
        ))}
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
          ? 'bg-[var(--primary)] text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)]'
          : 'text-[var(--sidebar-muted-foreground)] hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)]'
      }`}
    >
      <item.icon className="h-5 w-5" />
      {!collapsed && item.label}
    </Link>
  );
  return collapsed ? <SidebarTooltip label={item.label}>{link}</SidebarTooltip> : link;
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
          ? 'bg-[var(--primary)] text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)]'
          : 'text-[var(--sidebar-muted-foreground)] hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)]'
      }`}
    >
      <Icon className="h-5 w-5" />
      {!collapsed && label}
    </Link>
  );
  return collapsed ? <SidebarTooltip label={label}>{link}</SidebarTooltip> : link;
}
