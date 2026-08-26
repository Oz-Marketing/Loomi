import {
  BuildingStorefrontIcon,
  ExclamationTriangleIcon,
  IdentificationIcon,
  ChartBarIcon,
  UsersIcon,
  UserGroupIcon,
  SwatchIcon,
  SparklesIcon,
  BellIcon,
  GlobeAltIcon,
  TagIcon,
  Squares2X2Icon,
  BriefcaseIcon,
  CalculatorIcon,
  PuzzlePieceIcon,
  ShieldCheckIcon,
  PaperAirplaneIcon,
  RectangleGroupIcon,
  DocumentTextIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';

export type SettingsTabKey =
  | 'subaccounts'
  | 'subaccount'
  | 'users'
  | 'client-users'
  | 'teams'
  | 'agents'
  | 'industries'
  | 'markup'
  | 'budget-channels'
  | 'alerts'
  | 'coop-guidelines'
  | 'ad-sizes'
  | 'ad-disclaimers'
  | 'ad-oem-rules'
  | 'ad-automation'
  | 'contact-fields'
  | 'contact-field-blueprints'
  | 'integrations'
  | 'client-reports'
  | 'notifications'
  | 'reporting-notifications'
  | 'reporting-alerts'
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
 * 'agency' (the default) is platform configuration — the cog's modal.
 * 'sector' is a sector's own operational config: it appears in that sector's
 * settings panel and NEVER in the modal. Pair it with a `surface` check in
 * `visible`, which is what says which sector.
 *
 * Agency Settings is meant to be platform-wide; anything that drives one
 * sector belongs to that sector. Without this, a surface-gated entry showed up
 * inside Agency Settings whenever you happened to be on its surface.
 */
export type SettingsRail = 'agency' | 'sector';

export type SettingsTab = {
  key: SettingsTabKey;
  label: string;
  /** Defaults to 'agency' when absent. */
  rail?: SettingsRail;
  /**
   * Scoped but not built. The rail renders it disabled and never links to it,
   * so a sector's settings can say what's coming instead of looking finished.
   * A `soon` entry has no panel — see settings-panel.
   */
  soon?: boolean;
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
    // Agency rail only. It used to also appear for a group account, which put
    // the account directory — and the drill-in to every account's settings —
    // inside a sector's settings panel.
    visible: (s) => s.hasAdminAccess && s.isAdmin,
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
  // The CLIENT roster — every client login across every account, with the
  // account it belongs to on the row. A separate tab from Users because they
  // aren't one population: an agency user holds sector roles, capabilities and
  // team membership; a client holds an account and a report set. The old home
  // was each account's own Users tab, i.e. 18 rooftops to answer "who can log
  // in".
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
    // Blueprints define the shape of a CONTACT record, and contacts are
    // Studio's. The library is global, which is what makes it sector-level
    // rather than per-account.
    key: 'contact-field-blueprints',
    label: 'Field Blueprints',
    titleLabel: 'Contact Field Blueprints',
    group: 'manage',
    icon: Squares2X2Icon,
    visible: (s) => s.surface === 'studio' && s.hasAdminAccess,
    rail: 'sector',
  },
  {
    key: 'agents',
    label: 'Agents',
    titleLabel: 'AI Agents',
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
    // Sector rail, and no `isAdmin`: that means the retired "Agency View" and is
    // effectively never true in the app shell, so gating on it confined this to
    // the cog modal. `isElevated` is what protects it — markup is margin, and
    // being on a surface is not a permission.
    visible: (s) => s.surface === 'app' && s.isElevated,
    rail: 'sector',
  },
  {
    // Right after Markup: a channel's rate card is the link between the two,
    // and the pair is read together when either is set up.
    key: 'budget-channels',
    label: 'Channels',
    titleLabel: 'Budget Channels',
    group: 'configure',
    icon: Squares2X2Icon,
    visible: (s) => s.surface === 'app' && s.isElevated,
    rail: 'sector',
  },
  {
    key: 'alerts',
    label: 'Alerts',
    titleLabel: 'Alert Rules',
    group: 'configure',
    // What this tunes is the AD PACER's alert engine — account pace, budget
    // burn, flight thresholds. Every rule is about paced media, which is
    // Projects, so it sits with Projects rather than reading as a platform-wide
    // notification setting.
    icon: ExclamationTriangleIcon,
    visible: (s) => s.surface === 'app' && s.isElevated,
    rail: 'sector',
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
    // STUDIO's: every consumer of a co-op pack or a sales event is under
    // lib/ad-generator — preflight, template approval, launch kits, OEM assets.
    // Still global data (one library per make), which is why it's sector-level
    // and not per-account.
    visible: (s) => s.surface === 'studio' && s.hasAdminAccess && s.oemRelevant,
    rail: 'sector',
  },
  // ── Ad Generator config ──
  //
  // The four screens that used to hang off a cog on the Ad Generator's own
  // header. Every one of them is sector-wide setup the tool READS — the size
  // library it designs against, the disclaimer text and OEM field rules an
  // export must satisfy, and the unattended pipeline's watch scope — so they
  // belong in Studio's settings rail rather than behind a cog on one page. The
  // old /ad-generator/* routes redirect here.
  //
  // Not gated on `oemRelevant` like the co-op library above: the generator
  // itself isn't OEM-only (custom offer kinds ship with it), and a make-less
  // global disclaimer is exactly what a non-OEM account uses.
  {
    key: 'ad-sizes',
    label: 'Ad Sizes',
    titleLabel: 'Ad Sizes',
    group: 'configure',
    icon: RectangleGroupIcon,
    visible: (s) => s.surface === 'studio' && s.hasAdminAccess,
    rail: 'sector',
  },
  {
    key: 'ad-disclaimers',
    label: 'Disclaimers',
    titleLabel: 'Disclaimer Templates',
    group: 'configure',
    icon: DocumentTextIcon,
    visible: (s) => s.surface === 'studio' && s.hasAdminAccess,
    rail: 'sector',
  },
  {
    // Directly after Disclaimers: the two were sibling tabs on the old page and
    // are still read as a pair — what an ad must SAY, and what it must CARRY.
    key: 'ad-oem-rules',
    label: 'OEM Rules',
    titleLabel: 'OEM Compliance Rules',
    group: 'configure',
    icon: ShieldCheckIcon,
    visible: (s) => s.surface === 'studio' && s.hasAdminAccess,
    rail: 'sector',
  },
  {
    key: 'ad-automation',
    label: 'Ad Automation',
    titleLabel: 'Ad Automation',
    group: 'configure',
    icon: BoltIcon,
    visible: (s) => s.surface === 'studio' && s.hasAdminAccess,
    rail: 'sector',
  },
  // Notifications are surface-scoped by category (NOTIFICATION_CATEGORY_SURFACE
  // maps each to studio or app), so Reporting has none to show — offering the
  // tab there would open an empty page.
  // Reporting's own sector screen: who sees which reports, across accounts.
  // The per-account version is a section on the account; this is the same panel
  // with an account picker, so "who sees what" is one control rather than a
  // trip through Agency Settings per rooftop.
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
    icon: BellIcon,
    // Sector rail: the categories it lists ARE this sector's, per
    // NOTIFICATION_CATEGORY_SURFACE. Reporting has none of its own yet — see
    // the `soon` entries below.
    visible: (s) => s.surface !== 'reporting',
    rail: 'sector',
  },
  // ── Reporting: scoped, not built ──
  //
  // Rendered as disabled rows so the sector's settings say what's coming
  // rather than looking finished. Neither has a panel, and `soon` is what
  // stops the rail linking to one.
  //
  // They are genuinely different from their Projects namesakes: Projects'
  // alerts are about PACING (thresholds on live spend), where Reporting's
  // would be about results and data health — "leads down 40% month over
  // month", "GA4 stopped reporting three days ago". The second is the
  // valuable half, because a silent data-source failure currently shows a
  // client an empty page and nobody finds out.
  {
    key: 'reporting-notifications',
    label: 'Notifications',
    titleLabel: 'Reporting Notifications',
    group: 'configure',
    icon: BellIcon,
    visible: (s) => s.surface === 'reporting' && s.hasAdminAccess,
    rail: 'sector',
    soon: true,
  },
  {
    key: 'reporting-alerts',
    label: 'Alerts',
    titleLabel: 'Reporting Alerts',
    group: 'configure',
    icon: ExclamationTriangleIcon,
    visible: (s) => s.surface === 'reporting' && s.hasAdminAccess,
    rail: 'sector',
    soon: true,
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
  | 'email-texts'
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
  // ── No 'account' group any more ──
  //
  // General, Users, Branding and Integrations used to head this rail under an
  // "Account Settings" heading, which put an ACCOUNT's own config inside a
  // SECTOR's settings panel. They live on the account now — Agency Settings →
  // Accounts → the account — where the drill-in's own TABS render the same
  // screens (see subaccount-detail). The per-account user list is covered by
  // the agency-level Users and Clients tabs, which answer "who can log in"
  // across every rooftop instead of one at a time.
  //
  // What's left here is only what a SECTOR adds to an account.
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

  // Everything about sending email and text: identity, the compliance
  // footer, and the suppression list.
  //
  // ONE nav entry, tabs inside. This started as four sibling sections and
  // that read as four unrelated settings pages — Email/Email Footer/SMS/
  // Suppressions are one job. The sub-tabs live in email-texts-tab.tsx and
  // are addressable via ?section=, so a "fix this in settings" link can
  // still deep-link to the right one.
  //
  // Studio-only: Reporting and Projects don't send anything.
  {
    key: 'email-texts',
    label: 'Email & Texts',
    group: 'sector',
    icon: PaperAirplaneIcon,
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
  // Appearance is NOT here: theme, accent, font, density and the reduce-motion
  // preferences follow the USER across all three surfaces, so it isn't a
  // sector's setting and certainly not an account's. It lives in Agency
  // Settings, and the user menu carries the light/dark toggle on its own.
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
    account: 'Account Settings',
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

/**
 * Every tab the registry defines, in order — derived, so it can't drift from
 * the table above. Used by the settings-panel parity test.
 */
export const SETTINGS_TAB_KEYS: SettingsTabKey[] = SETTINGS_REGISTRY.map((e) => e.key);

/**
 * What a SECTOR's settings panel shows — its own config, nothing platform-wide
 * and nothing belonging to a single account.
 *
 * The mirror of `agencySettingsNavForScope`, which takes the other half. This is
 * the list the settings rail renders on every surface: an ACCOUNT's own settings
 * are reached through Agency Settings → Accounts → the account, so they are
 * deliberately absent here. Without this split the rail showed the account's
 * sections instead, and a sector's own screens — Markup, Channels, Alerts,
 * Client Reports — were unreachable from the surface that owns them.
 */
export function sectorSettingsTabsForScope(scope: SettingsScope): SettingsTab[] {
  return settingsTabsForScope(scope).filter((t) => t.rail === 'sector');
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
  // Sector-owned entries are deliberately absent: they render in their own
  // sector's settings panel, and listing them here too would mean the modal
  // titled "Agency Settings" offering one sector's operational config.
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
