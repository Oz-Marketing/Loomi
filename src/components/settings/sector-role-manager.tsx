'use client';

import { useMemo } from 'react';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { Tooltip } from '@/app/app/tools/_shared/Tooltip';
import {
  SECTORS,
  assignableRolesForTier,
  assignableSectorsForTier,
  parseSectorRoleRef,
  sectorLabel,
  sectorRoleLabel,
  sectorRoleRef,
  type PlatformTier,
  type Sector,
} from '@/lib/permissions/registry';

const NO_ACCESS = '';

/**
 * What each role means, in the words someone assigning it would use. Keep these
 * behavioural ("can publish", "cannot send") rather than restating the name —
 * the whole reason this screen exists is that "Admin" told you nothing about
 * what the person could actually do.
 */
const ROLE_DESCRIPTIONS: Record<string, string> = {
  'agency.owner': 'Everything in Agency Settings, including industries, markup and alert rules.',
  'agency.admin': 'Accounts, users, teams and the knowledge base. Not platform configuration.',
  'agency.user_manager': 'Invite and deactivate users. Nothing else.',

  'studio.lead': 'All of Studio, including publishing templates and launching ads.',
  'studio.producer': 'Build campaigns, emails, flows, forms and pages. Cannot publish or launch.',
  'studio.designer': 'Ad Generator, templates, blocks and assets. Nothing that reaches a contact.',
  'studio.viewer': 'Read-only across Studio.',

  'reporting.admin': 'Every report, plus which reports each account sees.',
  'reporting.analyst': 'Every report, including Budget and Executive.',
  'reporting.client': 'The client-facing report set. No Budget, no cost figures.',
  'reporting.viewer': 'A limited set of reports.',

  'projects.admin': 'All initiatives, tasks, teams and budget. Can assign anyone.',
  'projects.lead': 'Initiatives and tasks for the teams they lead.',
  'projects.member': 'Their own tasks, comments and time.',
  'projects.requester': 'File requests and track their own. No board access.',
};

const SECTOR_DESCRIPTIONS: Record<Sector, string> = {
  agency: 'Platform configuration — the cog menu.',
  studio: 'Marketing production: campaigns, email, Ad Generator, assets.',
  reporting: 'Client-facing reports and dashboards.',
  projects: 'Initiatives, tasks and ad pacing.',
};

export type SectorRoleManagerProps = {
  /** Fully-qualified refs, e.g. `['studio.designer', 'reporting.analyst']`. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Derived from the user's platform role — bounds which sectors are offered. */
  tier: PlatformTier;
  disabled?: boolean;
};

/**
 * Per-sector role assignment: one dropdown per sector, "No access" meaning no
 * row at all.
 *
 * Only sectors the tier may hold are rendered, so a client user simply has no
 * Studio or Projects dropdown to get wrong — the invariant is expressed as an
 * absence in the UI rather than as an error after saving. The API enforces the
 * same rule, since this component isn't a security boundary.
 */
export function SectorRoleManager({
  value,
  onChange,
  tier,
  disabled = false,
}: SectorRoleManagerProps) {
  const sectors = useMemo(() => assignableSectorsForTier(tier), [tier]);

  const bySector = useMemo(() => {
    const map = new Map<Sector, string>();
    for (const ref of value) {
      const parsed = parseSectorRoleRef(ref);
      if (parsed) map.set(parsed.sector, parsed.role);
    }
    return map;
  }, [value]);

  const setSector = (sector: Sector, role: string) => {
    // Rebuild in SECTORS order so the saved array is stable and two equivalent
    // selections don't look like a change to the dirty check.
    const next = new Map(bySector);
    if (role === NO_ACCESS) next.delete(sector);
    else next.set(sector, role);

    onChange(
      SECTORS.filter((s) => next.has(s)).map((s) => sectorRoleRef(s, next.get(s)!)),
    );
  };

  // A developer bypasses every check, so offering them per-sector dropdowns
  // would imply a restriction that doesn't exist.
  if (tier === 'developer') {
    return (
      <p className="text-xs text-[var(--muted-foreground)]">
        Developers bypass all permission checks — sector roles don&apos;t apply.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {sectors.map((sector) => {
        const current = bySector.get(sector) ?? NO_ACCESS;
        const currentRef = current ? sectorRoleRef(sector, current) : null;

        return (
          <div key={sector} className="flex items-start gap-3">
            <div className="w-28 shrink-0 pt-2">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--foreground)]">
                {sectorLabel(sector)}
                <Tooltip label={SECTOR_DESCRIPTIONS[sector]}>
                  <InformationCircleIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                </Tooltip>
              </span>
            </div>

            <div className="flex-1 min-w-0 flex items-center gap-2">
              <select
                value={current}
                disabled={disabled}
                onChange={(e) => setSector(sector, e.target.value)}
                aria-label={`${sectorLabel(sector)} role`}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--primary)] disabled:opacity-50"
              >
                <option value={NO_ACCESS}>No access</option>
                {assignableRolesForTier(tier, sector).map((role) => (
                  <option key={role} value={role}>
                    {sectorRoleLabel(role)}
                  </option>
                ))}
              </select>
              {/* What the SELECTED role actually permits. In a tooltip rather
                  than under the field so a four-sector stack stays one scannable
                  column of dropdowns. */}
              {currentRef && ROLE_DESCRIPTIONS[currentRef] && (
                <Tooltip label={ROLE_DESCRIPTIONS[currentRef]}>
                  <InformationCircleIcon className="w-4 h-4 shrink-0 text-[var(--muted-foreground)]" />
                </Tooltip>
              )}
            </div>
          </div>
        );
      })}

      {tier === 'client' && (
        <p className="text-[11px] leading-4 text-[var(--muted-foreground)]">
          Client users can only be given the client-facing Reporting views —
          never Budget or Executive.
        </p>
      )}
    </div>
  );
}
