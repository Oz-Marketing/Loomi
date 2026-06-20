'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronDownIcon,
  CogIcon,
  GlobeAltIcon,
  HomeIcon,
  MegaphoneIcon,
  PaperAirplaneIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { useSidebarCollapse } from '@/contexts/sidebar-collapse-context';
import { SidebarTooltip } from '@/components/sidebar-collapsed-ui';
import { SidebarFrame } from '@/components/sidebar-frame';
import { AccountSwitcher } from '@/components/account-switcher';
import { DIGITAL_ADS_REPORTS } from '../ads/_components/reports-config';

/**
 * Reporting sidebar — branding + nav only. User identity, theme toggle, Studio
 * cross-link, and sign-out live in the top-bar user dropdown.
 *
 * Nav is a flat list of leaf links plus collapsible GROUPS (e.g. Digital Ads),
 * whose children come from the report registry. The active group auto-expands,
 * open/closed state persists across navigations (localStorage), and in the
 * collapsed icon rail a group reveals its children in a hover flyout.
 *
 * Hrefs are BROWSER-facing paths on `reporting.loomilm.com`; the proxy rewrites
 * `/ads/*` → `/reporting/ads/*`, and `usePathname()` returns the browser URL,
 * so active-state comparison uses the un-rewritten path.
 */

type NavChild = { href: string; label: string; soon?: boolean };
type NavItem = {
  key: string;
  label: string;
  icon: typeof HomeIcon;
  href?: string;
  matchExact?: boolean;
  children?: NavChild[];
};

const NAV: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: HomeIcon, href: '/', matchExact: true },
  { key: 'contacts', label: 'Contacts', icon: UsersIcon, href: '/contacts' },
  { key: 'engagement', label: 'Engagement', icon: PaperAirplaneIcon, href: '/engagement' },
  { key: 'websites', label: 'Websites', icon: GlobeAltIcon, href: '/websites' },
  {
    key: 'digital-ads',
    label: 'Digital Ads',
    icon: MegaphoneIcon,
    children: DIGITAL_ADS_REPORTS.map((r) => ({
      href: `/ads/${r.key}`,
      label: r.label,
      soon: r.status !== 'live',
    })),
  },
];

const OPEN_GROUPS_KEY = 'reporting.sidebar.openGroups';

export function ReportingSidebar() {
  const pathname = usePathname();
  const { collapsed } = useSidebarCollapse();
  const settingsActive = pathname.startsWith('/settings');

  const isChildActive = useCallback(
    (c: NavChild) => !c.soon && pathname.startsWith(c.href),
    [pathname],
  );
  const isLeafActive = useCallback(
    (item: NavItem) =>
      item.href
        ? item.matchExact
          ? pathname === item.href
          : pathname.startsWith(item.href)
        : false,
    [pathname],
  );
  const isGroupActive = useCallback(
    (item: NavItem) => !!item.children?.some(isChildActive),
    [isChildActive],
  );

  // Open/closed state per group, restored from localStorage and kept in sync.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(OPEN_GROUPS_KEY);
      if (raw) setOpen(JSON.parse(raw));
    } catch {
      // ignore — start with all collapsed
    }
    setHydrated(true);
  }, []);

  // Always keep the group containing the active route open.
  useEffect(() => {
    const activeGroup = NAV.find((i) => i.children?.some(isChildActive));
    if (activeGroup) {
      setOpen((o) => (o[activeGroup.key] ? o : { ...o, [activeGroup.key]: true }));
    }
  }, [pathname, isChildActive]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(open));
    } catch {
      // ignore
    }
  }, [open, hydrated]);

  const toggleGroup = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  return (
    <SidebarFrame
      brand={
        <Link href="/" className="block">
          <div className="text-base font-semibold tracking-tight">
            loomi <span className="text-[var(--primary)]">reporting</span>
          </div>
        </Link>
      }
      account={collapsed ? <AccountSwitcher compact /> : <AccountSwitcher />}
      bottom={
        <div className={`${collapsed ? 'p-2' : 'px-2 py-2'}`}>
          {(() => {
            const settingsLink = (
              <Link
                href="/settings"
                className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} rounded-xl py-2 text-sm font-normal transition-all duration-200 ${
                  settingsActive
                    ? 'bg-[var(--primary)] text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)]'
                    : 'text-[var(--sidebar-muted-foreground)] hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)]'
                }`}
              >
                <CogIcon className="h-5 w-5" />
                {!collapsed && 'Settings'}
              </Link>
            );
            return collapsed ? <SidebarTooltip label="Settings">{settingsLink}</SidebarTooltip> : settingsLink;
          })()}
        </div>
      }
    >
      {NAV.map((item) =>
        item.children ? (
          <GroupNav
            key={item.key}
            item={item}
            collapsed={collapsed}
            open={!!open[item.key]}
            active={isGroupActive(item)}
            isChildActive={isChildActive}
            onToggle={() => toggleGroup(item.key)}
          />
        ) : (
          <LeafNav key={item.key} item={item} collapsed={collapsed} active={isLeafActive(item)} />
        ),
      )}
    </SidebarFrame>
  );
}

// ── Leaf link ──

function LeafNav({ item, collapsed, active }: { item: NavItem; collapsed: boolean; active: boolean }) {
  const link = (
    <Link
      href={item.href!}
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

// ── Collapsible group ──

function GroupNav({
  item,
  collapsed,
  open,
  active,
  isChildActive,
  onToggle,
}: {
  item: NavItem;
  collapsed: boolean;
  open: boolean;
  active: boolean;
  isChildActive: (c: NavChild) => boolean;
  onToggle: () => void;
}) {
  // Collapsed rail: icon trigger + hover flyout with the children.
  if (collapsed) {
    return (
      <div className="group/nav relative">
        <button
          type="button"
          className={`flex w-full items-center justify-center rounded-xl px-2 py-2 transition-all duration-200 ${
            active
              ? 'bg-[var(--sidebar-muted)] text-[var(--sidebar-foreground)]'
              : 'text-[var(--sidebar-muted-foreground)] hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)]'
          }`}
        >
          <item.icon className="h-5 w-5" />
        </button>
        <div className="invisible absolute left-full top-0 z-50 ml-2 translate-x-1 opacity-0 transition-all duration-150 group-hover/nav:visible group-hover/nav:translate-x-0 group-hover/nav:opacity-100">
          <div className="glass-dropdown min-w-[190px] p-1.5 shadow-lg">
            <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--sidebar-muted-foreground)]">
              {item.label}
            </p>
            {item.children!.map((c) => (
              <ChildLink key={c.href} child={c} active={isChildActive(c)} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Expanded: toggle button + animated children.
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-normal transition-all duration-200 ${
          active || open
            ? 'text-[var(--sidebar-foreground)]'
            : 'text-[var(--sidebar-muted-foreground)] hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)]'
        }`}
      >
        <item.icon className="h-5 w-5" />
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronDownIcon className={`h-4 w-4 transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="my-0.5 ml-[1.15rem] space-y-0.5 pl-3">
            {item.children!.map((c) => (
              <ChildLink key={c.href} child={c} active={isChildActive(c)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChildLink({ child, active }: { child: NavChild; active: boolean }) {
  if (child.soon) {
    return (
      <div className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-[var(--sidebar-muted-foreground)]/60">
        <span>{child.label}</span>
        <span className="rounded-full bg-[var(--sidebar-muted)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider">
          soon
        </span>
      </div>
    );
  }
  return (
    <Link
      href={child.href}
      className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? 'bg-[var(--primary)]/10 font-medium text-[var(--primary)]'
          : 'text-[var(--sidebar-muted-foreground)] hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)]'
      }`}
    >
      {child.label}
    </Link>
  );
}
