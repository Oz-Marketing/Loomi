/**
 * THE permission registry — the single definition of what can be done in Loomi,
 * which sector role confers it, and which capabilities must be granted by hand.
 *
 * Client-safe: no prisma, no next-auth. Import from here in client components.
 * Server-side enforcement lives in `./require.ts`.
 *
 * See docs/permissions-architecture.md for the reasoning. The short version:
 * `User.role` used to answer three questions at once (what kind of principal,
 * which accounts, what actions), so 207 of 242 API guards collapsed into the
 * same "are you staff?" check. This file owns the third question only.
 *
 * Roles are CODE, not database rows. Only *assignments* are persisted
 * (UserSectorRole / UserCapabilityGrant). A UI for authoring custom roles is
 * deliberately out of scope — see "What this does not do" in the doc.
 */

// ── Axis 1: platform tier ──────────────────────────────────────────────────

/**
 * What kind of principal this is. Grants nothing on its own — it only bounds
 * which sectors the user may hold a role in.
 */
export type PlatformTier = 'developer' | 'staff' | 'client';

export const PLATFORM_TIERS: PlatformTier[] = ['developer', 'staff', 'client'];

// ── Axis 3: sectors and their roles ────────────────────────────────────────

export type Sector = 'agency' | 'studio' | 'reporting' | 'projects';

export const SECTORS: Sector[] = ['agency', 'studio', 'reporting', 'projects'];

/**
 * Reporting is the only sector a client tier may enter; Studio, Projects and
 * Agency are internal. That also makes Reporting the only sector where a
 * permission bug is externally visible, which is why Phase 3 rolls it out last.
 */
export const CLIENT_ALLOWED_SECTORS: Sector[] = ['reporting'];

/** One role per sector, most-privileged first. */
export const SECTOR_ROLES = {
  agency: ['owner', 'admin', 'user_manager'],
  studio: ['lead', 'producer', 'designer', 'viewer'],
  reporting: ['admin', 'analyst', 'client', 'viewer'],
  projects: ['admin', 'lead', 'member', 'requester'],
} as const;

export type SectorRole<S extends Sector = Sector> = (typeof SECTOR_ROLES)[S][number];

/** A fully-qualified role, e.g. `studio.designer`. The key used in assignments. */
export type SectorRoleRef = {
  [S in Sector]: `${S}.${(typeof SECTOR_ROLES)[S][number]}`;
}[Sector];

// ── Permissions ────────────────────────────────────────────────────────────

/**
 * `<sector>.<resource>.<action>`. Flat strings — deliberately not a hierarchy,
 * because wildcard matching is how permission systems become unauditable.
 *
 * `<sector>.access` is the coarse gate: no role in a sector means no `.access`,
 * which drops the sector from the nav and 403s its API.
 */
export const PERMISSIONS = [
  // ── Agency: platform configuration, the cog modal ──
  'agency.access',
  'agency.subaccounts.view',
  'agency.subaccounts.create',
  'agency.subaccounts.edit',
  'agency.subaccounts.archive',
  'agency.users.view',
  /** Send an onboarding invite. Distinct from `users.manage`, which creates and
   *  deletes the row — an admin can invite today but cannot create. */
  'agency.users.invite',
  'agency.users.manage',
  /** Upload/remove another user's avatar. Developer-only today. */
  'agency.users.avatar',
  'agency.teams.manage',
  'agency.knowledge.manage',
  'agency.contact_field_blueprints.manage',
  /** Industries, default markup, alert rules — the settings that reshape every account. */
  'agency.platform.configure',
  // Reading that platform config is merely staff-level; changing it is not.
  'agency.industries.view',
  'agency.markup.view',
  'agency.alerts.view',
  'agency.changelog.manage',
  'agency.coop.manage',

  // ── Studio: marketing production ──
  'studio.access',
  'studio.dashboard.view',
  'studio.campaigns.view',
  'studio.campaigns.edit',
  'studio.campaigns.publish',
  'studio.email.view',
  'studio.email.edit',
  'studio.templates.view',
  'studio.templates.edit',
  'studio.templates.publish',
  'studio.adgen.view',
  'studio.adgen.edit',
  'studio.adgen.generate',
  'studio.adgen.launch',
  'studio.assets.view',
  'studio.assets.upload',
  'studio.assets.manage',
  'studio.flows.view',
  'studio.flows.edit',
  'studio.flows.activate',
  'studio.forms.view',
  'studio.forms.edit',
  'studio.forms.deploy',
  'studio.landing_pages.view',
  'studio.landing_pages.edit',
  'studio.landing_pages.publish',
  'studio.blocks.view',
  'studio.blocks.edit',
  'studio.contacts.view',
  'studio.contacts.edit',
  'studio.contacts.import',
  'studio.segments.view',
  'studio.segments.edit',
  // Custom contact fields and publishing domains are Studio settings — they
  // exist only because Studio shapes contact records and publishes pages.
  'studio.contact_fields.view',
  'studio.contact_fields.manage',
  'studio.domains.view',
  'studio.domains.manage',

  // ── Reporting ──
  'reporting.access',
  /** The standard report set. Narrowed per account for client/viewer roles. */
  'reporting.report.view',
  'reporting.budget.view',
  'reporting.executive.view',
  'reporting.configure',

  // ── Projects ──
  'projects.access',
  'projects.initiative.view',
  'projects.initiative.create',
  'projects.initiative.edit',
  'projects.task.view',
  'projects.task.create',
  'projects.task.edit',
  /** Assign work to anyone, not just within teams you lead. */
  'projects.task.assign_any',
  'projects.budget.view',
  'projects.budget.edit',
  'projects.pacing.view',
  'projects.pacing.edit',
  'projects.teams.manage',

  // ── Sensitive capabilities ──
  //
  // Cross-sector, never conferred by a sector role, granted per user and
  // audit-logged. These are the actions where "admin can do everything" is
  // actually dangerous: irreversible outbound sends, bulk PII, money, and
  // credentials.
  'blast.send',
  'contacts.pii.export',
  'finance.spend.view',
  'finance.markup.manage',
  'integrations.credentials.manage',
  'user.impersonate',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * The capabilities that a sector role can never confer. Assigning one of these
 * requires an explicit UserCapabilityGrant.
 */
export const SENSITIVE_CAPABILITIES: Permission[] = [
  'blast.send',
  'contacts.pii.export',
  'finance.spend.view',
  'finance.markup.manage',
  'integrations.credentials.manage',
  'user.impersonate',
];

export function isSensitiveCapability(permission: Permission): boolean {
  return SENSITIVE_CAPABILITIES.includes(permission);
}

// ── Role → permission map ──────────────────────────────────────────────────

/**
 * What each sector role confers. Written out in full rather than by inheritance
 * so that reading one row tells you everything that role can do — the property
 * that makes a permission table auditable.
 */
export const ROLE_PERMISSIONS: Record<SectorRoleRef, readonly Permission[]> = {
  // ── Agency ──
  'agency.owner': [
    'agency.access',
    'agency.subaccounts.view',
    'agency.subaccounts.create',
    'agency.subaccounts.edit',
    'agency.subaccounts.archive',
    'agency.users.view',
    'agency.users.invite',
    'agency.users.manage',
    'agency.teams.manage',
    'agency.knowledge.manage',
    'agency.contact_field_blueprints.manage',
    'agency.platform.configure',
    'agency.industries.view',
    'agency.markup.view',
    'agency.alerts.view',
    'agency.changelog.manage',
    'agency.coop.manage',
  ],
  // Everything the owner has except `platform.configure` — the settings that
  // reshape every account at once (industries, markup, alert rules) — and
  // except `users.manage`.
  //
  // Creating and deleting users is ELEVATED today (`POST /api/users` uses
  // ELEVATED_ROLES), so granting it here would have widened every existing
  // admin the moment enforcement flipped. Widening is the one direction this
  // migration must never do by accident. User administration is therefore
  // `agency.owner` or the dedicated `agency.user_manager`.
  'agency.admin': [
    'agency.access',
    'agency.subaccounts.view',
    'agency.subaccounts.edit',
    'agency.users.view',
    'agency.users.invite',
    'agency.teams.manage',
    'agency.knowledge.manage',
    'agency.contact_field_blueprints.manage',
    'agency.industries.view',
    'agency.markup.view',
    'agency.alerts.view',
    'agency.changelog.manage',
    'agency.coop.manage',
  ],
  'agency.user_manager': [
    'agency.access',
    'agency.users.view',
    'agency.users.invite',
    'agency.users.manage',
  ],

  // ── Studio ──
  'studio.lead': [
    'studio.access',
    'studio.dashboard.view',
    'studio.campaigns.view',
    'studio.campaigns.edit',
    'studio.campaigns.publish',
    'studio.email.view',
    'studio.email.edit',
    'studio.templates.view',
    'studio.templates.edit',
    'studio.templates.publish',
    'studio.adgen.view',
    'studio.adgen.edit',
    'studio.adgen.generate',
    'studio.adgen.launch',
    'studio.assets.view',
    'studio.assets.upload',
    'studio.assets.manage',
    'studio.flows.view',
    'studio.flows.edit',
    'studio.flows.activate',
    'studio.forms.view',
    'studio.forms.edit',
    'studio.forms.deploy',
    'studio.landing_pages.view',
    'studio.landing_pages.edit',
    'studio.landing_pages.publish',
    'studio.blocks.view',
    'studio.blocks.edit',
    'studio.contacts.view',
    'studio.contacts.edit',
    'studio.contacts.import',
    'studio.segments.view',
    'studio.segments.edit',
    'studio.contact_fields.view',
    'studio.contact_fields.manage',
    'studio.domains.view',
    'studio.domains.manage',
  ],
  // Builds everything; cannot publish templates, activate flows, or launch ads.
  // Note `blast.send` is absent here AND from studio.lead — sending is a
  // sensitive capability for everyone.
  'studio.producer': [
    'studio.access',
    'studio.dashboard.view',
    'studio.campaigns.view',
    'studio.campaigns.edit',
    'studio.email.view',
    'studio.email.edit',
    'studio.templates.view',
    'studio.templates.edit',
    'studio.adgen.view',
    'studio.adgen.edit',
    'studio.adgen.generate',
    'studio.assets.view',
    'studio.assets.upload',
    'studio.flows.view',
    'studio.flows.edit',
    'studio.forms.view',
    'studio.forms.edit',
    'studio.landing_pages.view',
    'studio.landing_pages.edit',
    'studio.blocks.edit',
    'studio.contacts.view',
    'studio.contacts.edit',
    'studio.segments.view',
  'studio.segments.edit',
  // Custom contact fields and publishing domains are Studio settings — they
  // exist only because Studio shapes contact records and publishes pages.
  'studio.contact_fields.view',
  'studio.contact_fields.manage',
  'studio.domains.view',
  'studio.domains.manage',
  ],
  // The grant the design team should always have had: creative surfaces only,
  // nothing that reaches a contact or a live page.
  'studio.designer': [
    'studio.access',
    'studio.dashboard.view',
    'studio.templates.view',
    'studio.templates.edit',
    'studio.adgen.view',
    'studio.adgen.edit',
    'studio.adgen.generate',
    'studio.assets.view',
    'studio.assets.upload',
    'studio.assets.manage',
    'studio.blocks.view',
    'studio.blocks.edit',
  ],
  'studio.viewer': [
    'studio.access',
    'studio.dashboard.view',
    'studio.campaigns.view',
    'studio.email.view',
    'studio.templates.view',
    'studio.adgen.view',
    'studio.assets.view',
    'studio.flows.view',
    'studio.forms.view',
    'studio.landing_pages.view',
    'studio.blocks.view',
    'studio.contacts.view',
    'studio.segments.view',
    'studio.contact_fields.view',
    'studio.domains.view',
  ],

  // ── Reporting ──
  'reporting.admin': [
    'reporting.access',
    'reporting.report.view',
    'reporting.budget.view',
    'reporting.executive.view',
    'reporting.configure',
  ],
  'reporting.analyst': [
    'reporting.access',
    'reporting.report.view',
    'reporting.budget.view',
    'reporting.executive.view',
  ],
  // The client-facing set. No Budget, no Executive, and `finance.spend.view` is
  // a sensitive capability they can never be granted, so cost and markup
  // figures stay internal.
  'reporting.client': ['reporting.access', 'reporting.report.view'],
  'reporting.viewer': ['reporting.access', 'reporting.report.view'],

  // ── Projects ──
  'projects.admin': [
    'projects.access',
    'projects.initiative.view',
    'projects.initiative.create',
    'projects.initiative.edit',
    'projects.task.view',
    'projects.task.create',
    'projects.task.edit',
    'projects.task.assign_any',
    'projects.budget.view',
    'projects.budget.edit',
    'projects.pacing.view',
    'projects.pacing.edit',
    'projects.teams.manage',
  ],
  // Scoped to teams they lead. That "which teams" question is answered by the
  // existing TeamMembership.role = 'lead' rows, not duplicated here.
  'projects.lead': [
    'projects.access',
    'projects.initiative.view',
    'projects.initiative.create',
    'projects.initiative.edit',
    'projects.task.view',
    'projects.task.create',
    'projects.task.edit',
    'projects.pacing.view',
  ],
  'projects.member': [
    'projects.access',
    'projects.initiative.view',
    'projects.task.view',
    'projects.task.create',
    'projects.task.edit',
  ],
  'projects.requester': ['projects.access', 'projects.task.create', 'projects.task.view'],
};

// ── Assignment validity ────────────────────────────────────────────────────

/** Split `studio.designer` into its parts. */
export function parseSectorRoleRef(
  ref: string,
): { sector: Sector; role: string } | null {
  const dot = ref.indexOf('.');
  if (dot < 1) return null;
  const sector = ref.slice(0, dot) as Sector;
  const role = ref.slice(dot + 1);
  if (!SECTORS.includes(sector)) return null;
  if (!(SECTOR_ROLES[sector] as readonly string[]).includes(role)) return null;
  return { sector, role };
}

export function sectorRoleRef(sector: Sector, role: string): SectorRoleRef {
  return `${sector}.${role}` as SectorRoleRef;
}

/**
 * Whether a tier may hold a role in a sector at all. The one invariant that
 * keeps "client with a stray Studio grant" from becoming a state we have to
 * reason about — enforced here so the API and the assignment UI can't disagree.
 */
export function canTierHoldSector(tier: PlatformTier, sector: Sector): boolean {
  if (tier === 'developer') return true;
  if (tier === 'staff') return true;
  return CLIENT_ALLOWED_SECTORS.includes(sector);
}

/** Which sectors this tier may be assigned roles in. */
export function assignableSectorsForTier(tier: PlatformTier): Sector[] {
  return SECTORS.filter((s) => canTierHoldSector(tier, s));
}

/**
 * The only roles a client tier may hold.
 *
 * Sector alone is not a tight enough bound: `reporting.analyst` and
 * `reporting.admin` confer `reporting.budget.view` and
 * `reporting.executive.view`, so allowing a client any Reporting role would put
 * a dealer one dropdown away from internal budget figures. Clients get the
 * client-facing report set, or a narrower one — nothing else.
 */
export const CLIENT_ALLOWED_SECTOR_ROLES: SectorRoleRef[] = [
  'reporting.client',
  'reporting.viewer',
];

/** Whether a tier may hold this specific role, not merely this sector. */
export function canTierHoldRole(
  tier: PlatformTier,
  sector: Sector,
  role: string,
): boolean {
  if (!canTierHoldSector(tier, sector)) return false;
  if (tier === 'developer' || tier === 'staff') return true;
  return CLIENT_ALLOWED_SECTOR_ROLES.includes(sectorRoleRef(sector, role));
}

/** The roles this tier may be assigned within a sector, in registry order. */
export function assignableRolesForTier(tier: PlatformTier, sector: Sector): string[] {
  return (SECTOR_ROLES[sector] as readonly string[]).filter((role) =>
    canTierHoldRole(tier, sector, role),
  );
}

// ── Resolution ─────────────────────────────────────────────────────────────

export type ScopeMode = 'all' | 'listed';

/** Everything needed to answer "can this principal do X here". */
export type PermissionSubject = {
  tier: PlatformTier;
  /** Fully-qualified refs, e.g. `['studio.designer', 'reporting.analyst']`. */
  sectorRoles: SectorRoleRef[];
  /** Sensitive capabilities granted everywhere. */
  allows?: Permission[];
  /** Explicit denies. Always win, including over a sector role. */
  denies?: Permission[];
  /**
   * Capabilities granted only on specific accounts, keyed by account key.
   *
   * Kept apart from `allows` because merging them would silently widen a grant
   * deliberately limited to one rooftop into a grant on every account the user
   * can reach. They apply only when `can()` is given the matching accountKey.
   */
  scopedAllows?: Record<string, Permission[]>;
  scopedDenies?: Record<string, Permission[]>;
  scopeMode: ScopeMode;
  /** Meaningful only when `scopeMode === 'listed'`. Already org-expanded. */
  accountKeys: string[];
};

/**
 * The permission set a subject holds, ignoring account scope.
 *
 * `developer` is break-glass: it resolves to every permission including the
 * sensitive ones. Callers that care should audit-log the bypass (see
 * `require.ts`), which is why this returns the full set rather than a
 * short-circuit boolean — the caller still needs to know it was a bypass.
 */
export function resolvePermissions(
  subject: PermissionSubject,
  accountKey?: string,
): Set<Permission> {
  if (subject.tier === 'developer') {
    return new Set(PERMISSIONS);
  }

  const granted = new Set<Permission>();

  for (const ref of subject.sectorRoles) {
    const parsed = parseSectorRoleRef(ref);
    // Drop a role the tier may not hold, so a stale row from before an account
    // was downgraded to `client` can't keep conferring Studio access — or, in
    // the subtler case, keep an ex-staff Reporting Analyst seeing Budget.
    if (!parsed || !canTierHoldRole(subject.tier, parsed.sector, parsed.role)) continue;
    for (const permission of ROLE_PERMISSIONS[ref] ?? []) {
      granted.add(permission);
    }
  }

  for (const permission of subject.allows ?? []) {
    granted.add(permission);
  }

  // Account-scoped grants apply only to the account being asked about. With no
  // accountKey the question is "can they do this anywhere", and a grant tied to
  // one rooftop is not an answer to that — so they're skipped rather than
  // counted, erring toward under-granting.
  if (accountKey) {
    for (const permission of subject.scopedAllows?.[accountKey] ?? []) {
      granted.add(permission);
    }
  }

  // Denies last — they beat both role grants and explicit allows.
  for (const permission of subject.denies ?? []) {
    granted.delete(permission);
  }
  if (accountKey) {
    for (const permission of subject.scopedDenies?.[accountKey] ?? []) {
      granted.delete(permission);
    }
  }

  return granted;
}

/** True when the subject's account scope admits `accountKey`. */
export function scopeAllows(subject: PermissionSubject, accountKey?: string): boolean {
  if (subject.tier === 'developer') return true;
  if (subject.scopeMode === 'all') return true;
  // `listed` with an empty array means NOTHING — the ambiguity that
  // `scopeMode` exists to retire. See docs/permissions-architecture.md.
  if (!accountKey) return subject.accountKeys.length > 0;
  return subject.accountKeys.includes(accountKey);
}

/**
 * The whole question in one call: does this subject hold `permission`, and may
 * they exercise it against `accountKey`?
 *
 * Omit `accountKey` for account-agnostic checks (e.g. `agency.users.manage`);
 * the subject must still have some scope to act in.
 */
export function can(
  subject: PermissionSubject,
  permission: Permission,
  accountKey?: string,
): boolean {
  if (!scopeAllows(subject, accountKey)) return false;
  return resolvePermissions(subject, accountKey).has(permission);
}

/** Which sectors the subject can enter, derived from `<sector>.access`. */
export function accessibleSectors(subject: PermissionSubject): Sector[] {
  const granted = resolvePermissions(subject);
  return SECTORS.filter((s) => granted.has(`${s}.access` as Permission));
}

// ── Display ────────────────────────────────────────────────────────────────

const SECTOR_LABELS: Record<Sector, string> = {
  agency: 'Agency',
  studio: 'Studio',
  reporting: 'Reporting',
  projects: 'Projects',
};

export function sectorLabel(sector: Sector): string {
  return SECTOR_LABELS[sector];
}

/** `user_manager` → `User Manager`. */
export function sectorRoleLabel(role: string): string {
  return role
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
