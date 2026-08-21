import { describe, it, expect } from 'vitest';
import {
  agencySettingsNavForScope,
  canonicalSubaccountSection,
  sectorSettingsTabsForScope,
  settingsTabsForScope,
  type SettingsScope,
} from './settings-registry';

// The Agency-View rail and the Settings tab list used to be two hand-maintained
// lists (buildAgencyNav in sidebar.tsx, and useSettingsTabs). They drifted: a
// tab could render with no nav row pointing at it, which is unreachable UI.
// These lock the invariant that both now derive from one registry.

const BASE: SettingsScope = {
  isAdmin: false,
  isAccount: false,
  isGroup: false,
  hasAdminAccess: false,
  isElevated: false,
  surface: 'studio',
  oemRelevant: false,
};

const scope = (patch: Partial<SettingsScope>): SettingsScope => ({ ...BASE, ...patch });

/** Agency View as a developer/super_admin at an agency with OEM accounts. */
const AGENCY_ELEVATED = scope({
  isAdmin: true,
  hasAdminAccess: true,
  isElevated: true,
  oemRelevant: true,
});

/** Agency View as a plain admin — no elevated configuration items. */
const AGENCY_ADMIN = scope({ isAdmin: true, hasAdminAccess: true, oemRelevant: true });

/** Inside a sub-account, admin role, on Studio. */
const SUBACCOUNT_ADMIN = scope({ isAccount: true, hasAdminAccess: true });

const keysOf = (s: SettingsScope) => settingsTabsForScope(s).map((t) => t.key);
const navKeysOf = (s: SettingsScope) =>
  agencySettingsNavForScope(s).flatMap((g) => g.items.map((i) => i.key));
/**
 * The tabs that BELONG in the agency rail — everything the registry returns
 * minus the sector-owned ones, which render in their sector's own settings
 * panel and never in the modal.
 */
const agencyOwnedKeysOf = (s: SettingsScope) =>
  settingsTabsForScope(s)
    .filter((t) => t.rail !== 'sector')
    .map((t) => t.key);

/** Agency View, elevated, on the Projects surface. */
const AGENCY_ELEVATED_APP = scope({
  isAdmin: true,
  hasAdminAccess: true,
  isElevated: true,
  oemRelevant: true,
  surface: 'app',
});

describe('one entry, one rail', () => {
  const sectorKeys = (surface: SettingsScope['surface']) =>
    sectorSettingsTabsForScope(scope({ ...AGENCY_ELEVATED, surface })).map((t) => t.key);

  it('never lists the same tab on both rails', () => {
    for (const surface of ['studio', 'reporting', 'app'] as const) {
      const s = scope({ ...AGENCY_ELEVATED, surface });
      const overlap = navKeysOf(s).filter((k) => sectorKeys(surface).includes(k));
      expect(overlap, surface).toEqual([]);
    }
  });

  it('keeps Appearance out of every sector: it is personal, not sector config', () => {
    // Theme, accent, font, density and the reduce-motion prefs follow the USER.
    // It used to appear on all three sector rails as well as in the modal.
    for (const surface of ['studio', 'reporting', 'app'] as const) {
      expect(sectorKeys(surface), surface).not.toContain('appearance');
    }
    expect(navKeysOf(AGENCY_ELEVATED)).toContain('appearance');
  });

  it('gives Reporting something of its own now that Appearance has gone', () => {
    // An empty settings panel reads as broken, and "who sees which reports" is
    // the question you arrive at Reporting settings with.
    expect(sectorKeys('reporting')).toContain('client-reports');
    expect(sectorKeys('studio')).not.toContain('client-reports');
    expect(sectorKeys('app')).not.toContain('client-reports');
  });

  it('keeps Notifications on the sector rail, not the agency one', () => {
    expect(navKeysOf(AGENCY_ELEVATED)).not.toContain('notifications');
    expect(sectorKeys('studio')).toContain('notifications');
    // Reporting has no notification categories of its own.
    expect(sectorKeys('reporting')).not.toContain('notifications');
  });
});

describe('the client roster', () => {
  it('sits in Agency Settings, next to Users', () => {
    const keys = keysOf(AGENCY_ELEVATED);
    expect(keys).toContain('client-users');
    expect(keys.indexOf('client-users')).toBe(keys.indexOf('users') + 1);
  });

  it('shows on every surface — clients are not a sector concern', () => {
    for (const surface of ['studio', 'reporting', 'app'] as const) {
      expect(keysOf(scope({ ...AGENCY_ELEVATED, surface })), surface).toContain('client-users');
    }
  });

  it('needs admin access, like the agency roster', () => {
    expect(keysOf(scope({ isAdmin: true, hasAdminAccess: false }))).not.toContain('client-users');
  });
});

describe('budget config is Projects-sector', () => {
  it('shows Markup and Channels only on the Projects surface', () => {
    // Budgets live in Projects — the hub, intake and the Ad Pacer are the only
    // readers of markup, rate cards and channels. Same treatment as Sending/SMS
    // (Studio-only) and Report Access (Reporting-only).
    for (const key of ['markup', 'budget-channels']) {
      expect(keysOf(AGENCY_ELEVATED_APP), key).toContain(key);
      expect(keysOf(AGENCY_ELEVATED), key).not.toContain(key);
      expect(keysOf(scope({ ...AGENCY_ELEVATED, surface: 'reporting' })), key).not.toContain(key);
    }
  });

  it('reaches the Projects settings PANEL, not just the cog modal', () => {
    // The bug this pins: gating on `isAdmin` confined them to the modal, which
    // forces `isAdmin: true`. In the app shell `isAdmin` means the retired
    // "Agency View" and is effectively never true — so the panel showed only
    // Notifications and Appearance.
    const panelScope = scope({ isElevated: true, hasAdminAccess: true, surface: 'app' });
    expect(panelScope.isAdmin).toBe(false);
    expect(keysOf(panelScope)).toContain('markup');
    expect(keysOf(panelScope)).toContain('budget-channels');
  });

  it('still gates them on an elevated role, not just the surface', () => {
    // Markup is margin. Being on Projects is not a permission.
    const plainAdminOnApp = scope({
      isAdmin: true,
      hasAdminAccess: true,
      surface: 'app',
    });
    expect(keysOf(plainAdminOnApp)).not.toContain('markup');
    expect(keysOf(plainAdminOnApp)).not.toContain('budget-channels');
  });

  it('is reachable from the Projects panel and absent from the agency rail', () => {
    // Both halves matter: present where it lives, gone from where it doesn't.
    for (const key of ['markup', 'budget-channels', 'alerts']) {
      expect(keysOf(AGENCY_ELEVATED_APP), key).toContain(key);
      expect(navKeysOf(AGENCY_ELEVATED_APP), key).not.toContain(key);
    }
  });
});

describe('settings registry', () => {
  it('gives every agency-owned tab a rail row, and vice versa', () => {
    // The original failure this file exists for: a tab that renders with no way
    // to navigate to it. Sector-owned entries are excluded on both sides — they
    // have a row in their sector's panel instead, asserted separately below.
    for (const s of [AGENCY_ELEVATED, AGENCY_ADMIN, AGENCY_ELEVATED_APP]) {
      expect(navKeysOf(s)).toEqual(agencyOwnedKeysOf(s));
    }
  });

  it('keeps sector-owned config out of the agency rail entirely', () => {
    // Agency Settings is platform config. Anything that drives ONE sector —
    // budget channels, pacing alerts, markup, OEM co-op, contact blueprints —
    // belongs to that sector, on every surface, including its own.
    for (const surface of ['studio', 'reporting', 'app'] as const) {
      const railKeys = navKeysOf(scope({ ...AGENCY_ELEVATED, surface }));
      for (const sectorOwned of [
        'markup',
        'budget-channels',
        'alerts',
        'coop-guidelines',
        'contact-field-blueprints',
      ]) {
        expect(railKeys, `${surface}/${sectorOwned}`).not.toContain(sectorOwned);
      }
    }
  });

  it('keeps the Agency-View rail in Manage-then-Configure order', () => {
    const groups = agencySettingsNavForScope(AGENCY_ELEVATED);
    expect(groups.map((g) => g.label)).toEqual(['Manage', 'Configure']);
    expect(groups[0].items.map((i) => i.key)).toEqual([
      'subaccounts',
      'users',
      'client-users',
      'teams',
      'knowledge',
    ]);
    // Markup, Channels, Alerts, Co-op Guidelines and Notifications are all
    // sector-owned now — what's left under Configure is platform-wide, plus
    // Appearance, which is personal and follows the user across surfaces.
    expect(groups[1].items.map((i) => i.key)).toEqual(['industries', 'appearance']);
  });

  it('points rail hrefs at the browser-facing /settings path', () => {
    for (const item of agencySettingsNavForScope(AGENCY_ELEVATED).flatMap((g) => g.items)) {
      expect(item.href).toBe(`/settings/${item.key}`);
    }
  });

  it('drops elevated-only configuration for a plain admin', () => {
    const keys = keysOf(AGENCY_ADMIN);
    expect(keys).not.toContain('industries');
    expect(keys).not.toContain('markup');
    expect(keys).not.toContain('alerts');
    // Still an admin, so the directories and the OEM library remain.
    expect(keys).toContain('users');
    expect(keys).toContain('coop-guidelines');
  });

  it('hides the co-op library when no in-scope account is OEM-flavoured', () => {
    expect(keysOf(scope({ ...AGENCY_ELEVATED, oemRelevant: false }))).not.toContain(
      'coop-guidelines',
    );
  });

  it('keeps agency-only platform config out of an account', () => {
    const keys = keysOf(SUBACCOUNT_ADMIN);
    for (const agencyOnly of ['subaccounts', 'users', 'teams', 'knowledge', 'industries']) {
      expect(keys).not.toContain(agencyOnly);
    }
    // Nothing per-ACCOUNT is left in this list either: General, Integrations
    // and Custom Fields are tabs on the account itself now (Agency Settings →
    // Accounts). What remains is sector-owned or personal, and stays visible
    // whatever the account scope — the picker is hidden inside settings, so
    // gating these by scope would make them unreachable.
    expect(keys).toEqual(['contact-field-blueprints', 'notifications', 'appearance']);
  });

  it('keeps Field Blueprints to Studio', () => {
    // Custom Fields moved onto the account (see TABS in subaccount-detail);
    // what this list still carries is the global blueprint library, Studio's.
    for (const surface of ['app', 'reporting'] as const) {
      expect(keysOf(scope({ ...SUBACCOUNT_ADMIN, surface }))).not.toContain(
        'contact-field-blueprints',
      );
    }
    expect(keysOf(SUBACCOUNT_ADMIN)).toContain('contact-field-blueprints');
  });

  it('offers Notifications everywhere but Reporting, which has no categories', () => {
    expect(keysOf(scope({ surface: 'studio' }))).toContain('notifications');
    expect(keysOf(scope({ surface: 'app' }))).toContain('notifications');
    expect(keysOf(scope({ surface: 'reporting' }))).not.toContain('notifications');
  });

  it('never returns an empty group, so no heading dangles', () => {
    // A client role in Agency View can see only the personal entries.
    for (const s of [BASE, AGENCY_ELEVATED, AGENCY_ADMIN, SUBACCOUNT_ADMIN]) {
      for (const group of agencySettingsNavForScope(s)) {
        expect(group.items.length).toBeGreaterThan(0);
      }
    }
  });

  it('always offers Appearance, in every scope and sector', () => {
    for (const s of [BASE, AGENCY_ELEVATED, AGENCY_ADMIN, SUBACCOUNT_ADMIN]) {
      for (const surface of ['studio', 'reporting', 'app'] as const) {
        expect(keysOf(scope({ ...s, surface }))).toContain('appearance');
      }
    }
  });
});

// The sub-account section suite lived here. It tested `subaccountSectionsForScope`
// and the "Account Settings" / "<Sector> Settings" grouping — a per-sector tab
// list for the app-shell variant of an account's settings, both deleted with
// that variant. An account's tabs are now the `TABS` list in
// subaccount-detail, rendered the one way.

describe('legacy section keys', () => {
  it('reads the legacy `company` key as `general`', () => {
    // Still live: old bookmarks and the redirect from the retired
    // /subaccount/<slug>/settings routes both carry `company`.
    expect(canonicalSubaccountSection('company')).toBe('general');
    expect(canonicalSubaccountSection('general')).toBe('general');
    expect(canonicalSubaccountSection('branding')).toBe('branding');
    expect(canonicalSubaccountSection(undefined)).toBeUndefined();
  });
});
