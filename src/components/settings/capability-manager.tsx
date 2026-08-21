'use client';

import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { Tooltip } from '@/app/app/tools/_shared/Tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import {
  SENSITIVE_CAPABILITIES,
  type Permission,
  type PlatformTier,
} from '@/lib/permissions/registry';

/**
 * What each capability actually lets someone do, and why it's separate from a
 * sector role. Phrased as consequences — the point of pulling these out was
 * that "Admin" gave no hint that it included emailing 265,000 contacts.
 */
const CAPABILITY_COPY: Record<string, { label: string; description: string }> = {
  'blast.send': {
    label: 'Send blasts',
    description:
      'Put email and SMS on the wire, immediately or on a schedule. Building a draft does not need this.',
  },
  'contacts.pii.export': {
    label: 'Export contact data',
    description:
      'Download names, emails and phone numbers as CSV. Every export is recorded.',
  },
  'finance.spend.view': {
    label: 'See cost and spend',
    description: 'Internal cost figures and margin, as opposed to client-facing billed amounts.',
  },
  'finance.markup.manage': {
    label: 'Change markup',
    description: 'Edit default and per-account markup — what every client is billed.',
  },
  'integrations.credentials.manage': {
    label: 'Manage integration credentials',
    description: 'Connect and rotate SendGrid, Twilio, CRM and Google Business Profile.',
  },
  'user.impersonate': {
    label: 'Impersonate users',
    description: 'Sign in as another user to reproduce what they see.',
  },
};

export type CapabilityManagerProps = {
  /** Capability keys currently granted. */
  value: string[];
  onChange: (next: string[]) => void;
  tier: PlatformTier;
  disabled?: boolean;
};

/**
 * Grant or revoke the sensitive capabilities — the actions no sector role
 * confers, however senior.
 *
 * Rendered as checkboxes rather than folded into the role dropdowns on purpose:
 * these cross sectors, and the whole reason they exist is that they should be a
 * separate, visible decision rather than something inherited by being "Admin".
 */
export function CapabilityManager({
  value,
  onChange,
  tier,
  disabled = false,
}: CapabilityManagerProps) {
  const granted = new Set(value);

  const toggle = (capability: Permission) => {
    const next = new Set(granted);
    if (next.has(capability)) next.delete(capability);
    else next.add(capability);
    // Stable order so an unchanged selection doesn't look dirty.
    onChange(SENSITIVE_CAPABILITIES.filter((c) => next.has(c)));
  };

  // Same reasoning as the sector roles: a developer passes every check, so
  // checkboxes here would imply a restriction that isn't real.
  if (tier === 'developer') {
    return (
      <p className="text-xs text-[var(--muted-foreground)]">
        Developers bypass all permission checks — capability grants don&apos;t apply.
        Their use of these actions is still recorded.
      </p>
    );
  }

  // A client can only hold Reporting, and none of these belong to Reporting.
  if (tier === 'client') {
    return (
      <p className="text-xs text-[var(--muted-foreground)]">
        Client users can&apos;t hold sensitive capabilities.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {SENSITIVE_CAPABILITIES.map((capability) => {
        const copy = CAPABILITY_COPY[capability] ?? {
          label: capability,
          description: '',
        };
        return (
          // Wrapped so each row is block-level: Checkbox is inline-flex, which
          // is what a table cell wants but not a stacked list.
          <div key={capability}>
            <Checkbox
              checked={granted.has(capability)}
              onChange={() => toggle(capability)}
              disabled={disabled}
              label={
                <span className="inline-flex items-center gap-1">
                  {copy.label}
                  {copy.description && (
                    <Tooltip label={copy.description}>
                      <InformationCircleIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                    </Tooltip>
                  )}
                </span>
              }
            />
          </div>
        );
      })}
    </div>
  );
}
