'use client';

import {
  BuildingStorefrontIcon,
  UsersIcon,
  UserGroupIcon,
  SwatchIcon,
  SparklesIcon,
  BellIcon,
  BellAlertIcon,
  TagIcon,
  Squares2X2Icon,
  BriefcaseIcon,
  CalculatorIcon,
  PuzzlePieceIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useCurrentSurface } from '@/lib/hooks/use-current-surface';

export type SettingsTabKey =
  | 'subaccounts'
  | 'subaccount'
  | 'users'
  | 'teams'
  | 'knowledge'
  | 'industries'
  | 'markup'
  | 'alerts'
  | 'coop-guidelines'
  | 'contact-fields'
  | 'contact-field-blueprints'
  | 'integrations'
  | 'notifications'
  | 'appearance';

export type SettingsTab = {
  key: SettingsTabKey;
  label: string;
  titleLabel: string;
  icon: React.ComponentType<{ className?: string }>;
};

/**
 * The role/mode-gated Settings tabs — shared by the Settings page and the
 * sidebar's settings nav so both stay in sync.
 */
/**
 * Industries whose accounts carry OEM/manufacturer behaviour, and so have co-op
 * guidelines to govern. Matches the pair called out in `industry-defaults`.
 *
 * Exported because the Agency-View sidebar declares its own nav items rather than
 * reading this hook — one definition, so the tab and the link into it can't
 * disagree about who should see them.
 */
export const OEM_INDUSTRIES = new Set(['Automotive', 'Powersports']);

export function useSettingsTabs(): SettingsTab[] {
  const { isAdmin, isAccount, isGroup, userRole, accounts } = useAccount();
  const surface = useCurrentSurface();
  const isApp = surface === 'app';
  const hasAdminAccess = userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';
  // Elevated = developer / super_admin only (no plain admin).
  const isElevated = userRole === 'developer' || userRole === 'super_admin';

  const tabs: SettingsTab[] = [];
  // Settings are tiered by the active scope (see the agency/org/sub-account
  // taxonomy):
  //   • AGENCY VIEW (isAdmin): platform config + top-level directories.
  //   • ORGANIZATION (isGroup): the org profile + its sub-accounts.
  //   • SUB-ACCOUNT (isAccount): that location's own settings.
  //   • Notifications/Appearance are personal and show everywhere.

  // ── Organization tier ──

  // ── Sub-Accounts directory — the whole fleet in Agency View, scoped to the
  //    org in Organization mode. ──
  if (hasAdminAccess && (isAdmin || isGroup)) tabs.push({ key: 'subaccounts', label: 'Sub-Accounts', titleLabel: 'Sub-Account Settings', icon: BuildingStorefrontIcon });

  // ── Agency-only directories ──

  // ── Sub-account tier ──
  if (isAccount) tabs.push({ key: 'subaccount', label: 'Sub-Account', titleLabel: 'Sub-Account Settings', icon: BuildingStorefrontIcon });

  // ── Agency directory: the global user + team roster (not scoped, so it lives
  //    only in Agency View). ──
  if (hasAdminAccess && isAdmin) tabs.push({ key: 'users', label: 'Users', titleLabel: 'User Settings', icon: UsersIcon });
  if (hasAdminAccess && isAdmin) tabs.push({ key: 'teams', label: 'Teams', titleLabel: 'Teams', icon: UserGroupIcon });
  if (hasAdminAccess && isAccount) tabs.push({ key: 'integrations', label: 'Integrations', titleLabel: 'Integrations', icon: PuzzlePieceIcon });
  // Custom Fields are a Studio concern — hidden on the App surface.
  if (hasAdminAccess && isAccount && !isApp) tabs.push({ key: 'contact-fields', label: 'Custom Fields', titleLabel: 'Contact Custom Fields', icon: TagIcon });
  if (hasAdminAccess && isAdmin) tabs.push({ key: 'contact-field-blueprints', label: 'Field Blueprints', titleLabel: 'Contact Field Blueprints', icon: Squares2X2Icon });
  if (hasAdminAccess && isAdmin) tabs.push({ key: 'knowledge', label: 'Knowledge Base', titleLabel: 'Knowledge Base Settings', icon: SparklesIcon });
  if (isElevated && isAdmin) tabs.push({ key: 'industries', label: 'Industries', titleLabel: 'Industry Settings', icon: BriefcaseIcon });
  if (isElevated && isAdmin) tabs.push({ key: 'markup', label: 'Markup', titleLabel: 'Default Markup', icon: CalculatorIcon });
  if (isElevated && isAdmin) tabs.push({ key: 'alerts', label: 'Alerts', titleLabel: 'Alert Rules', icon: BellAlertIcon });

  // ── Co-op guidelines ──
  //
  // Manufacturer guideline documents, the rules transcribed from them, and the
  // sales-event marks.
  //
  // AGENCY VIEW ONLY, because the data is global — one library per make, shared by
  // every sub-account. Offering it inside a sub-account would imply the documents
  // were that location's, which is exactly backwards.
  //
  // Gated on industry as well: an agency with no manufacturer relationships has no
  // co-op to govern. The test is whether ANY account is OEM-flavoured, since in
  // Agency View the library spans the whole fleet rather than one location.
  const oemRelevant = Object.values(accounts ?? {}).some((a) => OEM_INDUSTRIES.has(a?.category ?? ''));
  if (hasAdminAccess && isAdmin && oemRelevant) {
    tabs.push({
      key: 'coop-guidelines',
      label: 'Co-op Guidelines',
      titleLabel: 'OEM Guidelines & Sales Events',
      icon: ShieldCheckIcon,
    });
  }
  tabs.push({ key: 'notifications', label: 'Notifications', titleLabel: 'Notification Settings', icon: BellIcon });
  tabs.push({ key: 'appearance', label: 'Appearance', titleLabel: 'Appearance Settings', icon: SwatchIcon });

  return tabs;
}
