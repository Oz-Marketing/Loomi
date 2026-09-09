import { can } from '@/lib/permissions/registry';
import { subjectFromSession } from '@/lib/permissions/require';
import type { Session } from 'next-auth';

/**
 * Who may read Campaigns, and how much of it.
 *
 * WHY THIS ASKS THE REGISTRY DIRECTLY, ahead of the sector rollout — the same
 * reason `src/lib/ad-generator/access.ts` does. `requirePermission` routes
 * through `isEnforced()`, Studio enforcement is still behind
 * `PERMISSIONS_ENFORCE_STUDIO`, and until it flips the LEGACY bucket decides.
 * `studio.campaigns.view` maps to `management`, which locks a client out — so
 * the entitlement Connor asked for ("clients see the OEM campaigns, and nothing
 * else") has no legacy expression at all. When the flag goes on this becomes
 * redundant rather than wrong: both read `studio.campaigns.view`.
 *
 * THE CLIENT BOUND IS NOT A UI FILTER. `automationOnly` is passed to
 * `listCampaigns`, which turns it into `where.source = 'automation'`. A dealer
 * calling the route by hand gets the same answer as one clicking the page —
 * their manual blasts, flows and landing pages are never in the result set to
 * begin with.
 */
export interface CampaignAccess {
  /** False → the caller sees a 404/403; they have no business here. */
  allowed: boolean;
  /** True for the client tier: OEM runs only, and no creating or deleting. */
  automationOnly: boolean;
}

export function campaignAccessFor(session: Session | null): CampaignAccess {
  if (!session?.user) return { allowed: false, automationOnly: false };
  const subject = subjectFromSession(session);
  return {
    allowed: can(subject, 'studio.campaigns.view'),
    automationOnly: subject.tier === 'client',
  };
}
