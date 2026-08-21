import {
  BuildingStorefrontIcon,
  ChartBarIcon,
  UsersIcon,
  UserGroupIcon,
  SwatchIcon,
  SparklesIcon,
  BellIcon,
  ExclamationTriangleIcon,
  Squares2X2Icon,
  BriefcaseIcon,
  CalculatorIcon,
  ShieldCheckIcon,
  IdentificationIcon,
} from '@heroicons/react/24/outline';

export type SettingsTabKey =
  | 'subaccounts'
  | 'users'
  | 'client-users'
  | 'teams'
  | 'knowledge'
  | 'industries'
  | 'markup'
  | 'budget-channels'
  | 'alerts'
  | 'coop-guidelines'
  | 'contact-field-blueprints'
  | 'client-reports'
  | 'notifications'
  | 'appearance';

/**
 * Which heading an entry sits under in the Agency-View rail. Ignored everywhere
 * else — the sub-account settings rail renders a flat list.
 *
 * Notifications and Appearance are personal, not platform config, but they sit
 * under `configure` because that is where the Agency rail shows them today.
 * Tier 3 of docs/settings-architecture.md relocates them to
 * `/u/<userId>/settings`; until then, keeping the group faithful to what
 * renders is what stops the rail from shifting under this refactor.
 */
export type SettingsGroup = 'manage' | 'configure';

/**
 * WHICH rail an entry belongs to.
 *
 * The registry serves two readers that no longer want the same list: the cog's
 * Agency Settings rail, and a sector's own settings panel in the app shell. A
 * surface-gated entry used to appear in BOTH — Channels showed inside Agency
 * Settings whenever you happened to be on Projects, which is the opposite of
 * "it lives in Projects".
 *
 * Every entry belongs to exactly ONE rail:
 *
 *   'agency' (the default) — platform configuration. The cog's modal, only.
 *   'sector'               — a sector's own config. That sector's settings
 *                            panel, only. Pair it with a `surface` check in
 *                            `visible`, which says WHICH sector.
 *
 * It used to be "agency = both rails", which is why Appearance appeared on
 * every sector's rail as well as in the modal. One rail each keeps the two
 * lists honest: if it's here, it isn't there.
 *
 * Sector entries deliberately do NOT carry `!isAccount`, unlike the agency
 * ones. They're global, so the instinct is to hide them when the scope is a
 * single account — but the account picker is hidden inside settings, so that
 * would make them invisible to anyone who simply had an account selected.
 * Unreachable settings read as broken settings; their titles ("Default
 * Markup", "Budget Channels") already say they aren't the account's.
 */
export type SettingsRail = 'agency' | 'sector';

export type SettingsTab = {
  key: SettingsTabKey;
  label: string;
  /** Defaults to 'agency' when absent. */
  rail?: SettingsRail;
  /** Label for the Agency rail, where the row sits among non-settings nav and
   *  a bare "Users" would be ambiguous. Defaults to `label`. */
  navLabel?: string;
  titleLabel: string;
  group: SettingsGroup;
  icon: React.ComponentType<{ className?: string }>;
};

/**
 * Industries whose accounts carry OEM/manufacturer behaviour, and so have co-op
 * guidelines to govern. Matches the pair called out in `industry-defaults`.
 */
export const OEM_INDUSTRIES = new Set(['Automotive', 'Powersports']);

/**
 * The scope/role facts every visibility rule is written against. Derived from
 * the account context by `useSettingsScope`, so the registry below stays a
 * plain data table with no React in it.
 */
export type SettingsScope = {
  isAdmin: boolean;
  isAccount: boolean;
  isGroup: boolean;
  /** developer | super_admin | admin */
  hasAdminAccess: boolean;
  /** developer | super_admin only — no plain admin. */
  isElevated: boolean;
  /**
   * Which sector we're in. Surface is host-derived and resolves a tick after
   * mount, so `useSettingsScope` defaults the null window to 'studio' — the
   * full view — rather than briefly hiding Studio-only entries.
   */
  surface: 'studio' | 'reporting' | 'app';
  /** Any in-scope account is OEM-flavoured, so co-op guidelines apply. */
  oemRelevant: boolean;
};

type SettingsEntry = SettingsTab & { visible: (s: SettingsScope) => boolean };

/**
 * THE settings registry — the single definition of what Settings contains, who
 * can see each entry, and which Agency-rail heading it sits under.
 *
 * Both readers derive from this list, in this order:
 *   • `settingsTabsForScope`     — the Settings page's tabs + sub-account rail.
 *   • `agencySettingsNavForScope` — the Agency-View rail's groups.
 *
 * They used to be two hand-synced lists (`useSettingsTabs` and `buildAgencyNav`
 * in sidebar.tsx), which meant a tab could render with no way to navigate to
 * it. Add an entry here and every surface picks it up.
 *
 * Settings are tiered by the active scope (see the agency/sub-account taxonomy
 * in docs/settings-architecture.md):
 *   • AGENCY VIEW (isAdmin): platform config + top-level directories.
 *   • ORGANIZATION (isGroup): the org profile + its sub-accounts.
 *   • SUB-ACCOUNT (isAccount): that location's own settings.
 *   • Notifications/Appearance are personal and show everywhere.
 */
const SETTINGS_REGISTRY: SettingsEntry[] = [
  // ── Sub-Accounts directory — the whole fleet in Agency View, scoped to the
  //    org in Organization mode. ──
  {
    key: 'subaccounts',
    label: 'Accounts',
    titleLabel: 'Account Settings',
    group: 'manage',
    icon: BuildingStorefrontIcon,
    // Agency rail ONLY. It used to also appear for a group account, which put
    // the account directory — and the drill-in to every account's settings —
    // inside a sector's settings panel. The directory is platform work; a
    // group's roll-up views live on its own pages, not here.
    visible: (s) => s.hasAdminAccess && s.isAdmin,
  },
  // ── No sub-account tier here (2026-08-20) ──
  //
  // General, Integrations and Custom Fields used to appear in this list when a
  // single account was in scope, rendering that account's settings in the app
  // shell. They're tabs on the account itself now, in Agency Settings →
  // Accounts → the account — the same screens, one door. See the note on TABS
  // in components/subaccount-detail.
  // ── Agency directory: the global user + team roster (not scoped, so it lives
  //    only in Agency View). ──
  {
    key: 'users',
    label: 'Users',
    titleLabel: 'User Settings',
    group: 'manage',
    icon: UsersIcon,
    visible: (s) => s.hasAdminAccess && s.isAdmin,
  },
  // The CLIENT roster — every client login across every account, with the
  // account it belongs to on the row.
  //
  // A separate tab from Users rather than a filter on it, because they aren't
  // one population: an agency user holds sector roles, capabilities and team
  // membership, and a client holds an account and a report set. The old home
  // for these was each sub-account's own Users tab, which meant visiting 18
  // rooftops to answer "who can log in".
  {
    key: 'client-users',
    label: 'Clients',
    titleLabel: 'Client Users',
    group: 'manage',
    icon: IdentificationIcon,
    visible: (s) => s.hasAdminAccess && s.isAdmin,
  },
  {
    key: 'teams',
    label: 'Teams',
    titleLabel: 'Teams',
    group: 'manage',
    icon: UserGroupIcon,
    visible: (s) => s.hasAdminAccess && s.isAdmin,
  },
  // Blueprints define the shape of a CONTACT record, and contacts are Studio's.
  // The library is global (one set, every account) — that's what makes it a
  // sector-level screen rather than a per-account one, not an agency one.
  {
    key: 'contact-field-blueprints',
    label: 'Field Blueprints',
    titleLabel: 'Contact Field Blueprints',
    group: 'manage',
    icon: Squares2X2Icon,
    visible: (s) => s.surface === 'studio' && s.hasAdminAccess,
    rail: 'sector',
  },
  {
    key: 'knowledge',
    label: 'Knowledge Base',
    titleLabel: 'Knowledge Base Settings',
    group: 'manage',
    icon: SparklesIcon,
    visible: (s) => s.hasAdminAccess && s.isAdmin,
  },
  {
    key: 'industries',
    label: 'Industries',
    titleLabel: 'Industry Settings',
    group: 'configure',
    icon: BriefcaseIcon,
    visible: (s) => s.isElevated && s.isAdmin,
  },
  // ── Budget config — PROJECTS-sector, not agency-wide ──
  //
  // Markup, rate cards and channels are all budget configuration, and budgets
  // live in Projects: the hub, the intake form and the Ad Pacer are the only
  // things that read them. Surface-gating them the way Sending/SMS (Studio) and
  // Report Access (Reporting) already are keeps each sector's config on its own
  // surface instead of piling everything into one agency list.
  {
    key: 'markup',
    label: 'Markup',
    titleLabel: 'Default Markup',
    group: 'configure',
    icon: CalculatorIcon,
    // NO `isAdmin`, unlike the agency entries above. `isAdmin` means "Agency
    // View", which is retired — it's effectively never true in the app shell,
    // so gating on it would confine these two to the cog modal. Budget config
    // is meant to be reachable from the Projects settings panel itself, so the
    // gate is the sector plus an elevated role. `isElevated` is what protects
    // it: markup is margin, and being on Projects is not a permission.
    visible: (s) => s.surface === 'app' && s.isElevated,
    // "Move Markup from agency settings to projects settings" — surface-gating
    // alone left it in the modal whenever you were on Projects, which isn't
    // moving it. This is what actually takes it out of the agency rail.
    rail: 'sector',
  },
  {
    // Sits right after Markup: a channel's rate card is the link between the
    // two screens, and the pair is read together when either is set up.
    key: 'budget-channels',
    label: 'Channels',
    titleLabel: 'Budget Channels',
    group: 'configure',
    icon: Squares2X2Icon,
    // Same reasoning as Markup above.
    visible: (s) => s.surface === 'app' && s.isElevated,
    // Projects' own, not the agency's: nothing outside the budget hub, intake
    // and the pacer reads a channel.
    rail: 'sector',
  },
  {
    // What this tunes is the AD PACER's alert engine — account pace, budget
    // burn, flight thresholds. Every rule in it is about paced media, which is
    // Projects, so it sits with Projects rather than in the agency list where
    // it read as a platform-wide notification setting.
    key: 'alerts',
    label: 'Alerts',
    titleLabel: 'Alert Rules',
    group: 'configure',
    icon: ExclamationTriangleIcon,
    visible: (s) => s.surface === 'app' && s.isElevated,
    rail: 'sector',
  },
  // ── Co-op guidelines ──
  //
  // Manufacturer guideline documents, the rules transcribed from them, and the
  // sales-event marks.
  //
  // STUDIO's, because the Ad Generator is the only thing that reads it: every
  // consumer of a co-op pack or a sales event is under lib/ad-generator —
  // preflight, template approval, launch kits, OEM assets. The tab covers both
  // (its title is "OEM Guidelines & Sales Events").
  //
  // Still GLOBAL data — one library per make, shared by every account — which
  // is why it's a sector-level screen and not a per-account one. Offering it
  // inside a sub-account would imply the documents were that location's, which
  // is exactly backwards.
  //
  // Gated on industry as well: an agency with no manufacturer relationships has
  // no co-op to govern. The test is whether ANY account is OEM-flavoured, since
  // the library spans the whole fleet rather than one location.
  {
    key: 'coop-guidelines',
    label: 'Co-op Guidelines',
    titleLabel: 'OEM Guidelines & Sales Events',
    group: 'configure',
    icon: ShieldCheckIcon,
    visible: (s) => s.surface === 'studio' && s.hasAdminAccess && s.oemRelevant,
    rail: 'sector',
  },
  // Notifications are surface-scoped by category (NOTIFICATION_CATEGORY_SURFACE
  // maps each to studio or app), so Reporting has none to show — offering the
  // tab there would open an empty page.
  // Reporting's own: who sees which reports, per account. Reporting had no
  // settings of its own once Appearance moved to the modal.
  {
    key: 'client-reports',
    label: 'Client Reports',
    titleLabel: 'Client Report Access',
    group: 'configure',
    icon: ChartBarIcon,
    visible: (s) => s.surface === 'reporting' && s.hasAdminAccess,
    rail: 'sector',
  },
  {
    key: 'notifications',
    label: 'Notifications',
    titleLabel: 'Notification Settings',
    group: 'configure',
    // Sector rail: the categories it lists ARE this sector's, per
    // NOTIFICATION_CATEGORY_SURFACE.
    rail: 'sector',
    icon: BellIcon,
    visible: (s) => s.surface !== 'reporting',
  },
  {
    key: 'appearance',
    label: 'Appearance',
    titleLabel: 'Appearance Settings',
    group: 'configure',
    icon: SwatchIcon,
    // Agency rail, so it leaves every sector's panel. Personal, not a sector's:
    // theme, accent, font, density and the reduce-motion / reduce-transparency
    // preferences follow the USER across all three surfaces. Reachable from the
    // modal, and the user menu carries the light/dark toggle on its own.
    visible: () => true,
  },
];

// ── Sub-account settings sections ──────────────────────────────────────────

/**
 * The sub-account section registry lived here — a per-sector tab list for the
 * app-shell `settingsMode` variant of an account's settings, plus the two
 * helpers that grouped it under "Account Settings" / "<Sector> Settings".
 *
 * Deleted 2026-08-20 along with that variant. An account's tabs are the `TABS`
 * list in components/subaccount-detail, rendered identically by the Agency
 * Settings drill-in and the /settings/subaccounts/<key> route. One list, no
 * sector gating — an account's configuration doesn't change with the surface
 * you happened to open it from.
 */

/**
 * `general` was `company`. Old links (and the odd bookmark) still carry the old
 * key, so read it as the new one rather than falling through to the default.
 */
export function canonicalSubaccountSection(key: string | undefined): string | undefined {
  return key === 'company' ? 'general' : key;
}

/**
 * Every tab the registry defines, in order — derived, so it can't drift from
 * the table above. Used by the settings-panel parity test.
 */
export const SETTINGS_TAB_KEYS: SettingsTabKey[] = SETTINGS_REGISTRY.map((e) => e.key);

/** Every entry visible in a scope, both rails, in registry order. */
export function settingsTabsForScope(scope: SettingsScope): SettingsTab[] {
  return SETTINGS_REGISTRY.filter((e) => e.visible(scope)).map(
    ({ visible: _visible, ...tab }) => tab,
  );
}

/**
 * What a SECTOR's settings panel shows — its own config, nothing platform-wide.
 * The mirror of `agencySettingsNavForScope`, which takes the other half.
 */
export function sectorSettingsTabsForScope(scope: SettingsScope): SettingsTab[] {
  return settingsTabsForScope(scope).filter((t) => t.rail === 'sector');
}

export type AgencyNavGroup = {
  group: SettingsGroup;
  /** Heading rendered above the group in the rail. */
  label: string;
  items: (SettingsTab & { href: string })[];
};

const GROUP_LABELS: Record<SettingsGroup, string> = {
  manage: 'Manage',
  configure: 'Configure',
};

/**
 * The Agency Settings rail's destinations, grouped under Manage/Configure —
 * things you act on vs things you set once, which keeps the list scannable
 * rather than ten flat rows.
 *
 * Hrefs are absolute `/settings/<key>` — the browser-facing path on every host
 * (proxy.ts rewrites it to /reporting/settings/* and /app/settings/*), so the
 * same rail works unchanged on Studio, Reporting, and Projects.
 *
 * Returns only non-empty groups, so a role that can see nothing under a heading
 * doesn't get a dangling heading.
 */
export function agencySettingsNavForScope(scope: SettingsScope): AgencyNavGroup[] {
  // Sector-owned entries are deliberately absent: they render in their own
  // sector's settings panel, and putting them here too would mean the modal
  // titled "Agency Settings" offering Projects' budget config.
  const tabs = settingsTabsForScope(scope).filter((t) => t.rail !== 'sector');
  return (['manage', 'configure'] as const)
    .map((group) => ({
      group,
      label: GROUP_LABELS[group],
      items: tabs
        .filter((t) => t.group === group)
        .map((t) => ({ ...t, href: `/settings/${t.key}` })),
    }))
    .filter((g) => g.items.length > 0);
}
