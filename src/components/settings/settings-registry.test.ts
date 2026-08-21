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
/**
 * What BELONGS in the agency rail — everything visible minus the sector-owned
 * entries, which render in their own sector's settings panel and never in the
 * modal. Agency Settings is platform config; anything that drives one sector
 * belongs to that sector.
 */
const agencyOwnedKeysOf = (s: SettingsScope) =>
  settingsTabsForScope(s)
    .filter((t) => t.rail !== 'sector')
    .map((t) => t.key);

describe('settings registry', () => {
  it('gives every agency-owned tab a rail row, and vice versa', () => {
    // The original failure this file exists for: a tab that renders with no way
    // to navigate to it. Sector-owned entries are excluded on both sides.
    for (const s of [AGENCY_ELEVATED, AGENCY_ADMIN]) {
      expect(navKeysOf(s)).toEqual(agencyOwnedKeysOf(s));
    }
  });

  it('keeps sector-owned config out of the agency rail, on every surface', () => {
    for (const surface of ['studio', 'reporting', 'app'] as const) {
      const rail = navKeysOf(scope({ ...AGENCY_ELEVATED, surface }));
      for (const owned of [
        'markup',
        'budget-channels',
        'alerts',
        'coop-guidelines',
        'contact-field-blueprints',
        'client-reports',
      ]) {
        expect(rail, `${surface}/${owned}`).not.toContain(owned);
      }
    }
  });

  it('keeps the Agency-View rail in Manage-then-Configure order', () => {
    const groups = agencySettingsNavForScope(AGENCY_ELEVATED);
    expect(groups.map((g) => g.label)).toEqual(['Manage', 'Configure']);
    // Field Blueprints left for Studio, Markup/Alerts for Projects, Co-op for
    // Studio; Clients joined next to Users.
    expect(groups[0].items.map((i) => i.key)).toEqual([
      'subaccounts',
      'users',
      'client-users',
      'teams',
      'knowledge',
    ]);
    expect(groups[1].items.map((i) => i.key)).toEqual([
      'industries',
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

  it('keeps agency-only platform config out of an account', () => {
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

describe('account settings sections', () => {
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

  it('keeps Email & Texts to Studio', () => {
    // Reporting and Projects don't send anything, so a SendGrid key or a
    // suppression list there would be a dead panel.
    expect(sectionKeys('studio')).toContain('email-texts');
    for (const surface of ['reporting', 'app'] as const) {
      expect(sectionKeys(surface)).not.toContain('email-texts');
    }
  });

  it('exposes email settings as ONE nav entry, not four', () => {
    // Email identity, SMS, the footer, and suppressions are sub-tabs of
    // Email & Texts. Four sibling entries read as four unrelated pages.
    const keys = sectionKeys('studio');
    for (const retired of ['sending', 'sms', 'email-footer', 'suppressions']) {
      expect(keys).not.toContain(retired);
    }
    expect(keys[keys.indexOf('contact-fields') + 1]).toBe('email-texts');
  });

  it('offers Notifications everywhere but Reporting', () => {
    expect(sectionKeys('studio')).toContain('notifications');
    expect(sectionKeys('app')).toContain('notifications');
    expect(sectionKeys('reporting')).not.toContain('notifications');
  });

  it('gives Reporting the core plus Reports, and nothing else', () => {
    expect(sectionKeys('reporting')).toEqual([
      'general',
      'users',
      'branding',
      'integrations',
      // Which reports this sub-account's client users see — see
      // components/settings/report-access-tab.
      'reports',
      'appearance',
    ]);
  });

  it('keeps Reports out of the other sectors', () => {
    expect(sectionKeys('studio')).not.toContain('reports');
    expect(sectionKeys('app')).not.toContain('reports');
  });

  // It edits what CLIENTS are shown and is guarded by `reporting.configure`,
  // which no client role carries. Rendering it for someone who can't save
  // would be a dead panel at best.
  it('hides Reports from users without admin access', () => {
    const keys = subaccountSectionsForScope(
      scope({ isAccount: true, hasAdminAccess: false, surface: 'reporting' }),
    ).map((s) => s.key);
    expect(keys).not.toContain('reports');
  });

  it('reads the legacy `company` key as `general`', () => {
    expect(canonicalSubaccountSection('company')).toBe('general');
    expect(canonicalSubaccountSection('general')).toBe('general');
    expect(canonicalSubaccountSection('branding')).toBe('branding');
    expect(canonicalSubaccountSection(undefined)).toBeUndefined();
  });
});
