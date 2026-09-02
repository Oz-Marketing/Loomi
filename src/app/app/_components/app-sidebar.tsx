'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BanknotesIcon,
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
import { appSurfacePrefix, normalizeAppPath } from '@/lib/app-surface-path';
import { useSidebarCollapse } from '@/contexts/sidebar-collapse-context';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { SidebarTooltip, SidebarPopout } from '@/components/sidebar-collapsed-ui';
import { SidebarFrame } from '@/components/sidebar-frame';
import { AccountSwitcher } from '@/components/account-switcher';
import { SurfaceSwitch } from '@/components/surface-switch';
import { SettingsNav, isSettingsPath } from '@/components/settings/settings-nav';
import { MetaBrandIcon, GoogleAdsBrandIcon } from '@/components/icons/platform-logos';
import { SectorBrand } from '@/components/sector-brand';

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
 *
 * Two modes displace the nav, matching Studio and Reporting:
 *   • AGENCY VIEW — the platform-management rail (Manage/Configure), identical
 *     on every surface. No swap, no back button; the rail IS the settings rail.
 *   • SUB-ACCOUNT SETTINGS — the nav swaps to SettingsNav with a back button.
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
  /** Parked — render a disabled "Soon" row that doesn't navigate. The route
      still resolves if you type the URL, which is how dev works on it. */
  comingSoon?: boolean;
};

type NavGroup = {
  key: string;
  label: string;
  icon: IconType;
  children: NavItem[];
};

type NavEntry = NavItem | NavGroup;

const isGroup = (e: NavEntry): e is NavGroup => 'children' in e;

/**
 * Project management is parked until later this year — the only live surface on
 * this rail is Ad Planning & Pacing. The five ticket/budget destinations stay in
 * the nav as greyed "Soon" rows rather than disappearing, so the shape of what's
 * coming is still legible, and the New ticket CTA is hidden along with them
 * (there's nowhere to work a ticket once created).
 *
 * Nothing is removed: the routes still render if you type the URL, which is how
 * they get built. Flip this to `true` to resurface all six together.
 */
const PROJECTS_ENABLED = false;

const NAV: NavEntry[] = [
  { key: 'initiatives', label: 'Initiatives', href: '/projects', icon: RectangleStackIcon, matchExact: true, comingSoon: !PROJECTS_ENABLED },
  { key: 'tasks', label: 'Tasks', href: '/projects/tasks', icon: ViewColumnsIcon, comingSoon: !PROJECTS_ENABLED },
  { key: 'my-work', label: 'My Work', href: '/projects/my-work', icon: UserCircleIcon, comingSoon: !PROJECTS_ENABLED },
  { key: 'calendar', label: 'Calendar', href: '/projects/calendar', icon: CalendarIcon, comingSoon: !PROJECTS_ENABLED },
  { key: 'budget', label: 'Budget', href: '/projects/budget', icon: BanknotesIcon, comingSoon: !PROJECTS_ENABLED },
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
  // The proxy decides whether `/app` is visible in the URL, so the URL is what
  // tells us which form to emit. `prefix` goes onto every href; `pathname` is
  // normalized back to the bare form the NAV entries are declared in, so all
  // the active-state comparisons below are unchanged.
  const rawPath = usePathname();
  const prefix = appSurfacePrefix(rawPath);
  const pathname = normalizeAppPath(rawPath);
  const { collapsed } = useSidebarCollapse();
  const isMobile = useIsMobile();
  // The icon-rail collapse is desktop-only; the mobile drawer always renders
  // nav items expanded regardless of the persisted collapse preference.
  const showCollapsed = collapsed && !isMobile;
  const settingsActive = pathname.startsWith('/settings');
  // The footer Settings link goes to THIS SECTOR's settings, never to one
  // account's. An account's own configuration lives on the account (Agency
  // Settings → Accounts → the account); pointing here at
  // /settings/subaccounts/<key> is what made the sector's own screens —
  // Markup, Channels, Alerts, Client Reports — unreachable from the surface
  // that owns them.
  const subaccountSettingsHref = `${prefix}/settings`;

  return (
    <SidebarFrame
      brand={
        <Link href={`${prefix}/projects`} className="block text-[var(--sidebar-foreground)]">
          <SectorBrand surface="app" />
        </Link>
      }
      account={
        // No switcher in settings: the rail IS the settings nav here, and the
        // sections it lists belong to whichever account you arrived from —
        // leaving a picker above them invites changing account mid-edit, which
        // silently repoints the form. Dropping it also lifts "Back to <sector>"
        // to the top, which is the way out of this mode.
        isSettingsPath(pathname) ? null : showCollapsed ? (
          <AccountSwitcher compact />
        ) : (
          <AccountSwitcher />
        )
      }
      bottom={
        <>
          {/* Quick switch between Projects (App) and Studio. */}
          <div className="px-2 pb-1">
            <SurfaceSwitch collapsed={showCollapsed} />
          </div>
          <div className={showCollapsed ? 'p-2' : 'px-2 py-2'}>
            <BottomLink
              href={subaccountSettingsHref}
              label="Settings"
              icon={CogIcon}
              active={settingsActive}
              collapsed={showCollapsed}
            />
          </div>
        </>
      }
    >
      {isSettingsPath(pathname) ? (
        <SettingsNav backHref={`${prefix}/projects`} backLabel="Back to Projects" collapsed={showCollapsed} />
      ) : (
        <>
          {/* New ticket — primary CTA. Hidden while Projects is parked. */}
          {PROJECTS_ENABLED && <NewTicketButton collapsed={showCollapsed} prefix={prefix} />}

          <div className="mt-4 space-y-px">
            {NAV.map((entry) =>
              isGroup(entry) ? (
                <GroupNav
                  key={entry.key}
                  group={entry}
                  collapsed={showCollapsed}
                  pathname={pathname}
                  prefix={prefix}
                />
              ) : entry.comingSoon ? (
                <SoonLeaf key={entry.key} item={entry} collapsed={showCollapsed} />
              ) : (
                <LeafNav
                  key={entry.key}
                  item={entry}
                  collapsed={showCollapsed}
                  active={itemActive(entry, pathname)}
                  prefix={prefix}
                />
              ),
            )}
          </div>
        </>
      )}
    </SidebarFrame>
  );
}

function NewTicketButton({ collapsed, prefix }: { collapsed: boolean; prefix: string }) {
  const link = (
    <Link
      href={`${prefix}/projects/new`}
      className={`flex items-center ${
        collapsed ? 'justify-center px-2' : 'gap-2 px-3'
      } rounded-xl py-2 text-sm font-medium bg-[var(--primary)] text-[var(--primary-foreground)] accent-glow transition hover:opacity-90`}
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
  prefix,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  prefix: string;
}) {
  const link = (
    <Link
      href={`${prefix}${item.href}`}
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

/**
 * A parked destination: same row, greyed out, with a "Soon" pill and no link.
 * Mirrors the Studio rail's `comingSoon` row (`src/components/sidebar.tsx`) so
 * the two surfaces read identically.
 */
function SoonLeaf({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const row = (
    <div
      title="Coming soon"
      aria-disabled="true"
      className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} rounded-xl py-2 text-sm font-normal text-[var(--sidebar-muted-foreground)]/50 cursor-not-allowed select-none`}
    >
      <item.icon className="h-5 w-5 opacity-60" />
      {!collapsed && (
        <>
          <span className="flex-1">{item.label}</span>
          <span className="rounded-full bg-[var(--sidebar-muted)] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-[var(--sidebar-muted-foreground)]">
            Soon
          </span>
        </>
      )}
    </div>
  );
  return collapsed ? (
    <SidebarTooltip label={`${item.label} — coming soon`}>{row}</SidebarTooltip>
  ) : (
    row
  );
}

/** A collapsible parent with child links (e.g. Ad Planning & Pacing → Meta/Google). */
function GroupNav({
  group,
  collapsed,
  pathname,
  prefix,
}: {
  group: NavGroup;
  collapsed: boolean;
  pathname: string;
  prefix: string;
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
              href={`${prefix}${c.href}`}
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
                href={`${prefix}${c.href}`}
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
