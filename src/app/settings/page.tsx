'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAccount } from '@/contexts/account-context';
import { CogIcon } from '@heroicons/react/24/outline';
import { AccountAvatar } from '@/components/account-avatar';
import { useSettingsTabs, type SettingsTabKey } from '@/components/settings/use-settings-tabs';
import { useCurrentSurface } from '@/lib/hooks/use-current-surface';
import { SettingsPanel } from '@/components/settings/settings-panel';

type Tab = SettingsTabKey;

export default function SettingsPage() {
  // No role facts read here any more. Which tabs exist is the registry's
  // answer (`useSettingsTabs`), and what each one renders is settings-panel's —
  // this page only resolves the active tab from the URL and draws the header.
  const { isAdmin, isAccount, isGroup, initialized, accountsLoaded, userRole, accountKey, accountData } =
    useAccount();
  const router = useRouter();
  const pathname = usePathname();

  // Role-gated tabs (shared with the sidebar's settings nav).
  const tabs = useSettingsTabs();
  // Host-derived, so null for the first render. The tab set depends on it, so
  // the canonical-route redirect below must not run until it's known.
  const surface = useCurrentSurface();

  // Active tab from the path (handles admin `/settings/<tab>` + sub-account
  // `/…/settings/<tab>`).
  const settingsIdx = pathname.indexOf('/settings');
  const base = settingsIdx >= 0 ? pathname.slice(0, settingsIdx + '/settings'.length) : '/settings';
  const routeTab = pathname.slice(base.length).split('/').filter(Boolean)[0];
  const defaultTab = tabs[0]?.key || 'appearance';
  const defaultTabPath = `${base}/${defaultTab}`;
  const activeTab = tabs.some(t => t.key === routeTab)
    ? (routeTab as Tab)
    : defaultTab;

  // Enforce canonical route per tab so browser history/back works correctly.
  //
  // Wait for `initialized` — before the active scope resolves from the cookie, the
  // tab set reflects the default 'admin' mode, so redirecting here would bounce a
  // deep link like /settings/organization to the wrong tab.
  //
  // Wait for `accountsLoaded` too: Co-op Guidelines only appears when some account
  // is in an OEM industry, which isn't known until the account list arrives. Without
  // this the tab is briefly absent, the redirect fires, and a deep link to it lands
  // on Sub-Accounts instead — which is exactly what happened the first time.
  //
  // And wait for `surface`, the third instance of the same bug. It's derived
  // from the host after mount, and `useSettingsScope` treats the null window as
  // Studio — so on Projects the first render has no Markup/Channels/Alerts tab,
  // the redirect fires, and a deep link to one bounces to the Studio default a
  // tick before the surface resolves. That bounce is the routing jitter.
  useEffect(() => {
    if (!initialized || !accountsLoaded || surface === null || tabs.length === 0) return;
    if (!routeTab || !tabs.some(t => t.key === routeTab)) {
      router.replace(defaultTabPath, { scroll: false });
    }
  }, [initialized, accountsLoaded, surface, routeTab, defaultTabPath, router, tabs.length, isAdmin, isAccount, isGroup, userRole]);

  const activeTabObj = tabs.find((t) => t.key === activeTab);
  const TitleIcon = activeTabObj?.icon ?? CogIcon;
  const titleText = activeTabObj?.titleLabel ?? 'Settings';

  // Until the scope resolves, the tab set (and thus activeTab) reflects the
  // default mode — hold a light placeholder so a deep-linked tab doesn't flash
  // the wrong content before settling. This only runs on the first cold load.
  if (!initialized) {
    return (
      <div className="animate-fade-in-up pt-4">
        <div className="h-8 w-48 rounded-lg bg-[var(--muted)] animate-pulse" />
        <div className="mt-6 h-px bg-[var(--border)]" />
        <div className="mt-6 h-64 rounded-xl bg-[var(--muted)] animate-pulse" />
      </div>
    );
  }

  return (
    // Full-width: the settings tabs live in the sidebar (SettingsNav) now, so
    // the content spans the whole page-content width.
    <div className="animate-fade-in-up pt-4">
      <div className="mb-6 flex items-start justify-between gap-4">
        {isAccount && accountData ? (
          // Account-mode: title is the sub-account's avatar + name (matches the
          // Studio sub-account settings header). The name is editable in the
          // Sub-Account tab content.
          <div className="flex min-w-0 items-center gap-3">
            <AccountAvatar
              name={accountData.dealer || accountKey || ''}
              accountKey={accountKey || ''}
              storefrontImage={accountData.storefrontImage}
              logos={accountData.logos}
              size={44}
              className="flex-shrink-0 rounded-xl border border-[var(--border)]"
            />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold text-[var(--foreground)]">
                {accountData.dealer || accountKey}
              </h1>
              <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
                Manage settings and configuration for this account
              </p>
            </div>
          </div>
        ) : (
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--foreground)]">
              <TitleIcon className="w-6 h-6" />
              {titleText}
            </h1>
            <p className="text-sm text-[var(--muted-foreground)] mt-1">
              Manage your preferences and configuration
            </p>
          </div>
        )}
        <div id="settings-title-actions" className="flex items-center gap-2" />
      </div>

      <div className="border-b border-[var(--border)] mb-6" />

      {/* One line, because the panel behind each tab is defined once in
          settings-panel. The guards that used to live here duplicated the
          registry's `visible` predicates by hand and drifted from them. */}
      <SettingsPanel tab={activeTab} />
    </div>
  );
}

