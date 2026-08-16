import {
  BuildingStorefrontIcon,
  ChartBarIcon,
  UsersIcon,
  UserGroupIcon,
  SwatchIcon,
  SparklesIcon,
  BellIcon,
  BellAlertIcon,
  GlobeAltIcon,
  PaintBrushIcon,
  TagIcon,
  Squares2X2Icon,
  BriefcaseIcon,
  CalculatorIcon,
  PuzzlePieceIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';

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

export type SettingsTab = {
  key: SettingsTabKey;
  label: string;
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
    label: 'Sub-Accounts',
    titleLabel: 'Sub-Account Settings',
    group: 'manage',
    icon: BuildingStorefrontIcon,
    visible: (s) => s.hasAdminAccess && (s.isAdmin || s.isGroup),
  },
  // ── Sub-account tier ──
  {
    key: 'subaccount',
    label: 'General',
    titleLabel: 'General Settings',
    group: 'manage',
    icon: BuildingStorefrontIcon,
    visible: (s) => s.isAccount,
  },
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
  {
    key: 'teams',
    label: 'Teams',
    titleLabel: 'Teams',
    group: 'manage',
    icon: UserGroupIcon,
    visible: (s) => s.hasAdminAccess && s.isAdmin,
  },
  {
    key: 'integrations',
    label: 'Integrations',
    titleLabel: 'Integrations',
    group: 'manage',
    icon: PuzzlePieceIcon,
    visible: (s) => s.hasAdminAccess && s.isAccount,
  },
  // Custom Fields are a Studio concern — they shape contact records, which is
  // Studio's job. Not offered on Reporting or Projects.
  {
    key: 'contact-fields',
    label: 'Custom Fields',
    titleLabel: 'Contact Custom Fields',
    group: 'manage',
    icon: TagIcon,
    visible: (s) => s.hasAdminAccess && s.isAccount && s.surface === 'studio',
  },
  {
    key: 'contact-field-blueprints',
    label: 'Field Blueprints',
    titleLabel: 'Contact Field Blueprints',
    group: 'manage',
    icon: Squares2X2Icon,
    visible: (s) => s.hasAdminAccess && s.isAdmin,
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
  {
    key: 'markup',
    label: 'Markup',
    titleLabel: 'Default Markup',
    group: 'configure',
    icon: CalculatorIcon,
    visible: (s) => s.isElevated && s.isAdmin,
  },
  {
    key: 'alerts',
    label: 'Alerts',
    titleLabel: 'Alert Rules',
    group: 'configure',
    icon: BellAlertIcon,
    visible: (s) => s.isElevated && s.isAdmin,
  },
  // ── Co-op guidelines ──
  //
  // Manufacturer guideline documents, the rules transcribed from them, and the
  // sales-event marks.
  //
  // AGENCY VIEW ONLY, because the data is global — one library per make, shared
  // by every sub-account. Offering it inside a sub-account would imply the
  // documents were that location's, which is exactly backwards.
  //
  // Gated on industry as well: an agency with no manufacturer relationships has
  // no co-op to govern. The test is whether ANY account is OEM-flavoured, since
  // in Agency View the library spans the whole fleet rather than one location.
  {
    key: 'coop-guidelines',
    label: 'Co-op Guidelines',
    titleLabel: 'OEM Guidelines & Sales Events',
    group: 'configure',
    icon: ShieldCheckIcon,
    visible: (s) => s.hasAdminAccess && s.isAdmin && s.oemRelevant,
  },
  // Notifications are surface-scoped by category (NOTIFICATION_CATEGORY_SURFACE
  // maps each to studio or app), so Reporting has none to show — offering the
  // tab there would open an empty page.
  {
    key: 'notifications',
    label: 'Notifications',
    titleLabel: 'Notification Settings',
    group: 'configure',
    icon: BellIcon,
    visible: (s) => s.surface !== 'reporting',
  },
  {
    key: 'appearance',
    label: 'Appearance',
    titleLabel: 'Appearance Settings',
    group: 'configure',
    icon: SwatchIcon,
    visible: () => true,
  },
];

// ── Sub-account settings sections ──────────────────────────────────────────

export type SubaccountSectionKey =
  | 'general'
  | 'users'
  | 'branding'
  | 'integrations'
  | 'domains'
  | 'contact-fields'
  | 'notifications'
  | 'reports'
  | 'appearance';

/**
 * Which heading a section sits under.
 *
 *   • `account` — config stored on, or about, the sub-account itself. Identical
 *     in meaning wherever you open it.
 *   • `sector`  — what this sector adds, plus how it looks to you.
 */
export type SubaccountGroup = 'account' | 'sector';

export type SubaccountSection = {
  key: SubaccountSectionKey;
  label: string;
  group: SubaccountGroup;
  icon: React.ComponentType<{ className?: string }>;
};

type SubaccountEntry = SubaccountSection & {
  visible: (s: SettingsScope) => boolean;
};

/**
 * A sub-account's own settings, shared by every sector.
 *
 * The shape is CORE + SECTOR: General, Users, Branding, Integrations and
 * Appearance are the same wherever you are, and each sector adds only what it
 * owns. A Reporting user has no business configuring contact custom fields, and
 * Projects has no domains to point anywhere.
 *
 * This used to be two hand-maintained copies — SUBACCOUNT_SETTINGS_SECTIONS in
 * settings-nav.tsx and SETTINGS_TABS in subaccount-detail.tsx, the former
 * carrying a comment saying it "mirrors" the latter. Both render from here now.
 */
const SUBACCOUNT_REGISTRY: SubaccountEntry[] = [
  // ── Sub-Account Settings — the account's own config ──
  { key: 'general', label: 'General', group: 'account', icon: BuildingStorefrontIcon, visible: () => true },
  // Scoped to this sub-account, and to its children when it's an organization.
  { key: 'users', label: 'Users', group: 'account', icon: UsersIcon, visible: () => true },
  { key: 'branding', label: 'Branding', group: 'account', icon: PaintBrushIcon, visible: () => true },
  { key: 'integrations', label: 'Integrations', group: 'account', icon: PuzzlePieceIcon, visible: () => true },
  // ── <Sector> Settings — what this sector adds, and your view of it ──
  //
  // Domains and Custom Fields are Studio's, not the account's: they exist only
  // because Studio publishes pages and shapes contact records.
  {
    key: 'domains',
    label: 'Domains',
    group: 'sector',
    icon: GlobeAltIcon,
    visible: (s) => s.surface === 'studio',
  },
  {
    key: 'contact-fields',
    label: 'Custom Fields',
    group: 'sector',
    icon: TagIcon,
    visible: (s) => s.surface === 'studio',
  },

  // Which reports this sub-account's CLIENT users see. Reporting-only, and
  // staff-only to reach: it needs `reporting.configure`, which no client role
  // carries.
  {
    key: 'reports',
    label: 'Reports',
    group: 'sector',
    icon: ChartBarIcon,
    visible: (s) => s.surface === 'reporting' && s.hasAdminAccess,
  },

  // Notifications exist wherever a notification category does — studio and app,
  // never reporting. See NOTIFICATION_CATEGORY_SURFACE.
  {
    key: 'notifications',
    label: 'Notifications',
    group: 'sector',
    icon: BellIcon,
    visible: (s) => s.surface !== 'reporting',
  },
  { key: 'appearance', label: 'Appearance', group: 'sector', icon: SwatchIcon, visible: () => true },
];

/** The sub-account sections visible in a given scope, in registry order. */
export function subaccountSectionsForScope(scope: SettingsScope): SubaccountSection[] {
  return SUBACCOUNT_REGISTRY.filter((e) => e.visible(scope)).map(
    ({ visible: _visible, ...section }) => section,
  );
}

/** What the sector group is called on each surface. */
export function sectorGroupLabel(surface: SettingsScope['surface']): string {
  switch (surface) {
    case 'reporting':
      return 'Reporting Settings';
    case 'app':
      return 'Projects Settings';
    default:
      return 'Studio Settings';
  }
}

export type SubaccountSectionGroup = {
  group: SubaccountGroup;
  label: string;
  items: SubaccountSection[];
};

/**
 * The sub-account sections split into their two headings — the account's own
 * config, then what this sector adds. Empty groups are dropped so a sector with
 * nothing of its own doesn't get a dangling heading.
 */
export function subaccountSectionGroupsForScope(
  scope: SettingsScope,
): SubaccountSectionGroup[] {
  const sections = subaccountSectionsForScope(scope);
  const labels: Record<SubaccountGroup, string> = {
    account: 'Sub-Account Settings',
    sector: sectorGroupLabel(scope.surface),
  };
  return (['account', 'sector'] as const)
    .map((group) => ({
      group,
      label: labels[group],
      items: sections.filter((s) => s.group === group),
    }))
    .filter((g) => g.items.length > 0);
}

/**
 * `general` was `company`. Old links (and the odd bookmark) still carry the old
 * key, so read it as the new one rather than falling through to the default.
 */
export function canonicalSubaccountSection(key: string | undefined): string | undefined {
  return key === 'company' ? 'general' : key;
}

/** The settings entries visible in a given scope, in registry order. */
export function settingsTabsForScope(scope: SettingsScope): SettingsTab[] {
  return SETTINGS_REGISTRY.filter((e) => e.visible(scope)).map(
    ({ visible: _visible, ...tab }) => tab,
  );
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
  const tabs = settingsTabsForScope(scope);
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
