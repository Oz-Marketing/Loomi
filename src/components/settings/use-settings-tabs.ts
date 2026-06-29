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
  const { isAdmin, isAccount, userRole } = useAccount();
  const surface = useCurrentSurface();
  const isApp = surface === 'app';
  const hasAdminAccess = userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';
  // Elevated = developer / super_admin only (no plain admin).
  const isElevated = userRole === 'developer' || userRole === 'super_admin';

  const tabs: SettingsTab[] = [];
  // Order: Sub-Accounts → Users → Teams → Field Blueprints → rest.
  if (hasAdminAccess && isAdmin) tabs.push({ key: 'subaccounts', label: 'Sub-Accounts', titleLabel: 'Sub-Account Settings', icon: BuildingStorefrontIcon });
  if (isAccount) tabs.push({ key: 'subaccount', label: 'Sub-Account', titleLabel: 'Sub-Account Settings', icon: BuildingStorefrontIcon });
  if (hasAdminAccess) tabs.push({ key: 'users', label: 'Users', titleLabel: 'User Settings', icon: UsersIcon });
  if (hasAdminAccess) tabs.push({ key: 'teams', label: 'Teams', titleLabel: 'Teams', icon: UserGroupIcon });
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
