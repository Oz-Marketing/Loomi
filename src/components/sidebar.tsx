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
  CogIcon,
  EnvelopeIcon,
  UserGroupIcon,
  PhotoIcon,
  SunIcon,
  MoonIcon,
  WrenchScrewdriverIcon,
  ChevronDownIcon,
  ChartBarSquareIcon,
  ChatBubbleLeftRightIcon,
  ListBulletIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useTheme } from '@/contexts/theme-context';
import { FlowIcon } from '@/components/icon-map';
import { MetaLogoIcon } from '@/components/icons/meta-logo';
import { AccountSwitcher } from '@/components/account-switcher';
import { DevImpersonate } from '@/components/dev-impersonate';
import { AppLogo } from '@/components/app-logo';
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
}

const toolsNavItem: NavItem = {
  href: '/tools',
  label: 'Tools',
  icon: WrenchScrewdriverIcon,
  absolute: true,
  children: [
    {
      href: '/tools/meta',
      label: 'Meta',
      icon: MetaLogoIcon,
      absolute: true,
      children: [
        {
          href: '/tools/meta/ad-planner',
          label: 'Ad Planner',
          absolute: true,
        },
        {
          href: '/tools/meta/ad-pacer',
          label: 'Ad Pacer',
          absolute: true,
        },
      ],
    },
  ],
};

// Messaging group — nests the email + SMS surfaces underneath.
// (Flows lives at the top level since it's a separate workflow concept.)
const messagingGroupCampaigns: NavItem = {
  href: '/messaging/campaigns',
  label: 'Campaigns',
  icon: ListBulletIcon,
};
const messagingGroupAnalytics: NavItem = {
  href: '/messaging/analytics',
  label: 'Analytics',
  icon: ChartBarSquareIcon,
};
const messagingGroupTemplates: NavItem = {
  href: '/email/templates',
  label: 'Templates',
  icon: EnvelopeIcon,
};
const flowsNavItem: NavItem = {
  href: '/flows',
  label: 'Flows',
  icon: FlowIcon as IconComponent,
};

const messagingNav: NavItem = {
  href: '/messaging/campaigns',
  label: 'Messaging',
  icon: ChatBubbleLeftRightIcon,
  children: [
    messagingGroupCampaigns,
    messagingGroupAnalytics,
    messagingGroupTemplates,
  ],
};

// Contacts group. The parent is a toggle; "All Contacts" routes to the
// existing /contacts table, Lists + Segments are first-class destinations.
const contactsNav: NavItem = {
  href: '/contacts',
  label: 'Contacts',
  icon: UserGroupIcon,
  children: [
    { href: '/contacts', label: 'All Contacts', icon: UserGroupIcon },
    { href: '/contacts/lists', label: 'Lists', icon: ListBulletIcon },
    { href: '/contacts/segments', label: 'Segments', icon: FunnelIcon },
  ],
};

// Admin-level nav (when in admin mode)
const adminNavItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: Squares2X2Icon },
  contactsNav,
  messagingNav,
  flowsNavItem,
  { href: '/media', label: 'Media', icon: PhotoIcon },
  toolsNavItem,
];

// Sub-account nav for admin/developer users viewing a sub-account
const subaccountAdminNavItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: Squares2X2Icon },
  contactsNav,
  messagingNav,
  flowsNavItem,
  { href: '/media', label: 'Media', icon: PhotoIcon },
  toolsNavItem,
];

// Sub-account nav for client users — no Flows (matches the previous
// admin-only restriction on Flows).
const subaccountClientNavItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: Squares2X2Icon },
  contactsNav,
  messagingNav,
];

export function Sidebar() {
  const pathname = usePathname();
  const { userRole, isAdmin, isAccount, accountKey, accounts } = useAccount();
  const { theme, toggleTheme } = useTheme();

  const isClientRole = userRole === 'client';
  const slug = accountKey ? accountKeyToSlug(accountKey, accounts) : null;
  const inSubaccountRoute = isSubaccountRoute(pathname);

  let navItems: NavItem[];
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
  const resolvedNavItems: NavItem[] = navItems.map((item) => ({
    ...item,
    href: prefix && !item.absolute ? `${prefix}${item.href}` : item.href,
    children: item.children?.map((child) => ({
      ...child,
      href: prefix && !child.absolute ? `${prefix}${child.href}` : child.href,
    })),
  }));

  const normalizedPath = inSubaccountRoute ? stripSubaccountPrefix(pathname) : pathname;

  const settingsHref = isClientRole
    ? (slug ? `/subaccount/${slug}/settings` : '/settings/subaccount')
    : isAccount && slug
      ? `/subaccount/${slug}/settings`
      : '/settings/subaccounts';

  const settingsActive =
    normalizedPath === '/settings' ||
    normalizedPath.startsWith('/settings') ||
    pathname.startsWith('/users') ||
    pathname.startsWith('/subaccounts');

  return (
    <aside className="glass-panel fixed left-3 top-3 bottom-3 w-60 rounded-2xl text-[var(--sidebar-foreground)] flex flex-col z-50 overflow-visible">
      {/* Logo + Account Switcher */}
      <div className="p-5 pb-4 border-b border-[var(--sidebar-border)]">
        <div className="mb-3">
          <AppLogo className="h-8 w-auto max-w-[150px] object-contain" />
        </div>
        <AccountSwitcher />
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {resolvedNavItems.map((item) => {
          if (item.children && item.children.length > 0) {
            return (
              <NavGroup
                key={item.label}
                item={item}
                prefix={prefix}
                normalizedPath={normalizedPath}
                depth={0}
              />
            );
          }
          const itemPage = item.href.replace(prefix, '');
          const isActive =
            itemPage === '/dashboard'
              ? normalizedPath === '/dashboard' || normalizedPath === '/'
              : normalizedPath.startsWith(itemPage);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-[var(--primary)] text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)]'
                  : 'text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)]'
              }`}
            >
              {item.icon && <item.icon className="w-5 h-5" />}
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Developer impersonation */}
      <DevImpersonate />

      {/* Settings / Theme Toggle */}
      <div className="p-3 border-t border-[var(--sidebar-border)]">
        {isClientRole ? (
          <button
            type="button"
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)]"
          >
            {theme === 'dark' ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
            {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          </button>
        ) : (
          <Link
            href={settingsHref}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
              settingsActive
                ? 'bg-[var(--primary)] text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)]'
                : 'text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)]'
            }`}
          >
            <CogIcon className="w-5 h-5" />
            Settings
          </Link>
        )}
      </div>
    </aside>
  );
}

function NavGroup({
  item,
  prefix,
  normalizedPath,
  depth,
}: {
  item: NavItem;
  prefix: string;
  normalizedPath: string;
  depth: number;
}) {
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

  const open = userOpen ?? sectionActive;
  const handleToggle = () => setUserOpen(!open);

  const isTop = depth === 0;

  // Top-level groups keep the bold pill treatment. Nested groups go lighter so
  // we don't stack multiple dark pills inside each other (Tools → Meta → leaf).
  const buttonClass = isTop
    ? `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
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
        {/* Icons only render at the top level of the nav. Nested
            groups (Tools → Meta) drop their icon so the hierarchy stays
            visually clean — the indent + rail communicate the nesting. */}
        {isTop && item.icon && <item.icon className="w-5 h-5" />}
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronDownIcon
          className={`${chevronSize} transition-transform duration-200 ${open ? 'rotate-180' : ''} ${
            sectionActive ? 'opacity-100' : 'opacity-50'
          }`}
        />
      </button>

      <div className="collapsible-wrapper" data-open={open ? 'true' : 'false'}>
        <div className="collapsible-inner">
          {/* Vertical rail to visually anchor children to their parent group. */}
          <div className="relative pt-1 pl-3 pb-0.5 space-y-0.5">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-1 bottom-0.5 left-[14px] w-px bg-[var(--sidebar-border-soft)]"
            />
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
                    className={`relative flex items-center gap-2.5 pl-3 pr-3 py-1.5 rounded-lg text-[13px] transition-all duration-200 ${
                      childActive
                        ? 'text-[var(--primary)] font-semibold'
                        : 'text-[var(--sidebar-muted-foreground)] font-medium hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)]/60'
                    }`}
                  >{/* Sub-page rows are icon-free by design. */}
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
