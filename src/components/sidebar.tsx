'use client';

import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Squares2X2Icon,
  UserGroupIcon,
  PhotoIcon,
  SparklesIcon,
  SunIcon,
  MoonIcon,
  Cog6ToothIcon,
  MegaphoneIcon,
  ArrowTopRightOnSquareIcon,
  ChartBarSquareIcon,
  ChevronDownIcon,
  ChatBubbleLeftRightIcon,
  ListBulletIcon,
  FunnelIcon,
  GlobeAltIcon,
  DocumentTextIcon,
  RectangleStackIcon,
  PaperAirplaneIcon,
  PuzzlePieceIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useTheme } from '@/contexts/theme-context';
import { useSidebarCollapse } from '@/contexts/sidebar-collapse-context';
import { SidebarTooltip, SidebarPopout } from '@/components/sidebar-collapsed-ui';
import { appendThemeParam, getOtherSurfaceUrl } from '@/lib/cross-site';
import { FlowIcon } from '@/components/icon-map';
import { MetaBrandIcon, GoogleAdsBrandIcon } from '@/components/icons/platform-logos';
import { AccountSwitcher } from '@/components/account-switcher';
import { AppLogo } from '@/components/app-logo';
import { SidebarFrame } from '@/components/sidebar-frame';
import { accountKeyToSlug, isSubaccountRoute, stripSubaccountPrefix } from '@/lib/account-slugs';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface NavItem {
  href: string;
  label: string;
  /** Optional — leaves of nested groups can omit it to keep the menu tidy. */
  icon?: IconComponent;
  children?: NavItem[];
  // When true, href is used as-is and the sub-account prefix is NOT applied.
  // Use for global tools that live outside the /subaccount/[slug]/* route tree
  // but should still appear in the sub-account nav (e.g. Tools for admins).
  absolute?: boolean;
  /** Show this leaf's icon as a brand badge (e.g. Meta) even though nested
      sub-page rows are otherwise icon-free. */
  badge?: boolean;
  /** Not built yet — render a disabled "Soon" row that doesn't navigate or
      expand. Flip off to enable. */
  comingSoon?: boolean;
}

// Top-level nav can also hold section dividers (optionally labeled, Klaviyo
// "Advanced"-style) and the cross-host Reporting link (different host → <a>).
type NavDivider = { divider: true; label?: string };
type NavCrosslink = { crosslink: 'reporting'; label: string; icon: IconComponent };
type NavEntry = NavItem | NavDivider | NavCrosslink;

const toolsNavItem: NavItem = {
  href: '/tools',
  label: 'Ad Planning & Pacing',
  icon: MegaphoneIcon,
  absolute: true,
  children: [
    {
      // Planner + Pacer consolidated into one page with an in-page
      // Plan/Pace toggle — a single leaf instead of a Planner/Pacer pair.
      href: '/tools/meta',
      label: 'Meta',
      icon: MetaBrandIcon,
      badge: true,
      absolute: true,
    },
    {
      href: '/tools/google',
      label: 'Google',
      icon: GoogleAdsBrandIcon,
      absolute: true,
      comingSoon: true,
      children: [
        {
          href: '/tools/google/ad-planner',
          label: 'Ad Planner',
          absolute: true,
        },
        {
          href: '/tools/google/ad-pacer',
          label: 'Ad Pacer',
          absolute: true,
        },
      ],
    },
  ],
};

// Campaigns — the AI Campaign Builder: multi-channel campaigns generated
// (or built manually) and reviewed as one. Distinct from the per-channel
// Email & SMS send surface below.
const campaignBuilderNav: NavItem = {
  href: '/campaign-builder',
  label: 'Campaigns',
  icon: PaperAirplaneIcon,
};
// Email & SMS — the campaigns surface (the page already covers both
// channels). A flat top-level leaf; the old "Messaging" dropdown that
// grouped Campaigns + Templates has been split apart.
const emailSmsNav: NavItem = {
  href: '/messaging/campaigns',
  label: 'Emails & SMS',
  icon: ChatBubbleLeftRightIcon,
};
// Templates — now its own top-level destination. The unified page at
// /templates spans every medium (email, forms, flows, landing pages).
const templatesNav: NavItem = {
  href: '/templates',
  label: 'Templates',
  icon: RectangleStackIcon,
};
// Ad Generator — templated, on-brand ad creative for the active account.
// Global tool (reads the active account via context), so absolute like /tools/*.
const adGeneratorNav: NavItem = {
  href: '/ad-generator',
  label: 'Ad Generator',
  icon: SparklesIcon,
  absolute: true,
  // Shown as a non-clickable "Soon" teaser — the route itself stays reachable
  // by direct URL where the AD_GENERATOR_ENABLED flag is on (e.g. staging).
  comingSoon: true,
};
// Media library — re-added below Ad Generator.
const mediaNav: NavItem = { href: '/media', label: 'Media', icon: PhotoIcon };
// Flows is now a leaf nav item — analytics moved to /reporting/engagement.
const flowsNavItem: NavItem = {
  href: '/flows',
  label: 'Flows',
  icon: FlowIcon as IconComponent,
};

// Websites group — public-facing surfaces. Forms and Landing Pages both
// live here. Admin/developer only (clients consume submissions via
// Contacts, not via the Forms admin UI).
const websitesNav: NavItem = {
  href: '/websites/forms',
  label: 'Website',
  icon: GlobeAltIcon,
  children: [
    { href: '/websites/forms', label: 'Forms', icon: DocumentTextIcon },
    { href: '/websites/landing-pages', label: 'Landing Pages', icon: RectangleStackIcon },
    { href: '/websites/snippets', label: 'Reusable Blocks', icon: Squares2X2Icon },
  ],
};

// Contacts group. The parent is a toggle; "All Contacts" routes to the
// existing /contacts table, Lists + Segments are first-class destinations.
const contactsNav: NavItem = {
  href: '/contacts',
  label: 'Audiences',
  icon: UserGroupIcon,
  children: [
    { href: '/contacts', label: 'All Contacts', icon: UserGroupIcon },
    { href: '/contacts/lists', label: 'Lists', icon: ListBulletIcon },
    { href: '/contacts/segments', label: 'Segments', icon: FunnelIcon },
  ],
};

const dashboardNav: NavItem = { href: '/dashboard', label: 'Dashboard', icon: Squares2X2Icon };
const reportingLink: NavCrosslink = { crosslink: 'reporting', label: 'Reporting', icon: ChartBarSquareIcon };

// Admin nav — grouped Klaviyo-style with labeled dividers. The cross-host
// Reporting link sits in the top group; Ad Planning & Pacing under "Tools".
const adminNavItems: NavEntry[] = [
  dashboardNav,
  campaignBuilderNav,
  templatesNav,
  reportingLink,
  { divider: true },
  contactsNav,
  emailSmsNav,
  websitesNav,
  flowsNavItem,
  adGeneratorNav,
  mediaNav,
  { divider: true, label: 'Tools' },
  toolsNavItem,
];

// Admin viewing a sub-account uses the same structure (routes get prefixed at
// render; absolute items — Reporting / Ad Generator / Tools — stay global).
const subaccountAdminNavItems: NavEntry[] = adminNavItems;

// Client users: build/ops tools hidden; keep the destinations they own.
const subaccountClientNavItems: NavEntry[] = [
  dashboardNav,
  templatesNav,
  reportingLink,
  { divider: true },
  contactsNav,
  emailSmsNav,
];

/** True if the current path matches any of a group's (or grandchild's) leaves. */
function groupContainsPath(item: NavItem, prefix: string, normalizedPath: string): boolean {
  return (item.children ?? []).some((child) => {
    const childPath = child.absolute ? child.href : child.href.replace(prefix, '');
    if (normalizedPath === childPath || normalizedPath.startsWith(`${childPath}/`)) return true;
    return (child.children ?? []).some((grand) => {
      const grandPath = grand.absolute ? grand.href : grand.href.replace(prefix, '');
      return normalizedPath === grandPath || normalizedPath.startsWith(`${grandPath}/`);
    });
  });
}

export function Sidebar() {
  const pathname = usePathname();
  const { userRole, isAdmin, isAccount, accountKey, accounts } = useAccount();
  const { theme, toggleTheme } = useTheme();
  const { collapsed } = useSidebarCollapse();

  // Cross-host link to the reporting surface. Resolves after hydration
  // so we have access to `window.location.host`; account + theme are
  // appended as query params so reporting lands on the same account
  // with the same theme (cookie sharing doesn't work in dev).
  const [reportingHref, setReportingHref] = useState<string | null>(null);
  // Single-open accordion: at most one top-level group expanded at a time.
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null);
  const accountForCrossLink = useAccount().account;
  useEffect(() => {
    let url = getOtherSurfaceUrl('/');
    if (!url) return;
    if (accountForCrossLink.mode === 'account' && accountForCrossLink.accountKey) {
      url += `?account=${encodeURIComponent(accountForCrossLink.accountKey)}`;
    }
    url = appendThemeParam(url, theme);
    setReportingHref(url);
  }, [accountForCrossLink, theme]);

  const isClientRole = userRole === 'client';
  const slug = accountKey ? accountKeyToSlug(accountKey, accounts) : null;
  const inSubaccountRoute = isSubaccountRoute(pathname);

  let navItems: NavEntry[];
  let prefix = '';

  if (isAdmin && !inSubaccountRoute) {
    navItems = adminNavItems;
  } else if (slug) {
    prefix = `/subaccount/${slug}`;
    navItems = isClientRole ? subaccountClientNavItems : subaccountAdminNavItems;
  } else {
    navItems = isClientRole ? subaccountClientNavItems : adminNavItems;
  }

  // Resolve nav item hrefs with the prefix (skip for absolute items)
  const resolvedNavItems: NavEntry[] = navItems.map((entry) => {
    if ('divider' in entry || 'crosslink' in entry) return entry;
    return {
      ...entry,
      href: prefix && !entry.absolute ? `${prefix}${entry.href}` : entry.href,
      children: entry.children?.map((child) => ({
        ...child,
        href: prefix && !child.absolute ? `${prefix}${child.href}` : child.href,
      })),
    };
  });

  const normalizedPath = inSubaccountRoute ? stripSubaccountPrefix(pathname) : pathname;

  // Auto-open the top-level group that contains the current route.
  let activeGroupKey: string | null = null;
  for (const entry of resolvedNavItems) {
    if ('divider' in entry || 'crosslink' in entry) continue;
    if (entry.children?.length && groupContainsPath(entry, prefix, normalizedPath)) {
      activeGroupKey = entry.label;
      break;
    }
  }
  useEffect(() => {
    if (activeGroupKey) setOpenGroupKey(activeGroupKey);
  }, [activeGroupKey]);

  const settingsHref = isClientRole
    ? (slug ? `/subaccount/${slug}/settings` : '/settings/subaccount')
    : isAccount && slug
      ? `/subaccount/${slug}/settings`
      : '/settings/subaccounts';


  // Integrations — jump to the active sub-account's integration settings.
  const integrationsHref = slug ? `/subaccount/${slug}/settings/integrations` : '/settings/integrations';
  const integrationsActive = normalizedPath.startsWith('/settings/integrations');
  // Settings lives in the footer (where the account switcher briefly was);
  // active on any /settings route except integrations (its own item above).
  const settingsActive =
    normalizedPath.startsWith('/settings') && !integrationsActive;

  return (
    <SidebarFrame
      brand={<AppLogo className="h-8 w-auto max-w-[150px] object-contain" />}
      account={
        // Account switcher sits under the logo (admins/non-clients). Opens
        // downward — clients don't get a switcher (Settings is in the footer).
        !isClientRole ? (
          collapsed ? <AccountSwitcher compact /> : <AccountSwitcher />
        ) : null
      }
      bottom={
        <>
          {/* Integrations — quick jump to the active sub-account's integration
              settings, pinned at the bottom above the footer. */}
          <div className={`${collapsed ? 'px-2' : 'px-2'} pb-1`}>
            {(() => {
              const intLink = (
                <Link
                  href={integrationsHref}
                  className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2 rounded-xl text-sm font-normal transition-all duration-200 ${
                    integrationsActive
                      ? 'bg-[var(--primary)] text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)]'
                      : 'text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)]'
                  }`}
                >
                  <PuzzlePieceIcon className="w-5 h-5" />
                  {!collapsed && 'Integrations'}
                </Link>
              );
              return collapsed ? <SidebarTooltip label="Integrations">{intLink}</SidebarTooltip> : intLink;
            })()}
          </div>

          {/* Settings / Theme Toggle */}
          <div className={`${collapsed ? 'p-2' : 'px-2 py-2'}`}>
            {(() => {
              const themeLabel = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
              const themeBtn = (
                <button
                  type="button"
                  onClick={toggleTheme}
                  className={`w-full flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2 rounded-xl text-sm font-normal transition-all duration-200 text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)]`}
                >
                  {theme === 'dark' ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
                  {!collapsed && themeLabel}
                </button>
              );
              if (isClientRole) {
                return collapsed ? (
                  <SidebarTooltip label={themeLabel}>{themeBtn}</SidebarTooltip>
                ) : themeBtn;
              }
              // Settings lives here now (the account switcher moved up under the
              // logo).
              const settingsLink = (
                <Link
                  href={settingsHref}
                  className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2 rounded-xl text-sm font-normal transition-all duration-200 ${
                    settingsActive
                      ? 'bg-[var(--primary)] text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)]'
                      : 'text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)]'
                  }`}
                >
                  <Cog6ToothIcon className="w-5 h-5" />
                  {!collapsed && 'Settings'}
                </Link>
              );
              return collapsed ? (
                <SidebarTooltip label="Settings">{settingsLink}</SidebarTooltip>
              ) : (
                settingsLink
              );
            })()}
          </div>
        </>
      }
    >
        {resolvedNavItems.map((entry, i) => {
          if ('divider' in entry) {
            if (collapsed) {
              return <div key={`sep-${i}`} className="mx-2 my-2 border-t border-[var(--sidebar-border)]" />;
            }
            return entry.label ? (
              <p
                key={`sep-${i}`}
                className="px-3 pt-9 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--sidebar-muted-foreground)]/70"
              >
                {entry.label}
              </p>
            ) : (
              <div key={`sep-${i}`} className="h-8" />
            );
          }
          if ('crosslink' in entry) {
            if (!reportingHref) return null;
            const CrossIcon = entry.icon;
            const crossLink = (
              <a
                key={`cross-${i}`}
                href={reportingHref}
                className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2 rounded-xl text-sm font-normal transition-all duration-200 text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)]`}
              >
                <CrossIcon className="w-5 h-5" />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">{entry.label}</span>
                    <ArrowTopRightOnSquareIcon className="w-3 h-3 text-[var(--sidebar-muted-foreground)]/70" />
                  </>
                )}
              </a>
            );
            return collapsed ? (
              <SidebarTooltip key={`cross-${i}`} label={entry.label}>
                {crossLink}
              </SidebarTooltip>
            ) : (
              crossLink
            );
          }
          const item = entry;
          if (item.children && item.children.length > 0) {
            return (
              <NavGroup
                key={item.label}
                item={item}
                prefix={prefix}
                normalizedPath={normalizedPath}
                depth={0}
                controlledOpen={openGroupKey === item.label}
                onToggle={() => setOpenGroupKey((p) => (p === item.label ? null : item.label))}
              />
            );
          }
          // Top-level "Soon" teaser — a disabled row that doesn't navigate.
          // Exception: the Ad Generator is clickable for developers (still in
          // active build); everyone else sees the Soon chip.
          const devClickable = item.href === '/ad-generator' && userRole === 'developer';
          if (item.comingSoon && !devClickable) {
            const soon = (
              <div
                key={item.href}
                title="Coming soon"
                aria-disabled="true"
                className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2 rounded-xl text-sm font-normal text-[var(--sidebar-muted-foreground)]/50 cursor-not-allowed select-none`}
              >
                {item.icon && <item.icon className="w-5 h-5 opacity-60" />}
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
              <SidebarTooltip key={item.href} label={`${item.label} — coming soon`}>
                {soon}
              </SidebarTooltip>
            ) : (
              soon
            );
          }
          const itemPage = item.href.replace(prefix, '');
          const isActive =
            itemPage === '/dashboard'
              ? normalizedPath === '/dashboard' || normalizedPath === '/'
              : normalizedPath.startsWith(itemPage);
          // Absolute global tools (e.g. Ad Generator) preserve the active
          // account across the jump out of /subaccount/* via ?account=.
          const leafHref =
            item.absolute && accountKey ? `${item.href}?account=${encodeURIComponent(accountKey)}` : item.href;
          const leaf = (
            <Link
              key={item.href}
              href={leafHref}
              className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2 rounded-xl text-sm font-normal transition-all duration-200 ${
                isActive
                  ? 'bg-[var(--primary)] text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)]'
                  : 'text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)]'
              }`}
            >
              {item.icon && <item.icon className="w-5 h-5" />}
              {!collapsed && item.label}
            </Link>
          );
          return collapsed ? (
            <SidebarTooltip key={item.href} label={item.label}>
              {leaf}
            </SidebarTooltip>
          ) : leaf;
        })}
    </SidebarFrame>
  );
}

function NavGroup({
  item,
  prefix,
  normalizedPath,
  depth,
  controlledOpen,
  onToggle,
}: {
  item: NavItem;
  prefix: string;
  normalizedPath: string;
  depth: number;
  controlledOpen?: boolean;
  onToggle?: () => void;
}) {
  const { collapsed } = useSidebarCollapse();

  // A group is active if the URL matches any of its children's paths — children
  // can live at unrelated URL roots (Templates at /templates, Flows at /flows,
  // etc.) even though they're grouped under a parent like "Campaigns".
  const sectionActive = (item.children ?? []).some((child) => {
    const childPath = child.absolute
      ? child.href
      : child.href.replace(prefix, '');
    if (normalizedPath === childPath || normalizedPath.startsWith(`${childPath}/`)) {
      return true;
    }
    // Recurse into grandchildren so a 3rd-level active leaf still flags this group.
    return (child.children ?? []).some((grand) => {
      const grandPath = grand.absolute ? grand.href : grand.href.replace(prefix, '');
      return normalizedPath === grandPath || normalizedPath.startsWith(`${grandPath}/`);
    });
  });

  // `userOpen` is the explicit user choice; `null` means "follow sectionActive".
  // This is bulletproof against stale closures: open state is computed each
  // render from the latest sectionActive + the user's last explicit toggle.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const wasActiveRef = useRef(sectionActive);
  useEffect(() => {
    // When the section becomes newly active (user navigated into it from
    // outside), clear any prior manual close so it auto-opens.
    if (sectionActive && !wasActiveRef.current) {
      setUserOpen(null);
    }
    wasActiveRef.current = sectionActive;
  }, [sectionActive]);

  // Controlled (single-open accordion) when the parent passes onToggle — that's
  // the top-level groups; nested groups stay self-managed.
  const controlled = onToggle !== undefined;
  const open = controlled ? !!controlledOpen : userOpen ?? sectionActive;
  const handleToggle = controlled ? onToggle : () => setUserOpen(!open);

  const isTop = depth === 0;

  // When the sidebar is collapsed AND this is a top-level group, render
  // the icon as a button that pops out the children to the right. Hover
  // shows the group label as a tooltip; click toggles the popout.
  if (collapsed && isTop && item.icon) {
    return (
      <SidebarPopout label={item.label} icon={item.icon} active={sectionActive}>
        {/* Render children inside the popout. NavGroup children may be
            either leaf links or nested NavGroups (e.g. Ads → Meta →
            Ad Planner). We render leaves as direct links; nested groups
            render their own children as a labeled section. */}
        {item.children!.map((child) => {
          if (child.children && child.children.length > 0) {
            return (
              <div key={child.label} className="pt-1.5 first:pt-0">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-1.5">
                  {child.icon && <child.icon className="w-3.5 h-3.5" />}
                  {child.label}
                </div>
                {child.children.map((grand) => {
                  const grandPath = grand.absolute ? grand.href : grand.href.replace(prefix, '');
                  const grandActive =
                    normalizedPath === grandPath || normalizedPath.startsWith(`${grandPath}/`);
                  return (
                    <Link
                      key={grand.href}
                      href={grand.href}
                      role="menuitem"
                      className={`block px-3 py-1.5 text-[13px] rounded-md transition-colors ${
                        grandActive
                          ? 'text-[var(--primary)] font-medium bg-[var(--sidebar-muted)]'
                          : 'text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)]/60'
                      }`}
                    >
                      {grand.label}
                    </Link>
                  );
                })}
              </div>
            );
          }
          const childPath = child.absolute ? child.href : child.href.replace(prefix, '');
          const childActive =
            normalizedPath === childPath || normalizedPath.startsWith(`${childPath}/`);
          return (
            <Link
              key={child.href}
              href={child.href}
              role="menuitem"
              className={`flex items-center gap-2.5 px-2 py-1.5 text-sm rounded-md transition-colors ${
                childActive
                  ? 'text-[var(--primary)] font-medium bg-[var(--sidebar-muted)]'
                  : 'text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)]/60'
              }`}
            >
              {child.icon && <child.icon className="w-4 h-4" />}
              {child.label}
            </Link>
          );
        })}
      </SidebarPopout>
    );
  }

  // Top-level groups keep the bold pill treatment. Nested groups go lighter so
  // we don't stack multiple dark pills inside each other (Tools → Meta → leaf).
  const buttonClass = isTop
    ? `w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-normal transition-all duration-200 ${
        sectionActive
          ? 'text-[var(--sidebar-foreground)] bg-[var(--sidebar-muted)]'
          : 'text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)]'
      }`
    : `w-full flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-lg text-[13px] transition-all duration-200 ${
        sectionActive
          ? 'text-[var(--sidebar-foreground)] font-semibold'
          : 'text-[var(--sidebar-muted-foreground)] font-medium hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)]/60'
      }`;

  const chevronSize = isTop ? 'w-4 h-4' : 'w-3.5 h-3.5';

  return (
    <div>
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={open}
        className={buttonClass}
      >
        {/* Top-level groups show their icon at w-5. Nested groups normally drop
            it to keep the hierarchy clean (the indent + rail show nesting), but
            when a nested group carries a brand badge (Meta / Google) we show it,
            smaller, so the platform is recognizable in the expanded nav too. */}
        {item.icon && <item.icon className={isTop ? 'w-5 h-5' : 'w-4 h-4'} />}
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronDownIcon
          className={`${chevronSize} transition-transform duration-200 ${open ? 'rotate-180' : ''} ${
            sectionActive ? 'opacity-100' : 'opacity-50'
          }`}
        />
      </button>

      <div className="collapsible-wrapper" data-open={open ? 'true' : 'false'}>
        <div className="collapsible-inner">
          {/* Children indented to line up under the parent label (no rail). */}
          <div className="pt-px pl-8 pb-0.5 space-y-px">
            {(() => {
              // Pick the longest-matching child path so a parent route like
              // /contacts doesn't read as active when the URL is /contacts/lists.
              // Only the most-specific match wins.
              let bestMatch = '';
              for (const child of item.children!) {
                if (child.children && child.children.length > 0) continue;
                const childPath = child.absolute
                  ? child.href
                  : child.href.replace(prefix, '');
                const matches =
                  normalizedPath === childPath ||
                  normalizedPath.startsWith(`${childPath}/`);
                if (matches && childPath.length > bestMatch.length) {
                  bestMatch = childPath;
                }
              }
              return item.children!.map((child) => {
                // Not built yet — a disabled "Soon" row: shows the brand icon
                // + label but doesn't navigate or expand to children.
                if (child.comingSoon) {
                  return (
                    <div
                      key={child.label}
                      title="Coming soon"
                      aria-disabled="true"
                      className="flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-lg text-[13px] text-[var(--sidebar-muted-foreground)]/50 cursor-not-allowed select-none"
                    >
                      {child.icon && <child.icon className="w-4 h-4 opacity-60" />}
                      <span className="flex-1">{child.label}</span>
                      <span className="rounded-full bg-[var(--sidebar-muted)] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-[var(--sidebar-muted-foreground)]">
                        Soon
                      </span>
                    </div>
                  );
                }
                // Children with their own children render as a nested group so
                // we get e.g. Tools → Meta → [Ad Planner, Ad Pacer].
                if (child.children && child.children.length > 0) {
                  return (
                    <NavGroup
                      key={child.label}
                      item={child}
                      prefix={prefix}
                      normalizedPath={normalizedPath}
                      depth={depth + 1}
                    />
                  );
                }
                const childPath = child.absolute
                  ? child.href
                  : child.href.replace(prefix, '');
                const childActive = childPath === bestMatch;
                return (
                  <Link
                    key={child.href}
                    href={child.href}
                    className={`flex items-center gap-2.5 pl-3 pr-3 py-1.5 rounded-lg text-[13px] transition-colors ${
                      childActive
                        ? 'text-[var(--primary)] font-medium'
                        : 'text-[var(--sidebar-muted-foreground)] font-normal hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)]/60'
                    }`}
                  >{/* Sub-page rows are icon-free by design — except brand
                       badges (e.g. Meta), which opt in via `badge`. */}
                    {child.badge && child.icon && <child.icon className="w-4 h-4" />}
                    {child.label}
                  </Link>
                );
              });
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
