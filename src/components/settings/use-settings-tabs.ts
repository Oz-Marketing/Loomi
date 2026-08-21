'use client';

import { useAccount } from '@/contexts/account-context';
import { useCurrentSurface } from '@/lib/hooks/use-current-surface';
import {
  OEM_INDUSTRIES,
  agencySettingsNavForScope,
  sectorSettingsTabsForScope,
  type AgencyNavGroup,
  type SettingsScope,
  type SettingsTab,
} from '@/components/settings/settings-registry';

// The registry (data + pure derivation) lives in ./settings-registry so it can
// be unit-tested without React. This module is only the binding to the account
// context / current surface.
export {
  OEM_INDUSTRIES,
  canonicalSubaccountSection,
  type AgencyNavGroup,
  type SettingsGroup,
  type SettingsScope,
  type SettingsTab,
  type SettingsTabKey,
} from '@/components/settings/settings-registry';

/** The scope/role facts the registry's visibility rules read. */
export function useSettingsScope(): SettingsScope {
  const { isAdmin, isAccount, isGroup, userRole, accounts } = useAccount();
  const surface = useCurrentSurface();
  return {
    isAdmin,
    isAccount,
    isGroup,
    hasAdminAccess:
      userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin',
    isElevated: userRole === 'developer' || userRole === 'super_admin',
    // Surface is host-derived and null until hydration; default that window to
    // Studio (the full view) rather than briefly hiding Studio-only entries.
    surface: surface ?? 'studio',
    oemRelevant: Object.values(accounts ?? {}).some((a) => OEM_INDUSTRIES.has(a?.category ?? '')),
  };
}

/**
 * This SECTOR's settings tabs — shared by the Settings page and the sidebar's
 * settings nav so both stay in sync. Platform config isn't here; it's in the
 * cog's modal (see `useAgencySettingsNav`).
 */
export function useSettingsTabs(): SettingsTab[] {
  return sectorSettingsTabsForScope(useSettingsScope());
}

/**
 * The Agency Settings rail's destinations, grouped under Manage/Configure.
 *
 * Evaluated in AGENCY scope regardless of which sub-account is active. The
 * modal deliberately leaves the surrounding account scope alone, so asking the
 * registry with the ambient scope would return that sub-account's settings
 * instead of the platform's. Role gating still applies — an agency entry the
 * user's role can't see stays hidden.
 */
export function useAgencySettingsNav(): AgencyNavGroup[] {
  const scope = useSettingsScope();
  return agencySettingsNavForScope({
    ...scope,
    isAdmin: true,
    isAccount: false,
    isGroup: false,
  });
}


