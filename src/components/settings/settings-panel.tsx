'use client';

import type { ReactNode } from 'react';
import { useAccount } from '@/contexts/account-context';
import { AccountsList } from '@/components/accounts-list';
import { AccountSettingsTab } from '@/components/settings/account-settings-tab';
import { CustomFieldsTab } from '@/components/settings/custom-fields-tab';
import { IntegrationsTab } from '@/components/settings/integrations-tab';
import { AlertRulesTab } from '@/components/settings/alert-rules-tab';
import { AppearanceTab } from '@/components/settings/appearance-tab';
import { ClientReportsTab } from '@/components/settings/client-reports-tab';
import { BudgetChannelsTab } from '@/components/settings/budget-channels-tab';
import { CoopGuidelinesTab } from '@/components/settings/coop-guidelines-tab';
import { AdSizesTab } from '@/components/settings/ad-sizes-tab';
import { AdDisclaimersTab } from '@/components/settings/ad-disclaimers-tab';
import { AdOemRulesTab } from '@/components/settings/ad-oem-rules-tab';
import { AdAutomationTab } from '@/components/settings/ad-automation-tab';
import { CustomFieldBlueprintsTab } from '@/components/settings/custom-field-blueprints-tab';
import { DefaultMarkupTab } from '@/components/settings/default-markup-tab';
import { IndustriesTab } from '@/components/settings/industries-tab';
import { KnowledgeBaseTab } from '@/components/settings/knowledge-base-tab';
import { NotificationsTab } from '@/components/settings/notifications-tab';
import { RateCardsTab } from '@/components/settings/rate-cards-tab';
import { TeamsTab } from '@/components/settings/teams-tab';
import { UsersTab } from '@/components/settings/users-tab';
import type { SettingsTabKey } from '@/components/settings/settings-registry';

/**
 * The panel behind each settings tab — ONE definition, shared by the Settings
 * page and the Agency Settings modal.
 *
 * Both surfaces used to carry their own hand-written `activeTab === 'x' && <X/>`
 * chain, and the page's also re-checked the role/scope conditions that the
 * registry's `visible` predicate had already decided. That duplication is not
 * cosmetic: when the two disagreed, the rail rendered a row whose panel was
 * gated off, so a real tab looked like a dead one. That is exactly how Markup
 * and Channels shipped invisible — `isAdmin` in the page's guard meant the
 * retired "Agency View", which is never true out in the app shell.
 *
 * So there are no guards here at all, on purpose. Visibility is the registry's
 * job, and the active tab is always one the registry already returned. A panel
 * that needs a permission check inside it (Integrations wanting an account) does
 * that check itself, where the answer is actually needed.
 *
 * The map is a `Record<SettingsTabKey, …>`, so adding a key to the registry
 * without giving it a panel is a COMPILE error rather than a blank screen.
 * Thunks, not elements, so switching tabs doesn't build the other fifteen.
 */
export type SettingsPanelProps = {
  tab: SettingsTabKey;
  /**
   * Drill-in handlers, supplied by the modal so opening a user or an account
   * stays inside the overlay instead of navigating the shell behind it. Absent
   * on the page, where the shared components navigate as normal.
   */
  onOpenAccount?: (accountKey: string) => void;
  onOpenUser?: (userId: string) => void;
  onCreateUser?: () => void;
  /**
   * Agency Settings spans the whole fleet even when the surrounding page is
   * scoped to one group, so the modal passes false to drop the restriction.
   */
  restrictAccountsToScope?: boolean;
};

/** The panel behind a `soon` registry entry: scoped, not built. */
function Planned({ what, children }: { what: string; children: React.ReactNode }) {
  return (
    <div className="max-w-xl rounded-xl border border-dashed border-[var(--border)] p-6">
      <p className="text-sm font-semibold text-[var(--foreground)]">{what}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted-foreground)]">{children}</p>
      <p className="mt-3 text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
        Not built yet
      </p>
    </div>
  );
}

export function SettingsPanel({
  tab,
  onOpenAccount,
  onOpenUser,
  onCreateUser,
  restrictAccountsToScope = true,
}: SettingsPanelProps) {
  const { isGroup, scopedAccountKeys } = useAccount();

  const panels: Record<SettingsTabKey, () => ReactNode> = {
    subaccount: () => <AccountSettingsTab />,
    'contact-fields': () => <CustomFieldsTab />,
    integrations: () => <IntegrationsTab />,
    subaccounts: () => (
      <AccountsList
        listPath="/settings/subaccounts"
        detailBasePath="/settings/subaccounts"
        restrictKeys={restrictAccountsToScope && isGroup ? scopedAccountKeys : undefined}
        onOpenAccount={onOpenAccount}
        onOpenUser={onOpenUser}
        onCreateUser={onCreateUser}
      />
    ),
    users: () => (
      <UsersTab agencyScope onOpenUser={onOpenUser} onCreateUser={onCreateUser} />
    ),
    // Same table, the CLIENT roster — every account's client logins in one
    // list, rather than one rooftop's at a time.
    'client-users': () => (
      <UsersTab allClients onOpenUser={onOpenUser} onCreateUser={onCreateUser} />
    ),
    teams: () => <TeamsTab />,
    knowledge: () => <KnowledgeBaseTab />,
    industries: () => <IndustriesTab />,
    // Rate cards lead: they're what actually prices work now. The single agency
    // default below them is only the fallback for a channel with no card, so it
    // reads as the footnote it has become.
    markup: () => (
      <div className="space-y-4">
        <RateCardsTab />
        <DefaultMarkupTab />
      </div>
    ),
    'budget-channels': () => <BudgetChannelsTab />,
    alerts: () => <AlertRulesTab />,
    'coop-guidelines': () => <CoopGuidelinesTab />,
    // Ad Generator config, moved off the cog on the generator's own header.
    'ad-sizes': () => <AdSizesTab />,
    'ad-disclaimers': () => <AdDisclaimersTab />,
    'ad-oem-rules': () => <AdOemRulesTab />,
    'ad-automation': () => <AdAutomationTab />,
    'contact-field-blueprints': () => <CustomFieldBlueprintsTab />,
    'client-reports': () => <ClientReportsTab />,
    notifications: () => <NotificationsTab />,
    // `soon` entries: the rail renders these disabled and never links to them,
    // but a deep link or an old bookmark still has to land somewhere honest.
    'reporting-notifications': () => (
      <Planned what="Reporting notifications">
        Which reporting events raise a notification — a report finishing, a
        data source going quiet. Projects notifications are live today under
        Projects settings.
      </Planned>
    ),
    'reporting-alerts': () => (
      <Planned what="Reporting alerts">
        Alerts on results and data health — a drop in leads month over month,
        or a data source that stopped reporting. Distinct from the Projects
        alert engine, which watches paced media spend.
      </Planned>
    ),
    appearance: () => <AppearanceTab />,
  };

  return <>{panels[tab]()}</>;
}

/**
 * The tabs that have a panel. Exported so a test can assert the registry and
 * this map stay in step at runtime too — the type already guarantees it, but
 * the assertion is what fails loudly if the type is ever widened to `string`.
 */
export const SETTINGS_PANEL_KEYS: SettingsTabKey[] = [
  'subaccounts',
  'subaccount',
  'contact-fields',
  'integrations',
  'users',
  'client-users',
  'teams',
  'knowledge',
  'industries',
  'markup',
  'budget-channels',
  'alerts',
  'coop-guidelines',
  'ad-sizes',
  'ad-disclaimers',
  'ad-oem-rules',
  'ad-automation',
  'contact-field-blueprints',
  'client-reports',
  'notifications',
  'reporting-notifications',
  'reporting-alerts',
  'appearance',
];
