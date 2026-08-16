/**
 * The bridge between today's single `User.role` string and the permission
 * registry. Client-safe.
 *
 * Two jobs, both temporary by design:
 *
 *   1. `LEGACY_GUARD` records, for every permission, the role check that guards
 *      it in the code TODAY. That's what lets `requirePermission()` ship as pure
 *      indirection — Phase 0 of docs/permissions-architecture.md — so all 242
 *      call sites can migrate to permission keys before any semantics move.
 *
 *   2. `legacySectorRolesFor()` is the Phase 1 backfill: the coarse old-role →
 *      sector-role mapping. Deliberately dumb, with no inference from
 *      `User.department`, because the assignment UI ships before enforcement and
 *      narrowing individuals down is done there where it can be eyeballed.
 *
 * Both are deletable once Phase 3 finishes.
 */
import type { UserRole } from '@/lib/roles';
import {
  PERMISSIONS,
  SENSITIVE_CAPABILITIES,
  type Permission,
  type PlatformTier,
  type SectorRoleRef,
} from './registry';

/**
 * The legacy role buckets, as they exist in `src/lib/roles.ts` and the reporting
 * guard.
 *
 *   • `developer`     — `requireRole('developer')`
 *   • `elevated`      — developer + super_admin (ELEVATED_ROLES)
 *   • `management`    — + admin (MANAGEMENT_ROLES). 86% of guards.
 *   • `authenticated` — any signed-in user with account scope. What
 *                       `requireReportingAccess()` actually enforces.
 */
export type LegacyBucket = 'developer' | 'elevated' | 'management' | 'authenticated';

const LEGACY_ROLES: Record<LegacyBucket, UserRole[]> = {
  developer: ['developer'],
  elevated: ['developer', 'super_admin'],
  management: ['developer', 'super_admin', 'admin'],
  authenticated: ['developer', 'super_admin', 'admin', 'client'],
};

/**
 * Which legacy check currently guards each permission.
 *
 * Verified against the live call sites, not assumed — the entries that are NOT
 * plain `management` are the interesting ones:
 *
 *   • `agency.users.manage` is ELEVATED today (`POST /api/users` uses
 *     ELEVATED_ROLES) even though the new model gives it to `agency.admin`.
 *   • `agency.platform.configure` / `finance.markup.manage` are elevated
 *     (`PUT /api/default-markup`, and the isElevated entries in
 *     settings-registry).
 *   • `user.impersonate` is developer-only (`POST /api/impersonate`).
 *   • Every `reporting.*` read is merely AUTHENTICATED — `requireReportingAccess`
 *     checks sign-in and account scope and nothing else. Budget and Executive
 *     included. That is the single biggest gap the new model closes.
 */
export const LEGACY_GUARD: Record<Permission, LegacyBucket> = {
  // ── Agency ──
  'agency.access': 'management',
  'agency.subaccounts.view': 'management',
  'agency.subaccounts.create': 'elevated',
  'agency.subaccounts.edit': 'management',
  'agency.subaccounts.archive': 'elevated',
  'agency.users.view': 'management',
  'agency.users.invite': 'management',
  'agency.users.manage': 'elevated',
  'agency.users.avatar': 'developer',
  'agency.teams.manage': 'management',
  'agency.knowledge.manage': 'management',
  'agency.contact_field_blueprints.manage': 'management',
  'agency.platform.configure': 'elevated',
  'agency.industries.view': 'management',
  'agency.markup.view': 'management',
  'agency.alerts.view': 'management',
  'agency.changelog.manage': 'management',
  'agency.coop.manage': 'management',

  // ── Studio ── every surface is the same "are you staff?" check today.
  'studio.access': 'management',
  'studio.dashboard.view': 'management',
  'studio.campaigns.view': 'management',
  'studio.campaigns.edit': 'management',
  'studio.campaigns.publish': 'management',
  'studio.email.view': 'management',
  'studio.email.edit': 'management',
  'studio.templates.view': 'management',
  'studio.templates.edit': 'management',
  'studio.templates.publish': 'management',
  'studio.adgen.view': 'management',
  'studio.adgen.edit': 'management',
  'studio.adgen.generate': 'management',
  'studio.adgen.launch': 'management',
  'studio.assets.view': 'management',
  'studio.assets.upload': 'management',
  'studio.assets.manage': 'management',
  'studio.flows.view': 'management',
  'studio.flows.edit': 'management',
  'studio.flows.activate': 'management',
  'studio.forms.view': 'management',
  'studio.forms.edit': 'management',
  'studio.forms.deploy': 'management',
  'studio.landing_pages.view': 'management',
  'studio.landing_pages.edit': 'management',
  'studio.landing_pages.publish': 'management',
  'studio.blocks.view': 'management',
  'studio.blocks.edit': 'management',
  'studio.contacts.view': 'management',
  'studio.contacts.edit': 'management',
  'studio.contacts.import': 'management',
  'studio.segments.view': 'management',
  'studio.segments.edit': 'management',
  'studio.contact_fields.view': 'management',
  'studio.contact_fields.manage': 'management',
  'studio.domains.view': 'management',
  'studio.domains.manage': 'management',

  // ── Reporting ── see the note above: reads are ungated beyond sign-in.
  'reporting.access': 'authenticated',
  'reporting.report.view': 'authenticated',
  'reporting.budget.view': 'authenticated',
  'reporting.executive.view': 'authenticated',
  'reporting.configure': 'management',

  // ── Projects ── staff-only via src/app/app/layout.tsx, nothing finer.
  'projects.access': 'management',
  'projects.initiative.view': 'management',
  'projects.initiative.create': 'management',
  'projects.initiative.edit': 'management',
  'projects.task.view': 'management',
  'projects.task.create': 'management',
  'projects.task.edit': 'management',
  'projects.task.assign_any': 'management',
  'projects.budget.view': 'management',
  'projects.budget.edit': 'management',
  'projects.pacing.view': 'management',
  'projects.pacing.edit': 'management',
  'projects.teams.manage': 'management',

  // ── Sensitive capabilities ── all just "staff" today, which is the problem.
  'blast.send': 'management',
  'contacts.pii.export': 'management',
  'finance.spend.view': 'management',
  'finance.markup.manage': 'elevated',
  'integrations.credentials.manage': 'management',
  'user.impersonate': 'developer',
};

/** The legacy roles that satisfy a permission under Phase 0 semantics. */
export function legacyRolesFor(permission: Permission): UserRole[] {
  return LEGACY_ROLES[LEGACY_GUARD[permission]];
}

/** Phase 0 check: does this old-style role satisfy the permission today? */
export function legacyCan(role: UserRole, permission: Permission): boolean {
  return legacyRolesFor(permission).includes(role);
}

// ── Phase 1 backfill ───────────────────────────────────────────────────────

/** Old role → new platform tier. */
export function legacyTierFor(role: UserRole): PlatformTier {
  if (role === 'developer') return 'developer';
  if (role === 'client') return 'client';
  return 'staff';
}

/**
 * Old role → starting sector roles.
 *
 * Chosen to reproduce today's effective access, so flipping enforcement in
 * Phase 3 is a no-op and narrowing happens deliberately in the UI rather than
 * as a surprise at rollout. `admin` therefore lands on `studio.lead`, keeping
 * template-publish, flow-activate, form-deploy and ad-launch — an `admin` has
 * all four today, and taking them away silently is exactly the kind of
 * regression this phasing exists to avoid.
 *
 * The narrower Studio roles (`producer`, `designer`, `viewer`) are the point of
 * the whole exercise, but they get assigned by hand to the people who should
 * have them.
 */
export function legacySectorRolesFor(role: UserRole): SectorRoleRef[] {
  switch (role) {
    case 'developer':
      return ['agency.owner', 'studio.lead', 'reporting.admin', 'projects.admin'];
    case 'super_admin':
      return ['agency.owner', 'studio.lead', 'reporting.admin', 'projects.admin'];
    case 'admin':
      // Top role in every sector except Agency, for the same reason `admin`
      // lands on `studio.lead`: an admin can configure reporting, create
      // initiatives, manage teams and edit budget TODAY. `reporting.analyst`
      // and `projects.member` would have quietly taken nine of those away at
      // rollout. Narrowing is a decision made per person in the UI, never a
      // side effect of the backfill.
      return ['agency.admin', 'studio.lead', 'reporting.admin', 'projects.admin'];
    case 'client':
      // Reporting only — the invariant, not a default.
      return ['reporting.client'];
  }
}

/**
 * The sensitive capabilities a legacy role can already exercise today.
 *
 * Used by BOTH the Phase 4 backfill and `POST /api/users`, so a user created
 * after the one-shot backfill lands in the same state as everyone else. Without
 * that, a new admin would silently hold no capabilities at all and lose the
 * ability to send, export or see cost the moment enforcement flipped — with
 * nothing on screen distinguishing them from a colleague who could.
 *
 * Derived from LEGACY_GUARD rather than restated, so the two can't drift.
 */
export function legacyCapabilitiesFor(role: UserRole): Permission[] {
  return SENSITIVE_CAPABILITIES.filter((capability) => legacyCan(role, capability));
}

/** Sanity net: every permission must declare a legacy bucket. */
export function findPermissionsMissingLegacyGuard(): Permission[] {
  return PERMISSIONS.filter((p) => LEGACY_GUARD[p] === undefined);
}
