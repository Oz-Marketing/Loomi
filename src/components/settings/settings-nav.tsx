'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { SidebarTooltip } from '@/components/sidebar-collapsed-ui';
import { useSettingsTabs } from '@/components/settings/use-settings-tabs';

/** True when the path is a Settings route (admin `/settings` or sub-account `/…/settings`). */
export function isSettingsPath(pathname: string): boolean {
  return pathname === '/settings' || /\/settings(\/|$)/.test(pathname);
}

/**
 * Settings-mode sidebar nav: a "Back to {surface}" button + the settings links.
 * Replaces the normal nav while on a /settings route, so the settings nav IS the
 * main nav and the content spans full width. On a sub-account settings path it
 * shows that sub-account's sections (Company/Users/Branding/…); otherwise the
 * top-level settings tabs.
 */
export function SettingsNav({
  backHref,
  backLabel,
  collapsed = false,
}: {
  backHref: string;
  backLabel: string;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const genericTabs = useSettingsTabs();

  // No sub-account branch here any more. An account's settings render their own
  // tab rail (see TABS in components/subaccount-detail), reached from Agency
  // Settings → Accounts; this nav is only the surface's own settings list.
  type NavLink = {
    key: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    href: string;
    /** Scoped but not built — rendered dimmed, and not a link. */
    soon?: boolean;
  };

  const settingsIdx = pathname.indexOf('/settings');
  const base = settingsIdx >= 0 ? pathname.slice(0, settingsIdx + '/settings'.length) : '/settings';
  const groups: { label: string; items: NavLink[] }[] = [
    {
      label: 'Settings',
      items: genericTabs.map((t) => ({
        key: t.key,
        soon: t.soon,
        label: t.label,
        icon: t.icon,
        href: `${base}/${t.key}`,
      })),
    },
  ];
  const after = settingsIdx >= 0 ? pathname.slice(settingsIdx + '/settings'.length) : '';
  const activeKey = after.split('/').filter(Boolean)[0];

  const backBtn = (
    <Link
      href={backHref}
      className={`mb-1 flex items-center ${collapsed ? 'justify-center px-2' : 'gap-2 px-3'} rounded-xl py-2 text-sm font-medium text-[var(--sidebar-muted-foreground)] transition hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)]`}
    >
      <ArrowLeftIcon className="h-5 w-5 flex-shrink-0" />
      {!collapsed && backLabel}
    </Link>
  );

  return (
    <div className="space-y-px">
      {collapsed ? <SidebarTooltip label={backLabel}>{backBtn}</SidebarTooltip> : backBtn}
      {groups.map((group, groupIndex) => (
        <div key={group.label} className="space-y-px">
          {collapsed ? (
            groupIndex > 0 && <div className="mx-2 my-2 border-t border-[var(--sidebar-border)]" />
          ) : (
            <p
              className={`px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--sidebar-muted-foreground)] ${
                groupIndex === 0 ? 'pt-3' : 'pt-6'
              }`}
            >
              {group.label}
            </p>
          )}
          {group.items.map((t) => {
            const active = activeKey === t.key;
            // A `soon` row says what this sector is getting without pretending
            // it's there. Not a Link: nothing to navigate to yet.
            if (t.soon) {
              const row = (
                <div
                  key={t.key}
                  aria-disabled
                  className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} cursor-default rounded-xl py-2 text-sm font-normal text-[var(--sidebar-muted-foreground)] opacity-45`}
                >
                  <t.icon className="h-5 w-5 flex-shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="truncate">{t.label}</span>
                      <span className="ml-auto text-[9px] font-semibold uppercase tracking-wider">
                        Soon
                      </span>
                    </>
                  )}
                </div>
              );
              return collapsed ? (
                <SidebarTooltip key={t.key} label={`${t.label} — not built yet`}>
                  {row}
                </SidebarTooltip>
              ) : (
                row
              );
            }
            const link = (
              <Link
                key={t.key}
                href={t.href}
                className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} rounded-xl py-2 text-sm font-normal transition-all duration-200 ${
                  active
                    ? 'bg-[var(--primary)]/10 text-[var(--primary)] font-medium'
                    : 'text-[var(--sidebar-muted-foreground)] hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)]'
                }`}
              >
                <t.icon className="h-5 w-5 flex-shrink-0" />
                {!collapsed && t.label}
              </Link>
            );
            return collapsed ? (
              <SidebarTooltip key={t.key} label={t.label}>
                {link}
              </SidebarTooltip>
            ) : (
              link
            );
          })}
        </div>
      ))}
    </div>
  );
}
