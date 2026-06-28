'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  ArrowLeftIcon,
  BuildingStorefrontIcon,
  UsersIcon,
  PaintBrushIcon,
  GlobeAltIcon,
  PuzzlePieceIcon,
  TagIcon,
  SwatchIcon,
} from '@heroicons/react/24/outline';
import { SidebarTooltip } from '@/components/sidebar-collapsed-ui';
import { useSettingsTabs } from '@/components/settings/use-settings-tabs';

/** True when the path is a Settings route (admin `/settings` or sub-account `/…/settings`). */
export function isSettingsPath(pathname: string): boolean {
  return pathname === '/settings' || /\/settings(\/|$)/.test(pathname);
}

/** Sub-account settings sections — mirrors SETTINGS_TABS in subaccount-detail.tsx
 *  (Company → Users → Branding → …). Used when the path is /subaccount/<slug>/settings. */
const SUBACCOUNT_SETTINGS_SECTIONS: {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: 'company', label: 'Company', icon: BuildingStorefrontIcon },
  { key: 'users', label: 'Users', icon: UsersIcon },
  { key: 'branding', label: 'Branding', icon: PaintBrushIcon },
  { key: 'domains', label: 'Domains', icon: GlobeAltIcon },
  { key: 'integrations', label: 'Integrations', icon: PuzzlePieceIcon },
  { key: 'contact-fields', label: 'Custom Fields', icon: TagIcon },
  { key: 'appearance', label: 'Appearance', icon: SwatchIcon },
];

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
  const searchParams = useSearchParams();
  const genericTabs = useSettingsTabs();

  // Sub-account settings show that sub-account's sections (the inner page rail is
  // dropped in this mode). Two URL shapes:
  //   • Studio scoped:  /subaccount/<slug>/settings/<section>
  //   • Admin browse:   [<surface>/]settings/subaccounts/<key>/<section>
  const sub = pathname.match(/^\/subaccount\/([^/]+)\/settings/);
  const subAdmin = pathname.match(/^(.*)\/settings\/subaccounts\/([^/]+)/);

  let items: { key: string; label: string; icon: React.ComponentType<{ className?: string }>; href: string }[];
  let activeKey: string | undefined;
  if (sub) {
    items = SUBACCOUNT_SETTINGS_SECTIONS.map((s) => ({ key: s.key, label: s.label, icon: s.icon, href: `/subaccount/${sub[1]}/settings/${s.key}` }));
    const settingsIdx = pathname.indexOf('/settings');
    activeKey = pathname.slice(settingsIdx + '/settings'.length).split('/').filter(Boolean)[0];
  } else if (subAdmin) {
    const prefix = subAdmin[1]; // surface prefix (e.g. '' or '/reporting')
    const key = subAdmin[2];
    // Section lives in ?tab= (single [key] route, no per-tab route files).
    items = SUBACCOUNT_SETTINGS_SECTIONS.map((s) => ({ key: s.key, label: s.label, icon: s.icon, href: `${prefix}/settings/subaccounts/${key}?tab=${s.key}` }));
    activeKey = searchParams.get('tab') ?? 'company';
  } else {
    items = genericTabs.map((t) => {
      const idx = pathname.indexOf('/settings');
      const base = idx >= 0 ? pathname.slice(0, idx + '/settings'.length) : '/settings';
      return { key: t.key, label: t.label, icon: t.icon, href: `${base}/${t.key}` };
    });
    const settingsIdx = pathname.indexOf('/settings');
    const after = settingsIdx >= 0 ? pathname.slice(settingsIdx + '/settings'.length) : '';
    activeKey = after.split('/').filter(Boolean)[0];
  }

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
      {!collapsed && (
        <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--sidebar-muted-foreground)]">
          Settings
        </p>
      )}
      {items.map((t) => {
        const active = activeKey === t.key;
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
  );
}
