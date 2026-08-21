'use client';

import { useState, useEffect, useCallback, useMemo, type ComponentType } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowPathIcon,
  ArrowTrendingUpIcon,
  BanknotesIcon,
  BuildingStorefrontIcon,
  ChevronDownIcon,
  CogIcon,
  FunnelIcon,
  GlobeAltIcon,
  HomeIcon,
  InboxStackIcon,
  MapIcon,
  MapPinIcon,
  ScaleIcon,
  MegaphoneIcon,
  PhoneIcon,
  PresentationChartLineIcon,
  PhotoIcon,
  StarIcon,
  UserPlusIcon,
  UsersIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { useSidebarCollapse } from '@/contexts/sidebar-collapse-context';
import { useAccount } from '@/contexts/account-context';
import { navPathFor, visibleNav, withSurfacePrefix } from './nav-visibility';
import { SidebarTooltip } from '@/components/sidebar-collapsed-ui';
import { SidebarFrame } from '@/components/sidebar-frame';
import { AccountSwitcher } from '@/components/account-switcher';
import { SurfaceSwitch } from '@/components/surface-switch';
import { SettingsNav, isSettingsPath } from '@/components/settings/settings-nav';
import { MetaBrandIcon, GoogleAdsBrandIcon } from '@/components/icons/platform-logos';
import { visibleReports } from '../ads/_components/reports-config';

/**
 * Reporting sidebar — branding + nav only. User identity, theme toggle, Studio
 * cross-link, and sign-out live in the top-bar user dropdown.
 *
 * Nav is a flat list of leaf links plus collapsible GROUPS (e.g. Digital Ads),
 * whose children come from the report registry. The active group auto-expands,
 * open/closed state persists across navigations (localStorage), and in the
 * collapsed icon rail a group reveals its children in a hover flyout.
 *
 * Two modes displace that nav, matching Studio and Projects:
 *   • AGENCY VIEW — the platform-management rail (Manage/Configure), identical
 *     on every surface. No swap, no back button; the rail IS the settings rail.
 *   • SUB-ACCOUNT SETTINGS — the nav swaps to SettingsNav with a back button.
 *
 * Hrefs below are written as BROWSER-facing paths on `reporting.loomilm.com`,
 * where the proxy rewrites `/ads/*` → `/reporting/ads/*` internally and
 * `usePathname()` returns the bare browser URL. The same routes are ALSO
 * reachable on the Studio host under a literal `/reporting/*` prefix, so
 * `withSurface()` re-adds that prefix to every outgoing href and the matching
 * path is normalized back to bare — see ReportingSidebar.
 */

type NavChild = {
  href: string;
  label: string;
  soon?: boolean;
  icon?: ComponentType<{ className?: string }>;
};
type NavItem = {
  key: string;
  label: string;
  icon: typeof HomeIcon;
  href?: string;
  matchExact?: boolean;
  children?: NavChild[];
};

// Brand badges for platforms with a recognizable logo; other reports fall back
// to their generic registry icon (TV, envelope, …).
const REPORT_BRAND_ICON: Record<string, ComponentType<{ className?: string }>> = {
  meta: MetaBrandIcon,
  google: GoogleAdsBrandIcon,
};

// Order and grouping follow docs/odt-reporting-migration.md §4. Members marked
// `soon` are Oz Dealer Tools reports not yet ported — they render as disabled
// rows on purpose, so the intended shape of Reporting is legible before the
// data lands. Drop the flag as each one ships; delete a group only if its
// last member is cut.
function buildNav(isClient: boolean): NavItem[] {
  return [
  { key: 'dashboard', label: 'Dashboard', icon: HomeIcon, href: '/', matchExact: true },
  { key: 'contacts', label: 'Contacts', icon: UsersIcon, href: '/contacts' },
  //
  // NO "Engagement" ENTRY: it is now Digital Ads → "Email & Text Blasts", one
  // surface carrying Loomi email, Loomi text, the email history from the
  // previous provider, and flows. Two entries for one subject meant two places
  // to look and two sets of numbers to reconcile. /reporting/engagement
  // redirects there rather than 404ing — the old path is in saved links.
  //
  // The same records Studio calls segments — one model, two surfaces. Sits
  // next to Contacts because that is what it is made of.
  { key: 'lists', label: 'Marketing Lists', icon: FunnelIcon, href: '/lists' },
  {
    key: 'digital-ads',
    label: 'Digital Ads',
    icon: MegaphoneIcon,
    children: visibleReports(isClient).map((r) => ({
      href: `/ads/${r.key}`,
      label: r.label,
      soon: r.status !== 'live',
      icon: REPORT_BRAND_ICON[r.key] ?? r.icon,
    })),
  },
  { key: 'websites', label: 'Websites', icon: GlobeAltIcon, href: '/websites' },
  {
    key: 'local-presence',
    label: 'Local Presence',
    icon: MapPinIcon,
    children: [
      { href: '/business-profile', label: 'Business Profile', icon: BuildingStorefrontIcon },
      { href: '/reputation', label: 'Reputation', icon: StarIcon },
      { href: '/call-tracking', label: 'Call Tracking', icon: PhoneIcon },
      // Out-of-home sits under Local Presence rather than Digital Ads: it is
      // how the dealer shows up in the market, and it is the one channel here
      // that isn't digital at all.
      { href: '/billboards', label: 'Billboards', icon: PhotoIcon },
    ],
  },
  {
    key: 'sales-service',
    label: 'Sales & Service',
    icon: PresentationChartLineIcon,
    children: [
      // First in the group: it is the question the rest of the group's numbers
      // get used to answer.
      { href: '/acquisition', label: 'Acquisition Cost', icon: ScaleIcon },
      { href: '/leads', label: 'Lead Performance', icon: UserPlusIcon },
      { href: '/sales-trend', label: 'Sales Trend', icon: ArrowTrendingUpIcon },
      { href: '/service-trend', label: 'Service Trend', icon: WrenchScrewdriverIcon },
      { href: '/service-retention', label: 'Service Retention', icon: ArrowPathIcon },
      { href: '/heatmap', label: 'Customer Heatmap', icon: MapIcon },
      { href: '/direct-mail', label: 'Direct Mail ROI', icon: InboxStackIcon },
    ],
  },
  // Staff-only comparison of every rooftop — the same "whose report is it"
  // category as Ad Templates, so a client doesn't get the nav entry either.
  //
  // This used to be rendered for everyone, on the reasoning that the page
  // gates on role anyway and the nav "can't — it has no session". The second
  // half is no longer true: the sidebar reads `userRole` for the Digital Ads
  // filter, so it can and should. The page keeps its own gate — a hidden nav
  // entry is not a permission check.
  ...(isClient
    ? []
    : [
        {
          key: 'executive',
          label: 'Executive',
          icon: PresentationChartLineIcon,
          href: '/executive',
        } as NavItem,
      ]),
  // Top level, not under Digital Ads: the ledger covers every channel including
  // non-digital fee lines, so filing it under Digital Ads would understate what
  // it holds. Read-only here — authoring lives in the budget hub.
  { key: 'budget', label: 'Budget', icon: BanknotesIcon, href: '/budget' },
  ];
}

const OPEN_GROUPS_KEY = 'reporting.sidebar.openGroups';

export function ReportingSidebar() {
  const browserPath = usePathname();
  const { collapsed } = useSidebarCollapse();
  const { isAccount, accountKey, userRole } = useAccount();

  // Apply the surface prefix to outgoing hrefs, and strip it from the path we
  // match against so the bare-href comparisons below keep working on both hosts
  // (active state was silently dead on Studio too). See nav-visibility.ts.
  const pathname = navPathFor(browserPath);
  const withSurface = useCallback(
    (href: string) => withSurfacePrefix(browserPath, href),
    [browserPath],
  );

  // Agency-only reports drop out of the nav entirely for clients — see the
  // `internal` flag in reports-config.
  const NAV = useMemo(() => buildNav(userRole === 'client'), [userRole]);
  const settingsActive = pathname.startsWith('/settings');
  // Sub-account settings render the SAME sector-gated sections as Studio, via
  // the shared sub-account detail page. Studio reaches it at
  // /subaccount/<slug>/settings; this surface has no such route tree, so it
  // uses the admin-browse shape (section in ?tab=) against the active account.
  const subaccountSettingsHref = withSurface(
    // No ?tab= — see the note in app-sidebar; 'general' moved to Agency Settings.
    isAccount && accountKey ? `/settings/subaccounts/${accountKey}` : '/settings',
  );

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

  // Which reports this user can actually open on this account. Null until it
  // loads; see visibleNav for why that renders everything.
  const [allowedReports, setAllowedReports] = useState<Set<string> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const qs = accountKey ? `?accountKey=${encodeURIComponent(accountKey)}` : '';
    fetch(`/api/reporting/my-reports${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.reports) return;
        setAllowedReports(new Set<string>(data.reports));
      })
      .catch(() => {
        // Leave it null — show the full nav rather than hiding reports because
        // one request failed.
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey]);

  const nav = visibleNav(NAV, allowedReports);

  return (
    <SidebarFrame
      brand={
        <Link href={withSurface('/')} className="block">
          <div className="text-base font-semibold tracking-tight">
            loomi <span className="text-[var(--primary)]">reporting</span>
          </div>
        </Link>
      }
      account={
        // No switcher in settings: the rail IS the settings nav here, and the
        // sections it lists belong to whichever account you arrived from —
        // leaving a picker above them invites changing account mid-edit, which
        // silently repoints the form. Dropping it also lifts "Back to <sector>"
        // to the top, which is the way out of this mode.
        isSettingsPath(pathname) ? null : collapsed ? (
          <AccountSwitcher compact />
        ) : (
          <AccountSwitcher />
        )
      }
      bottom={
        <>
          {/* Quick switch between Studio · Reporting · Projects. */}
          <div className="px-2 pb-1">
            <SurfaceSwitch collapsed={collapsed} />
          </div>
          <div className={`${collapsed ? 'p-2' : 'px-2 py-2'}`}>
          {(() => {
            const settingsLink = (
              <Link
                href={subaccountSettingsHref}
                className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} rounded-xl py-2 text-sm font-normal transition-all duration-200 ${
                  settingsActive
                    ? 'bg-[var(--primary)]/10 font-medium text-[var(--primary)]'
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
        </>
      }
    >
      {isSettingsPath(pathname) ? (
        <SettingsNav
          backHref={withSurface('/')}
          backLabel="Back to Reporting"
          collapsed={collapsed}
        />
      ) : (
        nav.map((item) =>
          item.children ? (
            <GroupNav
              key={item.key}
              item={item}
              collapsed={collapsed}
              open={!!open[item.key]}
              active={isGroupActive(item)}
              isChildActive={isChildActive}
              withSurface={withSurface}
              onToggle={() => toggleGroup(item.key)}
            />
          ) : (
            <LeafNav
              key={item.key}
              item={item}
              collapsed={collapsed}
              active={isLeafActive(item)}
              withSurface={withSurface}
            />
          ),
        )
      )}
    </SidebarFrame>
  );
}

// ── Leaf link ──

function LeafNav({
  item,
  collapsed,
  active,
  withSurface,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  withSurface: (href: string) => string;
}) {
  const link = (
    <Link
      href={withSurface(item.href!)}
      className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} rounded-xl py-2 text-sm font-normal transition-all duration-200 ${
        active
          ? 'bg-[var(--primary)]/10 font-medium text-[var(--primary)]'
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
  withSurface,
  onToggle,
}: {
  item: NavItem;
  collapsed: boolean;
  open: boolean;
  active: boolean;
  isChildActive: (c: NavChild) => boolean;
  withSurface: (href: string) => string;
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
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--sidebar-muted-foreground)]">
              {item.label}
            </p>
            {item.children!.map((c) => (
              <ChildLink key={c.href} child={c} active={isChildActive(c)} withSurface={withSurface} />
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
              <ChildLink key={c.href} child={c} active={isChildActive(c)} withSurface={withSurface} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChildLink({
  child,
  active,
  withSurface,
}: {
  child: NavChild;
  active: boolean;
  withSurface: (href: string) => string;
}) {
  if (child.soon) {
    return (
      <div className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-[var(--sidebar-muted-foreground)]/60">
        <span className="flex items-center gap-2">
          {child.icon && <child.icon className="h-4 w-4" />}
          {child.label}
        </span>
        <span className="rounded-full bg-[var(--sidebar-muted)] px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wider">
          soon
        </span>
      </div>
    );
  }
  return (
    <Link
      href={withSurface(child.href)}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? 'bg-[var(--primary)]/10 font-medium text-[var(--primary)]'
          : 'text-[var(--sidebar-muted-foreground)] hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)]'
      }`}
    >
      {child.icon && <child.icon className="h-4 w-4" />}
      {child.label}
    </Link>
  );
}
