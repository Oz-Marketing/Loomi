import { describe, it, expect } from 'vitest';
import {
  agencySettingsNavForScope,
  canonicalSubaccountSection,
  settingsTabsForScope,
  subaccountSectionsForScope,
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

describe('settings registry', () => {
  it('gives every visible Agency-View tab a rail row, and vice versa', () => {
    for (const s of [AGENCY_ELEVATED, AGENCY_ADMIN]) {
      expect(navKeysOf(s)).toEqual(keysOf(s));
    }
  });

  it('keeps the Agency-View rail in Manage-then-Configure order', () => {
    const groups = agencySettingsNavForScope(AGENCY_ELEVATED);
    expect(groups.map((g) => g.label)).toEqual(['Manage', 'Configure']);
    expect(groups[0].items.map((i) => i.key)).toEqual([
      'subaccounts',
      'users',
      'teams',
      'contact-field-blueprints',
      'knowledge',
    ]);
    expect(groups[1].items.map((i) => i.key)).toEqual([
      'industries',
      'markup',
      'alerts',
      'coop-guidelines',
      'notifications',
      'appearance',
    ]);
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

  it('keeps agency-only platform config out of a sub-account', () => {
    const keys = keysOf(SUBACCOUNT_ADMIN);
    for (const agencyOnly of [
      'subaccounts',
      'users',
      'teams',
      'contact-field-blueprints',
      'knowledge',
      'industries',
      'markup',
      'alerts',
      'coop-guidelines',
    ]) {
      expect(keys).not.toContain(agencyOnly);
    }
    expect(keys).toEqual(['subaccount', 'integrations', 'contact-fields', 'notifications', 'appearance']);
  });

  it('keeps Custom Fields to Studio', () => {
    expect(keysOf(scope({ ...SUBACCOUNT_ADMIN, surface: 'app' }))).not.toContain('contact-fields');
    expect(keysOf(scope({ ...SUBACCOUNT_ADMIN, surface: 'reporting' }))).not.toContain(
      'contact-fields',
    );
    expect(keysOf(SUBACCOUNT_ADMIN)).toContain('contact-fields');
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

// The sub-account tier is CORE + SECTOR: the same five sections wherever you
// are, plus whatever that sector owns.

const CORE = ['general', 'users', 'branding', 'integrations', 'appearance'];

const sectionKeys = (surface: 'studio' | 'reporting' | 'app') =>
  subaccountSectionsForScope(scope({ isAccount: true, hasAdminAccess: true, surface })).map(
    (s) => s.key,
  );

describe('sub-account settings sections', () => {
  it('offers the same core sections in every sector', () => {
    for (const surface of ['studio', 'reporting', 'app'] as const) {
      for (const key of CORE) {
        expect(sectionKeys(surface)).toContain(key);
      }
    }
  });

  it('keeps Domains and Custom Fields to Studio', () => {
    expect(sectionKeys('studio')).toContain('domains');
    expect(sectionKeys('studio')).toContain('contact-fields');
    for (const surface of ['reporting', 'app'] as const) {
      expect(sectionKeys(surface)).not.toContain('domains');
      expect(sectionKeys(surface)).not.toContain('contact-fields');
    }
  });

  it('offers Notifications everywhere but Reporting', () => {
    expect(sectionKeys('studio')).toContain('notifications');
    expect(sectionKeys('app')).toContain('notifications');
    expect(sectionKeys('reporting')).not.toContain('notifications');
  });

  it('gives Reporting the core and nothing else', () => {
    expect(sectionKeys('reporting')).toEqual(CORE);
  });

  it('reads the legacy `company` key as `general`', () => {
    expect(canonicalSubaccountSection('company')).toBe('general');
    expect(canonicalSubaccountSection('general')).toBe('general');
    expect(canonicalSubaccountSection('branding')).toBe('branding');
    expect(canonicalSubaccountSection(undefined)).toBeUndefined();
  });
});
