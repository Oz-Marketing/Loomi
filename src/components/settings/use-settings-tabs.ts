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
  BuildingOffice2Icon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useCurrentSurface } from '@/lib/hooks/use-current-surface';

export type SettingsTabKey =
  | 'subaccounts'
  | 'organizations'
  | 'organization'
  | 'subaccount'
  | 'users'
  | 'teams'
  | 'knowledge'
  | 'industries'
  | 'markup'
  | 'alerts'
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
export function useSettingsTabs(): SettingsTab[] {
  const { isAdmin, isAccount, isOrg, userRole } = useAccount();
  const surface = useCurrentSurface();
  const isApp = surface === 'app';
  const hasAdminAccess = userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';
  // Elevated = developer / super_admin only (no plain admin).
  const isElevated = userRole === 'developer' || userRole === 'super_admin';

  const tabs: SettingsTab[] = [];
  // Settings are tiered by the active scope (see the agency/org/sub-account
  // taxonomy):
  //   • AGENCY VIEW (isAdmin): platform config + top-level directories.
  //   • ORGANIZATION (isOrg): the org profile + its sub-accounts.
  //   • SUB-ACCOUNT (isAccount): that location's own settings.
  //   • Notifications/Appearance are personal and show everywhere.

  // ── Organization tier ──
  if (hasAdminAccess && isOrg) tabs.push({ key: 'organization', label: 'Organization', titleLabel: 'Organization Settings', icon: BuildingOffice2Icon });

  // ── Sub-Accounts directory — the whole fleet in Agency View, scoped to the
  //    org in Organization mode. ──
  if (hasAdminAccess && (isAdmin || isOrg)) tabs.push({ key: 'subaccounts', label: 'Sub-Accounts', titleLabel: 'Sub-Account Settings', icon: BuildingStorefrontIcon });

  // ── Agency-only directories ──
  if (isElevated && isAdmin) tabs.push({ key: 'organizations', label: 'Organizations', titleLabel: 'Organizations', icon: BuildingOffice2Icon });

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
  tabs.push({ key: 'notifications', label: 'Notifications', titleLabel: 'Notification Settings', icon: BellIcon });
  tabs.push({ key: 'appearance', label: 'Appearance', titleLabel: 'Appearance Settings', icon: SwatchIcon });

  return tabs;
}
